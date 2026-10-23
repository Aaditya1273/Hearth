/**
 * Ring Partner API (Amazon Vision API) as a Hearth presence source.
 *
 * Two inbound paths, one mapping:
 *  - signed webhooks (motion_detected, contact sensors) pushed by Ring;
 *  - event history pulled from GET /v1/history/devices/{id}/events, which is
 *    also what Ring's Developer Playground exposes (it sends no webhooks).
 *
 * Hearth only keeps "something moved at the door" and "a door opened", with a
 * timestamp. It never requests video, images or live view, and it ignores
 * what is not the parent's own rhythm: vehicles, package deliveries and the
 * doorbell button (that is a visitor, and counting it would turn an
 * unanswered ring into a "normal day").
 */
import crypto from 'crypto';
import { query } from '../../db';

export const RING_API = 'https://api.amazonvision.com';
const USER_AGENT = 'Hearth/1.0';

export interface RingSignal {
    source: string;
    kind: 'motion' | 'door';
    occurred_at: Date;
    external_id: string;
    confidence: number | null;
    simulated: boolean;
    provenance: 'ring' | 'ring_playground';
}

/** Ring signs the raw body with HMAC-SHA256, hex, header `X-Signature: sha256=<hex>`. */
export function verifyRingSignature(rawBody: Buffer | undefined, header: string | undefined, key: string): boolean {
    if (!rawBody || !header || !key) return false;
    const received = header.startsWith('sha256=') ? header.slice(7) : header;
    if (!/^[0-9a-f]{64}$/i.test(received)) return false;
    const expected = crypto.createHmac('sha256', key).update(rawBody).digest();
    return crypto.timingSafeEqual(expected, Buffer.from(received, 'hex'));
}

// Ids from Ring are opaque and can be long; hash them into the 100-char column.
const extId = (prefix: string, id: string) => `ring:${prefix}:${crypto.createHash('sha1').update(id).digest('hex')}`;
const deviceSource = (name: string | undefined) => `Ring ${(name || 'device').slice(0, 90)}`;

// sub_type is an open vocabulary (Smart Alerts on or off): only these mean a person moved.
const PERSON_MOTION: Record<string, number | null> = { human: 0.8, motion: null, other_motion: null };

/** Map one webhook payload to a presence signal, or null when Hearth ignores it. */
export function signalFromWebhook(payload: any, deviceNames: Record<string, string> = {}): RingSignal | null {
    const data = payload?.data;
    const attrs = data?.attributes;
    const requestId = payload?.meta?.request_id;
    if (typeof data?.type !== 'string' || typeof attrs?.source !== 'string' || typeof requestId !== 'string') return null;
    const ts = Number(attrs.timestamp);
    if (!Number.isFinite(ts)) return null;
    const base = {
        source: deviceSource(deviceNames[attrs.source]), occurred_at: new Date(ts),
        external_id: extId('w', requestId), simulated: false, provenance: 'ring' as const,
    };
    if (data.type === 'motion_detected') {
        const sub = typeof attrs.sub_type === 'string' ? attrs.sub_type : 'motion';
        return sub in PERSON_MOTION ? { ...base, kind: 'motion', confidence: PERSON_MOTION[sub] } : null;
    }
    if (data.type === 'contact_sensor_faulted') return { ...base, kind: 'door', confidence: null }; // faulted = opened
    return null;
}

/**
 * Map one history event. In the Playground, the Motion/Package/Vehicle
 * buttons only record `on_demand` (a simulated live view): with `playground`
 * set those become simulated motion, labelled as such everywhere.
 */
export function signalFromHistory(ev: any, deviceName: string, playground: boolean): RingSignal | null {
    const type = ev?.attributes?.event_type;
    const start = Number(ev?.attributes?.start);
    if (typeof ev?.id !== 'string' || !Number.isFinite(start)) return null;
    const base = { source: deviceSource(deviceName), occurred_at: new Date(start), external_id: extId('h', ev.id) };
    if (type === 'motion') return { ...base, kind: 'motion', confidence: null, simulated: playground, provenance: playground ? 'ring_playground' : 'ring' };
    if (type === 'on_demand' && playground) return { ...base, kind: 'motion', confidence: null, simulated: true, provenance: 'ring_playground' };
    return null;
}

export class RingApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
}

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...args) => fetch(...args);
/** Tests replace the network. */
export function setRingFetch(f: Fetch | null): void { fetchImpl = f ?? ((...args) => fetch(...args)); }

