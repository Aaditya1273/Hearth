/**
 * Hearth persistence: parent preferences, Trust Ledger, presence views,
 * proposals and moments. Every write that changes what is shared or decided
 * commits together with its ledger row, or not at all.
 */
import type { PoolClient } from 'pg';
import { query, getClient } from '../../db';
import { toLocalISO } from '../../routes/events';
import {
    Actor, DEFAULT_PREFERENCES, ParentPreferences, SharingLevel, BaseLevel, RecoveryExtra,
    effectivePreferences, allows,
} from './policy';
import { assessPresence, renderPresenceView, PresenceEvent, PresenceView, BASELINE_WINDOW_DAYS, MedicationConfirmation } from './presence';
import { canDecide, isExpired, ProposalKind, PROPOSAL_TTL_HOURS } from './proposals';
import { simulate, SimScenario } from './simulator';

import type { CircleRole } from '../../middleware/circle';

type Db = Pick<PoolClient, 'query'>;
/** The shared pool behind the same interface as a transaction client. */
export const pool: Db = { query: ((text: string, params?: unknown[]) => query(text, params as any[])) as Db['query'] };

/** Roles that may see Hearth presence at all (then filtered by the parent's level). */
export const HEARTH_VIEWER_ROLES: CircleRole[] = ['admin', 'family', 'viewer'];

export class HearthError extends Error {
    constructor(public status: number, public code: string) {
        super(code);
    }
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await getClient();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
    } finally {
        client.release();
    }
}

const toDate = (v: unknown): Date | null => (v === null || v === undefined ? null : new Date(String(v)));

// ─── Preferences ──────────────────────────────────────────────────────────────

export async function loadPreferences(db: Db, circleId: string, forUpdate = false): Promise<ParentPreferences> {
    const { rows } = await db.query(
        `SELECT level, previous_level, recovery_until, recovery_extras, delegate_member_id, away_until
         FROM parent_preferences WHERE circle_id = $1${forUpdate ? ' FOR UPDATE' : ''}`,
        [circleId]
    );
    const r = rows[0];
    if (!r) return { ...DEFAULT_PREFERENCES };
    return {
        level: r.level as SharingLevel,
        previous_level: (r.previous_level as BaseLevel | null) ?? null,
        recovery_until: toDate(r.recovery_until),
        recovery_extras: Array.isArray(r.recovery_extras) ? (r.recovery_extras as RecoveryExtra[]) : [],
        delegate_member_id: r.delegate_member_id ?? null,
        away_until: toDate(r.away_until),
    };
}

export async function writePreferences(db: Db, circleId: string, p: ParentPreferences): Promise<void> {
    await db.query(
        `INSERT INTO parent_preferences (circle_id, level, previous_level, recovery_until, recovery_extras, delegate_member_id, away_until, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NOW())
         ON CONFLICT (circle_id) DO UPDATE SET
           level = EXCLUDED.level, previous_level = EXCLUDED.previous_level, recovery_until = EXCLUDED.recovery_until,
           recovery_extras = EXCLUDED.recovery_extras, delegate_member_id = EXCLUDED.delegate_member_id,
           away_until = EXCLUDED.away_until, updated_at = NOW()`,
        [circleId, p.level, p.previous_level, p.recovery_until, JSON.stringify(p.recovery_extras), p.delegate_member_id, p.away_until]
    );
}

/**
 * Recovery that ran out is written back to its previous level, with a
 * system ledger entry, the first time anyone reads the circle after expiry.
 */
export async function settleRecovery(circleId: string, now: Date): Promise<void> {
    const stored = await loadPreferences(pool, circleId);
    if (!effectivePreferences(stored, now).recovery_expired) return;
    await withTransaction(async (c) => {
        const locked = await loadPreferences(c, circleId, true);
        const eff = effectivePreferences(locked, now);
        if (!eff.recovery_expired) return; // someone else settled it
        const { recovery_expired: _ignored, ...next } = eff;
        await writePreferences(c, circleId, next);
        await recordLedger(c, circleId, { kind: 'system', label: 'Hearth' }, {
            action: 'recovery_expired', category: 'sharing_policy', level: next.level,
            detail: { returned_to: next.level },
        });
    });
}

