import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import crypto from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
// @ts-expect-error plain ESM helper shared with `npm run db:pglite`
import { startPglite } from '../../scripts/pglite-server.mjs';

/**
 * Hearth end to end: policy enforcement, Trust Ledger persistence, Recovery
 * expiry, proposals that wait for a person, cross-circle isolation, the
 * simulator and the Alexa+ MCP server. Everything goes through HTTP, then the
 * database is read back directly to check what was really stored.
 */

let pg: { stop: () => Promise<void> };
let server: http.Server;
let base = '';
let q: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
let token: (userId: string) => string;
let pool: { end: () => Promise<void> };

const ids: Record<string, string> = {};

async function api(method: string, path: string, opts: { user?: string; circle?: string; kiosk?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.user) headers.Authorization = `Bearer ${token(ids[opts.user])}`;
    if (opts.circle) headers['X-Circle-Id'] = opts.circle;
    if (opts.kiosk) headers['X-Kiosk-Token'] = opts.kiosk;
    const res = await fetch(`${base}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    return { status: res.status, body: await res.json() as any };
}

async function mcpClient(bearer: string, elicit?: (message: string) => { action: 'accept' | 'decline'; content?: Record<string, unknown> }) {
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } });
    const client = new Client({ name: 'hearth-test', version: '1.0.0' }, { capabilities: elicit ? { elicitation: { form: {} } } : {} });
    if (elicit) client.setRequestHandler(ElicitRequestSchema, async (r) => elicit(r.params.message));
    await client.connect(transport);
    return { client, transport };
}

beforeAll(async () => {
    const port = 56000 + Math.floor(Math.random() * 1000);
    pg = await startPglite({ port, timeZone: 'Europe/Paris' });
    Object.assign(process.env, {
        NODE_ENV: 'test', POSTGRES_HOST: '127.0.0.1', POSTGRES_PORT: String(port), POSTGRES_DB: 'postgres',
        POSTGRES_USER: 'postgres', POSTGRES_PASSWORD: 'postgres', POSTGRES_POOL_MAX: '1', LOG_LEVEL: 'error',
        JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    });
    const db = await import('../../server/src/db');
    await db.runMigrations();
    q = db.query as typeof q;
    pool = db.default;
    token = (await import('../../server/src/middleware/auth')).generateToken;
    const app = (await import('../../server/src/app')).default;
    server = http.createServer(app).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // Two circles. Margaret's: Alex (admin), Sam (family), Jo (viewer), Pat (neighbor).
    // Ruth's circle belongs to Eve only.
    const user = async (k: string) => { ids[k] = (await q(`INSERT INTO users (email, password_hash, name, language) VALUES ($1, 'x', $2, 'en') RETURNING id`, [`${k}@t.test`, k])).rows[0].id; };
    for (const k of ['alex', 'sam', 'jo', 'pat', 'eve']) await user(k);
    const circle = async (k: string, demo: boolean) => {
        ids[k] = (await q(`INSERT INTO care_circles (name, settings) VALUES ($1, $2::jsonb) RETURNING id`, [k, JSON.stringify(demo ? { hearth_demo: true } : {})])).rows[0].id;
        await q(`INSERT INTO care_recipients (circle_id, first_name) VALUES ($1, $2)`, [ids[k], k === 'margaret' ? 'Margaret' : 'Ruth']);
    };
    await circle('margaret', true);
    await circle('ruth', false);
    const member = async (c: string, u: string, role: string) => { ids[`${u}M`] = (await q(`INSERT INTO circle_members (circle_id, user_id, role) VALUES ($1, $2, $3) RETURNING id`, [ids[c], ids[u], role])).rows[0].id; };
    await member('margaret', 'alex', 'admin');
    await member('margaret', 'sam', 'family');
    await member('margaret', 'jo', 'viewer');
    await member('margaret', 'pat', 'neighbor');
    await member('ruth', 'eve', 'admin');

    // Margaret's paired screen.
    ids.kiosk = crypto.randomBytes(32).toString('hex');
    ids.device = (await q(`INSERT INTO kiosk_devices (circle_id, token, name) VALUES ($1, $2, 'Tablet') RETURNING id`, [ids.margaret, ids.kiosk])).rows[0].id;
});

afterAll(async () => {
    await new Promise((r) => server?.close(r));
    await pool?.end();
    await pg?.stop();
});

describe('simulator', () => {
    it('loads the same events twice in a row (reproducible) and only into demo circles', async () => {
        const run = () => api('POST', '/api/hearth/simulator/run', { user: 'alex', circle: ids.margaret, body: { scenario: 'quiet_morning', seed: 7 } });
        expect((await run()).status).toBe(200);
        const first = (await q(`SELECT source, kind, occurred_at, external_id FROM presence_signals WHERE circle_id = $1 ORDER BY external_id`, [ids.margaret])).rows;
        expect((await run()).status).toBe(200);
        const second = (await q(`SELECT source, kind, occurred_at, external_id FROM presence_signals WHERE circle_id = $1 ORDER BY external_id`, [ids.margaret])).rows;
        expect(second).toEqual(first);
        expect(first.length).toBeGreaterThan(50);
        const flags = (await q(`SELECT DISTINCT simulated, provenance FROM presence_signals WHERE circle_id = $1`, [ids.margaret])).rows;
        expect(flags).toEqual([{ simulated: true, provenance: 'simulator' }]);

        const refused = await api('POST', '/api/hearth/simulator/run', { user: 'eve', circle: ids.ruth, body: { scenario: 'normal_day' } });
        expect(refused.status).toBe(403);
        expect((await q(`SELECT COUNT(*)::int AS n FROM presence_signals WHERE circle_id = $1`, [ids.ruth])).rows[0].n).toBe(0);
    });

    it('a circle with no data reports insufficient data, never normal', async () => {
        const r = await api('GET', '/api/hearth/overview', { user: 'eve', circle: ids.ruth });
        expect(r.body.data.presence.state).toBe('insufficient_data');
    });
});

describe('Glimpse Dial enforced on the server', () => {
    it('family members cannot raise the level, and the refusal is persisted', async () => {
        for (const who of ['alex', 'sam']) {
            const r = await api('PUT', '/api/hearth/policy', { user: who, circle: ids.margaret, body: { level: 'glimpse' } });
            expect(r.status).toBe(403);
        }
        const stored = (await q(`SELECT level FROM parent_preferences WHERE circle_id = $1`, [ids.margaret])).rows;
        expect(stored).toEqual([]); // still the private default
        const denied = (await q(`SELECT actor_label FROM trust_ledger WHERE circle_id = $1 AND action = 'policy_change_denied' ORDER BY created_at`, [ids.margaret])).rows;
        expect(denied.map((r) => r.actor_label)).toEqual(['alex', 'sam']);
    });

    it('light: no timing or events through any endpoint', async () => {
        const overview = await api('GET', '/api/hearth/overview', { user: 'sam', circle: ids.margaret });
        expect(overview.body.data.presence.level).toBe('light');
        expect(overview.body.data.presence).not.toHaveProperty('timing');
        expect(overview.body.data.presence).not.toHaveProperty('events');
        const status = await api('GET', '/api/presence/status', { user: 'sam', circle: ids.margaret });
        expect(status.body.data.today_signal_count).toBeNull();
        expect(status.body.data.last_signal_at).toBeNull();
        expect(status.body.data.webhook_url).toBeNull(); // setup credential: admins only
        const signals = await api('GET', '/api/presence/signals', { user: 'sam', circle: ids.margaret });
        expect(signals.body).toMatchObject({ data: [], restricted: true });
    });

    it('roles outside family/viewer get no presence at all', async () => {
        expect((await api('GET', '/api/hearth/overview', { user: 'pat', circle: ids.margaret })).status).toBe(403);
        expect((await api('GET', '/api/presence/status', { user: 'pat', circle: ids.margaret })).status).toBe(403);
    });

    it('the parent raises it; family then receives exactly the new fields; the change is in the ledger', async () => {
        const r = await api('PUT', '/api/hearth/policy', { kiosk: ids.kiosk, body: { level: 'glimpse' } });
        expect(r.status).toBe(200);
        const row = (await q(`SELECT actor_kind, actor_device_id, action, level, detail FROM trust_ledger WHERE id = $1`, [r.body.data.ledger_id])).rows[0];
        expect(row).toMatchObject({ actor_kind: 'parent', actor_device_id: ids.device, action: 'policy_changed', level: 'glimpse' });
        expect(row.detail).toMatchObject({ from: 'light', to: 'glimpse' });

        const overview = await api('GET', '/api/hearth/overview', { user: 'jo', circle: ids.margaret });
        expect(overview.body.data.presence).toHaveProperty('timing');
        expect(overview.body.data.presence).toHaveProperty('events');
        expect(overview.body.data.presence).not.toHaveProperty('extras');
    });

    it('each family disclosure is persisted with the level and fields it carried', async () => {
        const rows = (await q(
            `SELECT detail->>'fields' AS fields, level FROM trust_ledger
             WHERE circle_id = $1 AND action = 'disclosure' AND actor_user_id = $2 ORDER BY created_at`,
            [ids.margaret, ids.jo]
        )).rows;
        expect(rows.at(-1)).toEqual({ fields: 'events,status,timing', level: 'glimpse' });
    });

    it('Recovery expires on its own and the return is recorded', async () => {
        const set = await api('PUT', '/api/hearth/policy', { kiosk: ids.kiosk, body: { level: 'recovery', recovery_days: 2, recovery_extras: ['night_rest'] } });
        expect(set.body.data.policy).toMatchObject({ level: 'recovery', previous_level: 'glimpse' });
        const during = await api('GET', '/api/hearth/overview', { user: 'sam', circle: ids.margaret });
        expect(Object.keys(during.body.data.presence.extras)).toEqual(['night_rest']);

        // Time passes: move the end date into the past.
        await q(`UPDATE parent_preferences SET recovery_until = NOW() - interval '1 minute' WHERE circle_id = $1`, [ids.margaret]);
        const after = await api('GET', '/api/hearth/overview', { user: 'sam', circle: ids.margaret });
        expect(after.body.data.policy.level).toBe('glimpse');
        expect(after.body.data.presence).not.toHaveProperty('extras');
        const stored = (await q(`SELECT level, previous_level, recovery_until FROM parent_preferences WHERE circle_id = $1`, [ids.margaret])).rows[0];
        expect(stored).toEqual({ level: 'glimpse', previous_level: null, recovery_until: null });
        const expired = (await q(`SELECT COUNT(*)::int AS n FROM trust_ledger WHERE circle_id = $1 AND action = 'recovery_expired'`, [ids.margaret])).rows[0];
        expect(expired.n).toBe(1);
    });

    it('a delegate named by the parent may change it; only the parent names delegates', async () => {
        expect((await api('PUT', '/api/hearth/delegate', { user: 'alex', circle: ids.margaret, body: { member_id: ids.alexM } })).status).toBe(403);
        expect((await api('PUT', '/api/hearth/delegate', { kiosk: ids.kiosk, body: { member_id: ids.samM } })).status).toBe(200);
        expect((await api('PUT', '/api/hearth/policy', { user: 'sam', circle: ids.margaret, body: { level: 'rhythm' } })).status).toBe(200);
        expect((await api('PUT', '/api/hearth/policy', { user: 'alex', circle: ids.margaret, body: { level: 'glimpse' } })).status).toBe(403);
    });
});

describe('proposals wait for a person', () => {
    let taskId = '';
    let proposalId = '';

    it('creating a proposal changes nothing', async () => {
        taskId = (await q(`INSERT INTO tasks (circle_id, title) VALUES ($1, 'Pharmacy') RETURNING id`, [ids.margaret])).rows[0].id;
        const r = await api('POST', '/api/hearth/proposals', { user: 'alex', circle: ids.margaret, body: { kind: 'assign_task', task_id: taskId, target_member_id: ids.samM } });
        expect(r.status).toBe(200);
        proposalId = r.body.data.id;
        expect((await q(`SELECT assigned_to FROM tasks WHERE id = $1`, [taskId])).rows[0].assigned_to).toEqual([]);
    });

    it('a viewer or an untargeted family member cannot decide; the target can, once', async () => {
        expect((await api('POST', `/api/hearth/proposals/${proposalId}/decision`, { user: 'jo', circle: ids.margaret, body: { decision: 'approve' } })).status).toBe(403);
        const ok = await api('POST', `/api/hearth/proposals/${proposalId}/decision`, { user: 'sam', circle: ids.margaret, body: { decision: 'approve' } });
        expect(ok.body.data).toMatchObject({ status: 'approved', result_ref: taskId });
        expect((await q(`SELECT assigned_to FROM tasks WHERE id = $1`, [taskId])).rows[0].assigned_to).toEqual([ids.samM]);
        expect((await api('POST', `/api/hearth/proposals/${proposalId}/decision`, { user: 'sam', circle: ids.margaret, body: { decision: 'approve' } })).status).toBe(409);
        const ledger = (await q(`SELECT action FROM trust_ledger WHERE circle_id = $1 AND detail->>'proposal_id' = $2 ORDER BY created_at`, [ids.margaret, proposalId])).rows;
        expect(ledger.map((r) => r.action)).toEqual(['proposal_created', 'proposal_approved']);
    });

    it('an expired proposal is not executed', async () => {
        const other = (await q(`INSERT INTO tasks (circle_id, title) VALUES ($1, 'Groceries') RETURNING id`, [ids.margaret])).rows[0].id;
        const r = await api('POST', '/api/hearth/proposals', { user: 'alex', circle: ids.margaret, body: { kind: 'assign_task', task_id: other, target_member_id: ids.samM } });
        await q(`UPDATE hearth_proposals SET expires_at = NOW() - interval '1 minute' WHERE id = $1`, [r.body.data.id]);
        const late = await api('POST', `/api/hearth/proposals/${r.body.data.id}/decision`, { user: 'sam', circle: ids.margaret, body: { decision: 'approve' } });
        expect(late.status).toBe(409);
        expect((await q(`SELECT assigned_to FROM tasks WHERE id = $1`, [other])).rows[0].assigned_to).toEqual([]);
        expect((await q(`SELECT status FROM hearth_proposals WHERE id = $1`, [r.body.data.id])).rows[0].status).toBe('expired');
    });

    it('an approved visit lands on the calendar and on the parent screen', async () => {
        const start = new Date(Date.now() + 2 * 86400000).toISOString();
        const r = await api('POST', '/api/hearth/proposals', { user: 'sam', circle: ids.margaret, body: { kind: 'visit', title: 'Sunday lunch', start_time: start, target_member_id: ids.samM } });
        expect((await q(`SELECT COUNT(*)::int AS n FROM events WHERE circle_id = $1`, [ids.margaret])).rows[0].n).toBe(0);
        await api('POST', `/api/hearth/proposals/${r.body.data.id}/decision`, { user: 'sam', circle: ids.margaret, body: { decision: 'approve' } });
        expect((await q(`SELECT category, member_ids FROM events WHERE circle_id = $1`, [ids.margaret])).rows).toEqual([{ category: 'visit', member_ids: [ids.samM] }]);
        const kiosk = await api('GET', '/api/hearth/kiosk', { kiosk: ids.kiosk });
        expect(kiosk.body.data.moments[0]).toMatchObject({ kind: 'visit', tv_delivery: 'unavailable' });
    });
});

describe('isolation between circles', () => {
    it('a member of another circle gets nothing', async () => {
        expect((await api('GET', '/api/hearth/overview', { user: 'eve', circle: ids.margaret })).status).toBe(403);
        expect((await api('GET', '/api/hearth/ledger', { user: 'eve', circle: ids.margaret })).status).toBe(403);
    });

    it('a proposal id from another circle is not found', async () => {
        const p = (await q(`SELECT id FROM hearth_proposals WHERE circle_id = $1 LIMIT 1`, [ids.margaret])).rows[0].id;
        expect((await api('POST', `/api/hearth/proposals/${p}/decision`, { user: 'eve', circle: ids.ruth, body: { decision: 'reject' } })).status).toBe(404);
    });
});

describe('Alexa+ MCP server', () => {
    let bearer = '';

    it('rejects calls without a valid token', async () => {
        const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
        expect(res.status).toBe(401);
        expect(res.headers.get('www-authenticate')).toMatch(/Bearer/);
    });

    it('negotiates protocol 2025-11-25 and lists the tools', async () => {
        bearer = (await api('POST', '/api/hearth/assistant-tokens', { user: 'alex', circle: ids.margaret, body: { label: 'Alexa+' } })).body.data.token;
        const stored = (await q(`SELECT token_hash FROM assistant_tokens WHERE user_id = $1`, [ids.alex])).rows[0].token_hash;
        expect(stored).not.toContain(bearer.slice(4, 20)); // hashed at rest
        const { client, transport } = await mcpClient(bearer);
        expect(transport.protocolVersion).toBe('2025-11-25');
        const tools = (await client.listTools()).tools.map((t) => t.name).sort();
        expect(tools).toEqual(['decide_proposal', 'get_presence_summary', 'list_family_tasks', 'list_pending_proposals', 'list_why_cards', 'propose_visit', 'send_message_to_parent', 'suggest_coordination']);
        await client.close();
    });

    it('answers within the parent policy and records an assistant disclosure', async () => {
        await api('PUT', '/api/hearth/policy', { kiosk: ids.kiosk, body: { level: 'light' } });
        const { client } = await mcpClient(bearer);
        const r = await client.callTool({ name: 'get_presence_summary', arguments: {} });
        expect(r.structuredContent).toMatchObject({ level: 'light' });
        expect(r.structuredContent).not.toHaveProperty('timing');
        expect(r.structuredContent).not.toHaveProperty('events');
        expect((r.content as any)[0].text).toMatch(/cannot confirm that Margaret is safe/);
        const row = (await q(`SELECT actor_kind, actor_label, level, detail FROM trust_ledger WHERE circle_id = $1 AND actor_kind = 'assistant' AND action = 'disclosure'`, [ids.margaret])).rows[0];
        expect(row).toMatchObject({ actor_kind: 'assistant', actor_label: 'alex via Alexa+', level: 'light', detail: { channel: 'alexa', fields: 'status' } });
        await client.close();
    });

    it('validates arguments', async () => {
        const { client } = await mcpClient(bearer);
        const r = await client.callTool({ name: 'propose_visit', arguments: { start_time: 'not a date' } });
        expect(r.isError).toBe(true);
        const bad = await client.callTool({ name: 'decide_proposal', arguments: { proposal_id: 'nope', decision: 'approve' } });
        expect(bad.isError).toBe(true);
        await client.close();
    });

    it('never approves without the human: no elicitation, declined, then accepted', async () => {
        const taskId = (await q(`INSERT INTO tasks (circle_id, title) VALUES ($1, 'Laundry') RETURNING id`, [ids.margaret])).rows[0].id;
        const p = (await api('POST', '/api/hearth/proposals', { user: 'alex', circle: ids.margaret, body: { kind: 'assign_task', task_id: taskId, target_member_id: ids.alexM } })).body.data.id;
        const assigned = async () => (await q(`SELECT assigned_to FROM tasks WHERE id = $1`, [taskId])).rows[0].assigned_to;

        const plain = await mcpClient(bearer);
        const noElicit = await plain.client.callTool({ name: 'decide_proposal', arguments: { proposal_id: p, decision: 'approve' } });
        expect(noElicit.isError).toBe(true);
        expect(await assigned()).toEqual([]);
        await plain.client.close();

        const declining = await mcpClient(bearer, () => ({ action: 'decline' }));
        const declined = await declining.client.callTool({ name: 'decide_proposal', arguments: { proposal_id: p, decision: 'approve' } });
        expect(declined.structuredContent).toMatchObject({ changed: false });
        expect(await assigned()).toEqual([]);
        await declining.client.close();

        const asked: string[] = [];
        const accepting = await mcpClient(bearer, (m) => { asked.push(m); return { action: 'accept', content: { confirm: true } }; });
        const done = await accepting.client.callTool({ name: 'decide_proposal', arguments: { proposal_id: p, decision: 'approve' } });
        expect(done.structuredContent).toMatchObject({ changed: true, status: 'approved' });
        expect(asked[0]).toMatch(/^Approve "Take on: Laundry"\?$/);
        expect(await assigned()).toEqual([ids.alexM]);
        await accepting.client.close();
    });

    it('a revoked token stops working', async () => {
        const list = await api('GET', '/api/hearth/assistant-tokens', { user: 'alex', circle: ids.margaret });
        await api('DELETE', `/api/hearth/assistant-tokens/${list.body.data[0].id}`, { user: 'alex', circle: ids.margaret });
        await expect(mcpClient(bearer)).rejects.toThrow();
    });
});

describe('Ask Hearth on Amazon Bedrock', () => {
    type Fake = { calls: any[]; send: (cmd: any) => Promise<any> };
    let ask: typeof import('../../server/src/lib/hearth/askHearth');
    const scripted = (steps: Array<(input: any) => any>): Fake => {
        const fake: Fake = { calls: [], send: async (cmd: any) => { fake.calls.push(cmd.input); const step = steps.shift(); if (!step) throw new Error('no more steps'); return step(cmd.input); } };
        return fake;
    };

    beforeAll(async () => {
        ask = await import('../../server/src/lib/hearth/askHearth');
        await api('PUT', '/api/hearth/policy', { kiosk: ids.kiosk, body: { level: 'light' } });
    });

    it('without a model configured, answers from the deterministic status and says so', async () => {
        delete process.env.HEARTH_BEDROCK_MODEL_ID;
        const r = await api('POST', '/api/hearth/ask', { user: 'sam', circle: ids.margaret, body: { question: 'How is Mom this morning?' } });
        expect(r.body.data).toMatchObject({ mode: 'fallback', model: null });
        expect(r.body.data.note).toMatch(/not configured/);
        expect(r.body.data.answer).toMatch(/cannot confirm that Margaret is safe/);
    });

    it('runs the Converse tool loop, and the model only receives what the parent shares', async () => {
        process.env.HEARTH_BEDROCK_MODEL_ID = 'global.amazon.nova-2-lite-v1:0';
        const fake = scripted([
            () => ({ stopReason: 'tool_use', output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 't1', name: 'get_presence_summary', input: {} } }] } } }),
            () => ({ stopReason: 'end_turn', output: { message: { role: 'assistant', content: [{ text: 'Margaret shares a simple status only. Hearth sees no activity yet; a call would be a kind check-in.' }] } } }),
        ]);
        ask.setBedrockClient(fake);
        const r = await api('POST', '/api/hearth/ask', { user: 'sam', circle: ids.margaret, body: { question: 'How is Mom this morning?' } });
        expect(r.body.data).toMatchObject({ mode: 'bedrock', model: 'global.amazon.nova-2-lite-v1:0', tools_used: ['get_presence_summary'] });

        // First request: the system prompt, tools, and no data yet.
        expect(fake.calls[0].modelId).toBe('global.amazon.nova-2-lite-v1:0');
        expect(fake.calls[0].toolConfig.tools.map((t: any) => t.toolSpec.name)).not.toContain('decide_proposal');
        // Second request carries the tool result: at Light there are no timings or events in it.
        const toolResult = fake.calls[1].messages.flatMap((m: any) => m.content).find((c: any) => c.toolResult).toolResult.content[0].json;
        expect(toolResult.level).toBe('light');
        expect(toolResult).not.toHaveProperty('timing');
        expect(toolResult).not.toHaveProperty('events');

        const rows = (await q(`SELECT action, detail FROM trust_ledger WHERE circle_id = $1 AND actor_label = 'sam via Ask Hearth' ORDER BY created_at`, [ids.margaret])).rows;
        expect(rows.map((x) => x.action)).toEqual(expect.arrayContaining(['disclosure', 'ask_hearth']));
        expect(rows.filter((x) => x.action === 'ask_hearth').at(-1).detail).toMatchObject({ mode: 'bedrock', tools: 'get_presence_summary' });
        expect(JSON.stringify(rows)).not.toMatch(/How is Mom/); // the question itself is never stored
    });

    it('falls back honestly when Bedrock refuses (e.g. account still being verified)', async () => {
        const denied = Object.assign(new Error('Your account is currently being verified'), { name: 'AccessDeniedException' });
        ask.setBedrockClient({ send: async () => { throw denied; } });
        const r = await api('POST', '/api/hearth/ask', { user: 'sam', circle: ids.margaret, body: { question: 'Anything I should know?' } });
        expect(r.body.data.mode).toBe('fallback');
        expect(r.body.data.note).toMatch(/AccessDeniedException/);
    });

    it('weather is the only outside lookup, and it sends only coordinates', async () => {
        await q(`UPDATE care_circles SET settings = settings || '{"hearth_location":{"name":"Portland, Oregon","lat":45.523,"lon":-122.676}}'::jsonb WHERE id = $1`, [ids.margaret]);
        const urls: string[] = [];
        const realFetch = globalThis.fetch;
        globalThis.fetch = (async (url: any, init?: any) => {
            if (String(url).startsWith('https://api.open-meteo.com/')) {
                urls.push(String(url));
                return new Response(JSON.stringify({ current: { temperature_2m: 31, apparent_temperature: 33, weather_code: 0 }, daily: { temperature_2m_max: [34], temperature_2m_min: [19] } }), { status: 200 });
            }
            return realFetch(url, init);
        }) as typeof fetch;
        try {
            const w = await ask.localWeather(ids.margaret);
            expect(w).toMatchObject({ available: true, city: 'Portland, Oregon', temperature_c: 31, source: 'open-meteo.com' });
            expect(urls).toHaveLength(1);
            expect(urls[0]).toMatch(/latitude=45\.523&longitude=-122\.676/);
            expect(urls[0]).not.toMatch(/Margaret|Portland/);
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    it('rejects empty or oversized questions', async () => {
        expect((await api('POST', '/api/hearth/ask', { user: 'sam', circle: ids.margaret, body: { question: '' } })).status).toBe(400);
        expect((await api('POST', '/api/hearth/ask', { user: 'sam', circle: ids.margaret, body: { question: 'x'.repeat(501) } })).status).toBe(400);
        expect((await api('POST', '/api/hearth/ask', { user: 'pat', circle: ids.margaret, body: { question: 'hi' } })).status).toBe(403);
        ask.setBedrockClient(null);
        delete process.env.HEARTH_BEDROCK_MODEL_ID;
    });
});


describe('Ring Partner API', () => {
    const KEY = 'ring-test-signing-key';
    const TOKEN = 'playground-token-0123456789abcdef';
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const at = (h: number) => new Date(2026, 9, 22, h, 0).getTime();
    const fakeRing = (status = 200) => (async (input: any, init?: any) => {
        const url = String(input);
        calls.push({ url, headers: init?.headers ?? {} });
        if (status !== 200) return json(status, { errors: [] });
        if (url.endsWith('/v1/devices')) return json(200, { data: [{ type: 'devices', id: 'ava1.ring.device.D1', attributes: { name: 'Front Door' } }] });
        if (url.endsWith('/v1/users/me')) return json(200, { data: { type: 'users', id: 'ava1.ring.account.RUTH' } });
        if (url.includes('page[key]')) return json(200, { data: [{ id: 'ev3', attributes: { event_type: 'motion', start: at(7) } }] });
        return json(200, {
            data: [{ id: 'ev1', attributes: { event_type: 'on_demand', start: at(9) } }, { id: 'ev2', attributes: { event_type: 'ding', start: at(8) } }],
            links: { next: '/v1/history/devices/ava1.ring.device.D1/events?page[key]=2026-10-22T00:00:00Z' },
        });
    }) as typeof fetch;
    const webhook = (body: string, signature?: string) => fetch(`${base}/api/ring/webhook`, {
        method: 'POST', body,
        headers: { 'Content-Type': 'application/json', ...(signature ? { 'X-Signature': signature } : {}) },
    });
    const signed = (payload: unknown) => {
        const body = JSON.stringify(payload);
        return webhook(body, `sha256=${crypto.createHmac('sha256', KEY).update(body).digest('hex')}`);
    };
    const event = (type: string, requestId: string, attrs: Record<string, unknown> = {}, account = 'ava1.ring.account.RUTH') => ({
        meta: { version: '1.1', time: new Date().toISOString(), request_id: requestId, account_id: account },
        data: { id: `ava1.ring.device.D1_${type}`, type, attributes: { source: 'ava1.ring.device.D1', source_type: 'devices', timestamp: at(10), ...attrs } },
    });
    let ring: typeof import('../../server/src/lib/hearth/ring');

    beforeAll(async () => {
        ring = await import('../../server/src/lib/hearth/ring');
        process.env.RING_HMAC_SIGNING_KEY = KEY;
    });
    afterAll(() => {
        ring.setRingFetch(null);
        delete process.env.RING_HMAC_SIGNING_KEY;
    });

    it('imports the door rhythm from event history, idempotently, without storing the token', async () => {
        ring.setRingFetch(fakeRing());
        const first = await api('POST', '/api/ring/sync', { user: 'eve', circle: ids.ruth, body: { access_token: TOKEN, playground: true } });
        expect(first.status).toBe(200);
        expect(first.body.data).toMatchObject({ imported: 2, seen: 3, account_linked: true, devices: [{ name: 'Front Door' }] });
        // Required Ring headers on every call; the history call filters by type.
        for (const c of calls) expect(c.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'Hearth/1.0' });
        expect(calls.every((c) => /^[0-9a-f-]{36}$/.test(c.headers.Hardware_Id))).toBe(true);
        expect(calls.some((c) => c.url.includes('event_types=motion,on_demand'))).toBe(true);

        const rows = (await q(`SELECT source, kind, provenance, simulated FROM presence_signals WHERE circle_id = $1 ORDER BY occurred_at`, [ids.ruth])).rows;
        expect(rows).toEqual([
            { source: 'Ring Front Door', kind: 'motion', provenance: 'ring_playground', simulated: true },
            { source: 'Ring Front Door', kind: 'motion', provenance: 'ring_playground', simulated: true },
        ]); // the doorbell press (ding) is a visitor, not her rhythm

        const again = await api('POST', '/api/ring/sync', { user: 'eve', circle: ids.ruth, body: { access_token: TOKEN, playground: true } });
        expect(again.body.data.imported).toBe(0);

        const stored = JSON.stringify((await q(`SELECT settings FROM care_circles WHERE id = $1`, [ids.ruth])).rows[0].settings);
        expect(stored).not.toContain(TOKEN);
        const ledger = (await q(`SELECT detail FROM trust_ledger WHERE circle_id = $1 AND action = 'ring_sync'`, [ids.ruth])).rows;
        expect(ledger).toHaveLength(2);
        expect(JSON.stringify(ledger)).not.toContain(TOKEN);

        const status = await api('GET', '/api/ring/status', { user: 'eve', circle: ids.ruth });
        expect(status.body.data).toMatchObject({ devices: ['Front Door'], account_linked: true, playground: true, webhooks_enabled: true });
    });

    it('only admins connect Ring, and an expired token gets a plain answer', async () => {
        expect((await api('POST', '/api/ring/sync', { user: 'sam', circle: ids.margaret, body: { access_token: TOKEN } })).status).toBe(403);
        expect((await api('POST', '/api/ring/sync', { user: 'eve', circle: ids.ruth, body: { access_token: 'short' } })).status).toBe(400);
        ring.setRingFetch(fakeRing(401));
        const expired = await api('POST', '/api/ring/sync', { user: 'eve', circle: ids.ruth, body: { access_token: TOKEN } });
        expect(expired.status).toBe(502);
        expect(expired.body.error).toMatch(/30 minutes/);
    });

    it('webhooks: signature first, one row per delivery, visitors and vehicles ignored', async () => {
        const count = async () => (await q(`SELECT COUNT(*)::int AS n FROM presence_signals WHERE circle_id = $1`, [ids.ruth])).rows[0].n;
        const before = await count();

        const body = JSON.stringify(event('motion_detected', 'r-1', { sub_type: 'human' }));
        expect((await webhook(body)).status).toBe(401);
        expect((await webhook(body, 'sha256=' + '0'.repeat(64))).status).toBe(401);
        expect(await count()).toBe(before);

        const ok = await signed(event('motion_detected', 'r-1', { sub_type: 'human' }));
        expect(ok.status).toBe(200);
        expect((await ok.json() as any).stored).toBe(true);
        const retry = await signed(event('motion_detected', 'r-1', { sub_type: 'human' }));
        expect((await retry.json() as any).stored).toBe(false);

        expect((await (await signed(event('contact_sensor_faulted', 'r-2'))).json() as any).stored).toBe(true);
        for (const [type, id, attrs] of [['motion_detected', 'r-3', { sub_type: 'vehicle' }], ['button_press', 'r-4', {}]] as const) {
            const r = await signed(event(type, id, attrs));
            expect(r.status).toBe(200);
            expect((await r.json() as any).stored).toBe(false);
        }
        const unknown = await signed(event('motion_detected', 'r-5', {}, 'ava1.ring.account.NOBODY'));
        expect(unknown.status).toBe(200);
        expect(await count()).toBe(before + 2);

        const live = (await q(`SELECT kind, provenance, simulated, confidence FROM presence_signals WHERE circle_id = $1 AND provenance = 'ring' ORDER BY kind`, [ids.ruth])).rows;
        expect(live).toEqual([
            { kind: 'door', provenance: 'ring', simulated: false, confidence: null },
            { kind: 'motion', provenance: 'ring', simulated: false, confidence: '0.80' },
        ]);
    });
});