async function ringGet(path: string, token: string, hardwareId: string): Promise<any> {
    const res = await fetchImpl(`${RING_API}${path}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': USER_AGENT, Hardware_Id: hardwareId },
        signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new RingApiError(res.status, `Ring API ${path.split('?')[0]} answered ${res.status}`);
    return res.json();
}

async function insertSignals(circleId: string, signals: RingSignal[]): Promise<number> {
    let added = 0;
    for (const s of signals) {
        const { rows } = await query(
            `INSERT INTO presence_signals (circle_id, source, kind, payload, occurred_at, provenance, simulated, external_id, confidence)
             VALUES ($1, $2, $3, '{}'::jsonb, $4, $5, $6, $7, $8)
             ON CONFLICT (circle_id, external_id) WHERE external_id IS NOT NULL DO NOTHING RETURNING id`,
            [circleId, s.source, s.kind, s.occurred_at, s.provenance, s.simulated, s.external_id, s.confidence]
        );
        added += rows.length;
    }
    return added;
}

export interface RingSyncResult { devices: Array<{ id: string; name: string }>; imported: number; seen: number; account_linked: boolean }

const MAX_PAGES = 5;

/**
 * Pull the door rhythm from Ring with a token the admin pastes (Playground
 * tokens last about 30 minutes). The token is used for this call only and is
 * never stored; the Ring account id and device names are kept so webhooks can
 * be routed to this circle.
 */
export async function syncFromRing(circleId: string, token: string, playground: boolean): Promise<RingSyncResult> {
    const hardwareId = crypto.createHash('sha256').update(`hearth:${circleId}`).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*/, '$1-$2-$3-$4-$5');
    const list = await ringGet('/v1/devices', token, hardwareId);
    const devices = (Array.isArray(list?.data) ? list.data : [])
        .filter((d: any) => typeof d?.id === 'string')
        .map((d: any) => ({ id: d.id as string, name: String(d.attributes?.name ?? 'Ring device').slice(0, 90) }));

    let accountId: string | null = null;
    try {
        const me = await ringGet('/v1/users/me', token, hardwareId);
        accountId = typeof me?.data?.id === 'string' ? me.data.id : null;
    } catch { /* optional: the Playground may not expose it */ }

    let imported = 0, seen = 0;
    const types = playground ? 'motion,on_demand' : 'motion.human,motion.other_motion,motion';
    for (const d of devices) {
        let path: string | null = `/v1/history/devices/${encodeURIComponent(d.id)}/events?event_types=${types}`;
        for (let page = 0; path && page < MAX_PAGES; page++) {
            let body: any;
            try { body = await ringGet(path, token, hardwareId); } catch (e) {
                if (e instanceof RingApiError && (e.status === 404 || e.status === 400)) break; // a sensor has no history
                throw e;
            }
            const events = Array.isArray(body?.data) ? body.data : [];
            seen += events.length;
            imported += await insertSignals(circleId, events.map((ev: any) => signalFromHistory(ev, d.name, playground)).filter(Boolean) as RingSignal[]);
            const next = body?.links?.next;
            path = events.length && typeof next === 'string' && next.startsWith('/v1/history/') ? next : null;
        }
    }

    await query(
        `UPDATE care_circles SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('ring', $2::jsonb) WHERE id = $1`,
        [circleId, JSON.stringify({ account_id: accountId, devices: Object.fromEntries(devices.map((d: { id: string; name: string }) => [d.id, d.name])), playground, synced_at: new Date().toISOString() })]
    );
    return { devices, imported, seen, account_linked: Boolean(accountId) };
}

/** Store one webhook for the circle linked to its Ring account. Returns null when no circle is linked. */
export async function ingestRingWebhook(payload: any): Promise<{ circleId: string; stored: boolean } | null> {
    const accountId = payload?.meta?.account_id;
    if (typeof accountId !== 'string') return null;
    const { rows } = await query(`SELECT id, settings->'ring'->'devices' AS devices FROM care_circles WHERE settings->'ring'->>'account_id' = $1 LIMIT 1`, [accountId]);
    if (!rows[0]) return null;
    const signal = signalFromWebhook(payload, rows[0].devices ?? {});
    if (!signal) return { circleId: rows[0].id, stored: false };
    return { circleId: rows[0].id, stored: (await insertSignals(rows[0].id, [signal])) > 0 };
}