export async function currentPreferences(circleId: string, now = new Date()): Promise<ParentPreferences> {
    await settleRecovery(circleId, now);
    const { recovery_expired: _ignored, ...prefs } = effectivePreferences(await loadPreferences(pool, circleId), now);
    return prefs;
}

// ─── Trust Ledger ─────────────────────────────────────────────────────────────

export interface LedgerEntry {
    action: string;
    category: string;
    level?: SharingLevel | null;
    /** Ids, levels and field names only: never message text, tokens or secrets. */
    detail?: Record<string, unknown>;
}

export async function recordLedger(db: Db, circleId: string, actor: Actor, entry: LedgerEntry): Promise<string> {
    const { rows } = await db.query(
        `INSERT INTO trust_ledger (circle_id, actor_kind, actor_user_id, actor_device_id, actor_label, action, category, level, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) RETURNING id`,
        [
            circleId,
            actor.kind,
            actor.kind === 'member' || actor.kind === 'assistant' ? actor.userId : null,
            actor.kind === 'parent' ? actor.deviceId : null,
            actor.label.slice(0, 120),
            entry.action,
            entry.category,
            entry.level ?? null,
            JSON.stringify(entry.detail ?? {}),
        ]
    );
    return rows[0].id as string;
}

export async function listLedger(circleId: string, limit = 100) {
    const { rows } = await query(
        `SELECT id, actor_kind, actor_label, action, category, level, detail, created_at
         FROM trust_ledger WHERE circle_id = $1 ORDER BY created_at DESC, id LIMIT $2`,
        [circleId, Math.min(Math.max(limit, 1), 500)]
    );
    return rows;
}

/** One disclosure row per viewer, level and field set every 30 minutes. */
const DISCLOSURE_DEDUPE_MINUTES = 30;

export async function recordDisclosure(circleId: string, actor: Actor, level: SharingLevel, fields: string[], channel: string): Promise<void> {
    if (actor.kind !== 'member' && actor.kind !== 'assistant') return;
    const signature = [...fields].sort().join(',');
    const recent = await query(
        `SELECT 1 FROM trust_ledger
         WHERE circle_id = $1 AND action = 'disclosure' AND actor_user_id = $2 AND actor_kind = $3
           AND level = $4 AND detail->>'fields' = $5 AND detail->>'channel' = $6
           AND created_at > NOW() - ($7 || ' minutes')::interval
         LIMIT 1`,
        [circleId, actor.userId, actor.kind, level, signature, channel, String(DISCLOSURE_DEDUPE_MINUTES)]
    );
    if (recent.rows.length) return;
    await recordLedger(pool, circleId, actor, { action: 'disclosure', category: 'presence', level, detail: { fields: signature, channel } });
}

// ─── Actors ───────────────────────────────────────────────────────────────────

export async function memberActor(userId: string, memberId: string, role: string, kind: 'member' | 'assistant' = 'member'): Promise<Actor> {
    const { rows } = await query('SELECT name FROM users WHERE id = $1', [userId]);
    const name = (rows[0]?.name as string | undefined) ?? 'Family member';
    return { kind, userId, memberId, role, label: kind === 'assistant' ? `${name} via Alexa+` : name };
}

export const parentActor = (device: { id: string; name: string }): Actor =>
    ({ kind: 'parent', deviceId: device.id, label: `Parent (${device.name})` });

// ─── Presence view ────────────────────────────────────────────────────────────

export async function recipientName(circleId: string): Promise<string> {
    const { rows } = await query('SELECT first_name FROM care_recipients WHERE circle_id = $1', [circleId]);
    return (rows[0]?.first_name as string | undefined) ?? '';
}

export async function loadPresenceEvents(circleId: string, now: Date): Promise<PresenceEvent[]> {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - BASELINE_WINDOW_DAYS - 1);
    const { rows } = await query(
        `SELECT id, source, kind, provenance, simulated, occurred_at FROM presence_signals
         WHERE circle_id = $1 AND occurred_at >= $2 AND occurred_at <= $3 ORDER BY occurred_at`,
        [circleId, from, now]
    );
    return rows.map((r: any) => ({
        id: r.id, source: r.source, kind: r.kind, provenance: r.provenance, simulated: r.simulated === true,
        occurred_at: new Date(String(r.occurred_at)),
    }));
}

