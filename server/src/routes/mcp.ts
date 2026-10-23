import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { query } from '../db';
import logger from '../lib/logger';
import { broadcastToCircle } from '../lib/broadcaster';
import { toLocalISO } from './events';
import { Actor } from '../lib/hearth/policy';
import {
    HEARTH_VIEWER_ROLES, HearthError, createProposal, decideProposal, listProposals, memberActor,
    presenceViewFor, recordLedger, withTransaction,
} from '../lib/hearth/store';
import { suggestProposals } from './hearth';

/**
 * Hearth for Alexa+: a self-hosted MCP server over Streamable HTTP (spec
 * 2025-11-25, via @modelcontextprotocol/sdk). Mounted at /mcp.
 *
 * Authentication: `Authorization: Bearer hth_...`, a token a family member
 * creates in Hearth (Settings > Alexa+). It acts as that member: same circle,
 * same role checks, same sharing policy, and every presence answer is written
 * to the Trust Ledger as an assistant disclosure.
 *
 * Consequential actions (approving or rejecting a proposal) ask the human
 * through MCP elicitation. A client that cannot elicit gets an error telling
 * the user to decide in the Hearth app: the model can never approve alone.
 */

interface McpIdentity { circleId: string; userId: string; memberId: string; role: string; tokenId: string }

const SESSION_IDLE_MS = 30 * 60 * 1000;
const sessions = new Map<string, { transport: StreamableHTTPServerTransport; tokenId: string; lastSeen: number }>();

async function resolveIdentity(req: Request): Promise<McpIdentity | null> {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!/^hth_[a-f0-9]{64}$/.test(token)) return null;
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    // The member must still belong to the circle with a role that may see Hearth.
    const { rows } = await query(
        `UPDATE assistant_tokens t SET last_used_at = NOW()
         FROM circle_members m
         WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND m.circle_id = t.circle_id AND m.user_id = t.user_id
         RETURNING t.id, t.circle_id, t.user_id, m.id AS member_id, m.role`,
        [hash]
    );
    const r = rows[0];
    if (!r || !HEARTH_VIEWER_ROLES.includes(r.role)) return null;
    return { circleId: r.circle_id, userId: r.user_id, memberId: r.member_id, role: r.role, tokenId: r.id };
}

const ok = (text: string, structured: Record<string, unknown>): CallToolResult =>
    ({ content: [{ type: 'text', text }], structuredContent: structured });
const toolError = (text: string): CallToolResult => ({ content: [{ type: 'text', text }], isError: true });