async function medicationConfirmations(circleId: string, now: Date): Promise<MedicationConfirmation[]> {
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const { rows } = await query(
        `SELECT due_at, status, confirmed_at FROM medication_intakes
         WHERE circle_id = $1 AND due_at >= $2 AND due_at < $3 ORDER BY due_at`,
        [circleId, dayStart, new Date(dayStart.getTime() + 86400000)]
    );
    return rows.map((r: any) => ({ due_at: String(r.due_at), status: r.status, confirmed_at: r.confirmed_at ? String(r.confirmed_at) : null }));
}

/** Field names actually present in a view, for the disclosure record. */
export const disclosedFields = (v: PresenceView): string[] => [
    'status',
    ...(v.timing ? ['timing'] : []),
    ...(v.events ? ['events'] : []),
    ...Object.keys(v.extras ?? {}),
];

/**
 * The single path to presence data for every viewer (REST, kiosk, MCP).
 * A family viewer's disclosure is persisted before the view is returned.
 */
export async function presenceViewFor(circleId: string, actor: Actor, channel: string, now = new Date()) {
    const prefs = await currentPreferences(circleId, now);
    const full = actor.kind === 'parent';
    const [events, name, meds] = await Promise.all([
        loadPresenceEvents(circleId, now),
        recipientName(circleId),
        full || allows(prefs, 'medication_confirmations') ? medicationConfirmations(circleId, now) : Promise.resolve(undefined),
    ]);
    const view = renderPresenceView(assessPresence(events, now, prefs), prefs, { name, fullAccess: full, medications: meds });
    await recordDisclosure(circleId, actor, prefs.level, disclosedFields(view), channel);
    return { view, prefs, name };
}

// ─── Proposals ────────────────────────────────────────────────────────────────

const PROPOSAL_COLUMNS = `id, kind, title, rationale, payload, target_member_id, status, proposed_by_label,
    decided_at, result_ref, expires_at, created_at`;

export async function expireProposals(circleId: string, now: Date): Promise<void> {
    await withTransaction(async (c) => {
        const { rows } = await c.query(
            `UPDATE hearth_proposals SET status = 'expired', decided_at = $2
             WHERE circle_id = $1 AND status = 'pending' AND expires_at <= $2 RETURNING id, kind, title`,
            [circleId, now]
        );
        for (const r of rows) {
            await recordLedger(c, circleId, { kind: 'system', label: 'Hearth' }, {
                action: 'proposal_expired', category: 'coordination', detail: { proposal_id: r.id, kind: r.kind },
            });
        }
    });
}

export async function listProposals(circleId: string, now = new Date()) {
    await expireProposals(circleId, now);
    const { rows } = await query(
        `SELECT p.id, p.kind, p.title, p.rationale, p.payload, p.target_member_id, p.status, p.proposed_by_label,
                p.decided_at, p.result_ref, p.expires_at, p.created_at, u.name AS target_name, d.name AS decided_by_name
         FROM hearth_proposals p
         LEFT JOIN circle_members m ON m.id = p.target_member_id
         LEFT JOIN users u ON u.id = m.user_id
         LEFT JOIN users d ON d.id = p.decided_by_user_id
         WHERE p.circle_id = $1
         ORDER BY (p.status = 'pending') DESC, p.created_at DESC LIMIT 50`,
        [circleId]
    );
    return rows;
}

export interface NewProposal {
    kind: ProposalKind;
    title: string;
    rationale: string;
    payload: Record<string, unknown>;
    target_member_id: string | null;
    dedupe_key?: string | null;
}

/** Insert a pending proposal (idempotent by dedupe_key). Returns null when it already exists. */
export async function createProposal(circleId: string, actor: Actor, p: NewProposal, now = new Date()) {
    return withTransaction(async (c) => {
        const { rows } = await c.query(
            `INSERT INTO hearth_proposals (circle_id, kind, title, rationale, payload, target_member_id, proposed_by_user_id, proposed_by_label, dedupe_key, expires_at)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
             ON CONFLICT (circle_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
             RETURNING ${PROPOSAL_COLUMNS}`,
            [
                circleId, p.kind, p.title.slice(0, 255), p.rationale, JSON.stringify(p.payload), p.target_member_id,
                actor.kind === 'member' || actor.kind === 'assistant' ? actor.userId : null, actor.label,
                p.dedupe_key ?? null, new Date(now.getTime() + PROPOSAL_TTL_HOURS * 3600000),
            ]
        );
        const row = rows[0] ?? null;
        if (row) {
            await recordLedger(c, circleId, actor, {
                action: 'proposal_created', category: 'coordination', detail: { proposal_id: row.id, kind: p.kind },
            });
        }
        return row;
    });
}

async function memberName(db: Db, memberId: string): Promise<{ name: string; user_id: string } | null> {
    const { rows } = await db.query(
        'SELECT u.name, u.id AS user_id FROM circle_members m JOIN users u ON u.id = m.user_id WHERE m.id = $1',
        [memberId]
    );
    return rows[0] ?? null;
}

/** Carry out an approved proposal. Runs inside the decision's transaction. */
async function executeProposal(c: PoolClient, circleId: string, p: any, decider: Extract<Actor, { kind: 'member' }>): Promise<string> {
    const target: string = p.target_member_id ?? decider.memberId;
    if (p.kind === 'assign_task') {
        const { rows } = await c.query(
            'SELECT id, assigned_to FROM tasks WHERE id = $1 AND circle_id = $2 AND is_completed = FALSE FOR UPDATE',
            [p.payload?.task_id, circleId]
        );
        if (!rows[0]) throw new HearthError(409, 'TASK_UNAVAILABLE');
        const assigned: string[] = Array.isArray(rows[0].assigned_to) ? rows[0].assigned_to : [];
        await c.query('UPDATE tasks SET assigned_to = $1::jsonb WHERE id = $2', [JSON.stringify([...new Set([...assigned, target])]), rows[0].id]);
        return rows[0].id;
    }
    if (p.kind === 'visit') {
        const start = toDate(p.payload?.start_time);
        if (!start || Number.isNaN(start.getTime())) throw new HearthError(409, 'VISIT_TIME_INVALID');
        const end = toDate(p.payload?.end_time) ?? new Date(start.getTime() + 60 * 60 * 1000);
        const who = await memberName(c, target);
        const { rows } = await c.query(
            `INSERT INTO events (circle_id, title, category, start_time, end_time, member_ids, created_by)
             VALUES ($1, $2, 'visit', $3, $4, $5::jsonb, $6) RETURNING id`,
            [circleId, p.title, start, end, JSON.stringify([target]), decider.userId]
        );
        await c.query(
            `INSERT INTO hearth_moments (circle_id, author_user_id, kind, message, visit_at) VALUES ($1, $2, 'visit', $3, $4)`,
            [circleId, who?.user_id ?? decider.userId, `${who?.name ?? 'Someone from your family'} is coming to visit.`, start]
        );
        return rows[0].id;
    }
    // check_in: a task for the person who takes it on, due today.
    const now = new Date();
    const { rows } = await c.query(
        `INSERT INTO tasks (circle_id, title, description, category, due_date, assigned_to)
         VALUES ($1, $2, $3, 'other', $4, $5::jsonb) RETURNING id`,
        [circleId, p.title, p.rationale, new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59), JSON.stringify([target])]
    );
    return rows[0].id;
}