function buildServer(id: McpIdentity): McpServer {
    const server = new McpServer(
        { name: 'hearth', title: 'Hearth: family presence', version: '1.0.0' },
        {
            instructions:
                'Hearth shares what an aging parent has chosen to share with their family. Answers are filtered by the parent\'s '
                + 'sharing level; never imply more certainty than the tool returns. Hearth is not an emergency service: for an '
                + 'emergency, tell the user to call their local emergency number.',
        }
    );
    const actor = (): Promise<Actor> => memberActor(id.userId, id.memberId, id.role, 'assistant');
    const isCoordinator = id.role === 'admin' || id.role === 'family';

    server.registerTool('get_presence_summary', {
        title: 'Presence summary',
        description: 'The parent\'s current presence status, as much detail as the parent chose to share (light, rhythm, glimpse or recovery). Includes a safety disclaimer that must be relayed.',
        annotations: { readOnlyHint: true, openWorldHint: false },
    }, async () => {
        const { view } = await presenceViewFor(id.circleId, await actor(), 'alexa');
        const { why_cards: _cards, ...summary } = view;
        const sim = view.simulated ? ' (Note: this uses simulated demo data.)' : '';
        return ok(`${view.headline}. ${view.summary} ${view.disclaimer}${sim}`, summary as unknown as Record<string, unknown>);
    });

    server.registerTool('list_why_cards', {
        title: 'Why Cards',
        description: 'Explanations of notable changes in the parent\'s routine: what was observed, the evidence, confidence and one suggested next step.',
        annotations: { readOnlyHint: true, openWorldHint: false },
    }, async () => {
        const { view } = await presenceViewFor(id.circleId, await actor(), 'alexa');
        const text = view.why_cards.length
            ? view.why_cards.map((c) => `${c.title}: ${c.observed} Suggested: ${c.next_step}${c.provenance === 'simulated' ? ' (simulated data)' : ''}`).join('\n')
            : 'Nothing needs explaining right now.';
        return ok(text, { level: view.level, state: view.state, why_cards: view.why_cards });
    });

    server.registerTool('list_family_tasks', {
        title: 'Family responsibilities',
        description: 'Open family tasks and who has taken each one on.',
        inputSchema: { limit: z.number().int().min(1).max(25).optional() },
        annotations: { readOnlyHint: true, openWorldHint: false },
    }, async ({ limit }) => {
        const { rows } = await query(
            `SELECT t.id, t.title, t.due_date,
                    COALESCE((SELECT json_agg(u.name) FROM circle_members m JOIN users u ON u.id = m.user_id
                              WHERE m.circle_id = t.circle_id AND t.assigned_to @> to_jsonb(m.id::text)), '[]') AS assignees
             FROM tasks t WHERE t.circle_id = $1 AND t.is_completed = FALSE
             ORDER BY t.due_date ASC NULLS LAST LIMIT $2`,
            [id.circleId, limit ?? 10]
        );
        const text = rows.length
            ? rows.map((t: any) => `${t.title}${t.due_date ? ` (due ${String(t.due_date).slice(0, 10)})` : ''}: ${t.assignees.length ? t.assignees.join(', ') : 'nobody yet'}`).join('\n')
            : 'There are no open family tasks.';
        return ok(text, { tasks: rows });
    });

    server.registerTool('list_pending_proposals', {
        title: 'Pending proposals',
        description: 'Coordination proposals (visits, errands, check-ins) waiting for a person to approve or reject. Nothing in them has happened yet.',
        annotations: { readOnlyHint: true, openWorldHint: false },
    }, async () => {
        const pending = (await listProposals(id.circleId)).filter((p: any) => p.status === 'pending');
        const text = pending.length
            ? pending.map((p: any) => `[${p.id}] ${p.title}${p.target_name ? ` (for ${p.target_name})` : ''}`).join('\n')
            : 'No proposals are waiting.';
        return ok(text, { proposals: pending });
    });

    server.registerTool('propose_visit', {
        title: 'Propose a visit',
        description: 'Propose that the user visits the parent at a given time. This only creates a proposal; the user confirms it in Hearth (or with decide_proposal) before anything is added to the calendar.',
        inputSchema: {
            start_time: z.string().describe('Local date and time of the visit, ISO 8601, e.g. 2026-10-24T10:00'),
            title: z.string().min(1).max(200).optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async ({ start_time, title }) => {
        if (!isCoordinator) return toolError('Your role in this family circle cannot propose visits.');
        const start = new Date(start_time);
        if (Number.isNaN(start.getTime()) || start <= new Date()) return toolError('start_time must be a valid date and time in the future.');
        const row = await createProposal(id.circleId, await actor(), {
            kind: 'visit', title: title ?? 'Visit', rationale: 'Proposed through Alexa+.',
            payload: { start_time: toLocalISO(start) }, target_member_id: id.memberId,
        });
        await broadcastToCircle(id.circleId, { type: 'update', entity: 'hearth', action: 'created' });
        return ok(`Proposed: ${row.title} on ${toLocalISO(start).replace('T', ' at ').slice(0, 19)}. It is not on the calendar until you confirm it.`, { proposal: row });
    });

    server.registerTool('suggest_coordination', {
        title: 'Suggest coordination',
        description: 'Run the Piggyback Planner: find errands that fit an upcoming visit and suggest a check-in call when the routine looks unusual. Creates pending proposals only.',
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async () => {
        if (!isCoordinator) return toolError('Your role in this family circle cannot create proposals.');
        const created = await suggestProposals(id.circleId, await actor());
        if (created.length) await broadcastToCircle(id.circleId, { type: 'update', entity: 'hearth', action: 'created' });
        return ok(created.length ? created.map((p: any) => `[${p.id}] ${p.title}`).join('\n') : 'No new suggestions.', { created });
    });

    server.registerTool('decide_proposal', {
        title: 'Approve or reject a proposal',
        description: 'Approve or reject a pending proposal. The user is always asked to confirm through the client before anything changes.',
        inputSchema: { proposal_id: z.string().uuid(), decision: z.enum(['approve', 'reject']) },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    }, async ({ proposal_id, decision }) => {
        if (!isCoordinator) return toolError('Your role in this family circle cannot decide proposals.');
        const { rows } = await query(`SELECT title FROM hearth_proposals WHERE id = $1 AND circle_id = $2 AND status = 'pending'`, [proposal_id, id.circleId]);
        if (!rows[0]) return toolError('That proposal does not exist or was already decided.');
        if (!server.server.getClientCapabilities()?.elicitation) {
            return toolError('This assistant cannot ask you to confirm, so nothing was changed. Please approve or reject it in the Hearth app.');
        }
        const answer = await server.server.elicitInput({
            mode: 'form',
            message: `${decision === 'approve' ? 'Approve' : 'Reject'} "${rows[0].title}"?`,
            requestedSchema: { type: 'object', properties: { confirm: { type: 'boolean', title: 'Confirm', description: 'Yes, go ahead' } }, required: ['confirm'] },
        });
        if (answer.action !== 'accept' || answer.content?.confirm !== true) {
            return ok('Not confirmed, so nothing was changed.', { changed: false });
        }
        try {
            const result = await decideProposal(id.circleId, proposal_id, (await memberActor(id.userId, id.memberId, id.role)) as Extract<Actor, { kind: 'member' }>, decision);
            await broadcastToCircle(id.circleId, { type: 'update', entity: 'hearth', action: 'updated' });
            if (result.status === 'expired') return toolError('That proposal had expired, so nothing was changed.');
            return ok(`Done: the proposal was ${result.status}.`, { changed: true, ...result });
        } catch (error) {
            if (error instanceof HearthError) return toolError(`Nothing was changed (${error.code}).`);
            throw error;
        }
    });

    server.registerTool('send_message_to_parent', {
        title: 'Send a message to the parent',
        description: 'Share a short message that appears on the parent\'s Hearth screen as a family moment. Not delivered to a TV.',
        inputSchema: { message: z.string().min(1).max(500) },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, async ({ message }) => {
        if (!isCoordinator) return toolError('Your role in this family circle cannot send moments.');
        const who = await actor();
        const row = await withTransaction(async (c) => {
            const { rows } = await c.query(
                `INSERT INTO hearth_moments (circle_id, author_user_id, kind, message) VALUES ($1, $2, 'message', $3) RETURNING id, created_at`,
                [id.circleId, id.userId, message.trim()]
            );
            await recordLedger(c, id.circleId, who, { action: 'moment_shared', category: 'moments', detail: { moment_id: rows[0].id, kind: 'message' } });
            return rows[0];
        });
        await broadcastToCircle(id.circleId, { type: 'update', entity: 'hearth', action: 'created' });
        return ok('Your message will appear on the Hearth screen. TV delivery is not available.', { moment_id: row.id, tv_delivery: 'unavailable' });
    });

    return server;
}

const unauthorized = (res: Response) =>
    res.status(401).set('WWW-Authenticate', 'Bearer realm="hearth"').json({
        jsonrpc: '2.0', error: { code: -32001, message: 'Missing or invalid Hearth assistant token' }, id: null,
    });

export function mountMcp(app: Express): void {
    // Idle sessions are dropped; the client simply initializes again.
    setInterval(() => {
        const cutoff = Date.now() - SESSION_IDLE_MS;
        for (const [sid, s] of sessions) if (s.lastSeen < cutoff) { void s.transport.close(); sessions.delete(sid); }
    }, 5 * 60 * 1000).unref();

    const handle = async (req: Request, res: Response) => {
        try {
            const id = await resolveIdentity(req);
            if (!id) return unauthorized(res);
            const sid = req.headers['mcp-session-id'];
            const existing = typeof sid === 'string' ? sessions.get(sid) : undefined;
            if (existing) {
                // A session is bound to the token that opened it.
                if (existing.tokenId !== id.tokenId) return unauthorized(res);
                existing.lastSeen = Date.now();
                return await existing.transport.handleRequest(req, res, req.body);
            }
            if (req.method !== 'POST' || !isInitializeRequest(req.body)) {
                return res.status(typeof sid === 'string' ? 404 : 400).json({
                    jsonrpc: '2.0', error: { code: -32000, message: typeof sid === 'string' ? 'Session not found' : 'Initialize first' }, id: null,
                });
            }
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: () => crypto.randomUUID(),
                onsessioninitialized: (newSid) => { sessions.set(newSid, { transport, tokenId: id.tokenId, lastSeen: Date.now() }); },
            });
            transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
            await buildServer(id).connect(transport);
            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            logger.error('mcp.request_error', { error: error instanceof Error ? error.message : String(error) });
            if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
        }
    };
    app.post('/mcp', handle);
    app.get('/mcp', handle);
    app.delete('/mcp', handle);
}