export async function decideProposal(
    circleId: string, proposalId: string, decider: Extract<Actor, { kind: 'member' }>, decision: 'approve' | 'reject', now = new Date()
): Promise<{ status: 'approved' | 'rejected' | 'expired'; result_ref: string | null; kind: ProposalKind }> {
    return withTransaction(async (c) => {
        const { rows } = await c.query('SELECT * FROM hearth_proposals WHERE id = $1 AND circle_id = $2 FOR UPDATE', [proposalId, circleId]);
        const p = rows[0];
        if (!p) throw new HearthError(404, 'PROPOSAL_NOT_FOUND');
        if (isExpired({ status: p.status, expires_at: new Date(String(p.expires_at)) }, now)) {
            await c.query(`UPDATE hearth_proposals SET status = 'expired', decided_at = $2 WHERE id = $1`, [p.id, now]);
            await recordLedger(c, circleId, { kind: 'system', label: 'Hearth' }, {
                action: 'proposal_expired', category: 'coordination', detail: { proposal_id: p.id, kind: p.kind },
            });
            return { status: 'expired' as const, result_ref: null, kind: p.kind };
        }
        if (p.status !== 'pending') throw new HearthError(409, 'PROPOSAL_ALREADY_DECIDED');
        if (!canDecide({ role: decider.role, memberId: decider.memberId }, p)) throw new HearthError(403, 'NOT_ALLOWED_TO_DECIDE');

        const resultRef = decision === 'approve' ? await executeProposal(c, circleId, p, decider) : null;
        const status = decision === 'approve' ? 'approved' as const : 'rejected' as const;
        await c.query(
            `UPDATE hearth_proposals SET status = $2, decided_by_user_id = $3, decided_at = $4, result_ref = $5,
                    target_member_id = COALESCE(target_member_id, $6)
             WHERE id = $1`,
            [p.id, status, decider.userId, now, resultRef, decision === 'approve' ? decider.memberId : null]
        );
        await recordLedger(c, circleId, decider, {
            action: `proposal_${status}`, category: 'coordination', detail: { proposal_id: p.id, kind: p.kind, result_ref: resultRef },
        });
        return { status, result_ref: resultRef, kind: p.kind };
    });
}

// ─── Moments ──────────────────────────────────────────────────────────────────

export async function listMoments(circleId: string, limit = 20, withMedia = false) {
    const { rows } = await query(
        `SELECT mo.id, mo.kind, mo.message, mo.visit_at, mo.seen_at, mo.created_at,
                (mo.media_data_url IS NOT NULL) AS has_video,
                ${withMedia ? 'mo.media_data_url' : 'NULL::text AS media_data_url'},
                u.name AS author_name, u.avatar_url AS author_avatar
         FROM hearth_moments mo LEFT JOIN users u ON u.id = mo.author_user_id
         WHERE mo.circle_id = $1 ORDER BY mo.created_at DESC LIMIT $2`,
        [circleId, limit]
    );
    // No Fire TV / Vega OS integration exists: say so on every moment.
    return rows.map((r: any) => ({ ...r, tv_delivery: 'unavailable' as const }));
}

// ─── Simulator ────────────────────────────────────────────────────────────────

export async function isDemoCircle(circleId: string): Promise<boolean> {
    const { rows } = await query(`SELECT (settings->>'hearth_demo') = 'true' AS demo FROM care_circles WHERE id = $1`, [circleId]);
    return rows[0]?.demo === true;
}

/** Replace a demo circle's simulated events with a fresh deterministic run. */
export async function loadSimulation(circleId: string, scenario: SimScenario, actor: Actor, now = new Date(), seed = 42) {
    if (!(await isDemoCircle(circleId))) throw new HearthError(403, 'NOT_A_DEMO_CIRCLE');
    const events = simulate(scenario, now, seed);
    await withTransaction(async (c) => {
        await c.query('DELETE FROM presence_signals WHERE circle_id = $1 AND simulated = TRUE', [circleId]);
        for (const e of events) {
            await c.query(
                `INSERT INTO presence_signals (circle_id, source, kind, payload, occurred_at, provenance, simulated, external_id)
                 VALUES ($1, $2, $3, '{}'::jsonb, $4, 'simulator', TRUE, $5)
                 ON CONFLICT (circle_id, external_id) WHERE external_id IS NOT NULL DO NOTHING`,
                [circleId, e.source, e.kind, e.occurred_at, e.external_id]
            );
        }
        await recordLedger(c, circleId, actor, { action: 'simulation_loaded', category: 'simulator', detail: { scenario, seed, events: events.length } });
    });
    return { scenario, seed, events: events.length, first: events[0] ? toLocalISO(events[0].occurred_at) : null };
}
