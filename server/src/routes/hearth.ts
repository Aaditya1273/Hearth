import { Router, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { query } from '../db';
import { authMiddleware } from '../middleware/auth';
import { circleMiddleware, requireRole, CircleRequest, CircleRole } from '../middleware/circle';
import { kioskOrMember, requireDevice, KioskRequest } from '../middleware/kioskDevice';
import { broadcastToCircle } from '../lib/broadcaster';
import { expandEventOccurrences, toLocalISO } from './events';
import logger from '../lib/logger';
import {
    Actor, ParentPreferences, SharingLevel, applyPolicyChange, canChooseDelegate, canManagePreferences,
    effectivePreferences, parsePolicyChange,
} from '../lib/hearth/policy';
import { findPiggybacks, OpenTask, UpcomingVisit } from '../lib/hearth/proposals';
import { SIM_SCENARIOS, SimScenario } from '../lib/hearth/simulator';
import { askHearth, MAX_QUESTION_CHARS } from '../lib/hearth/askHearth';
import {
    HEARTH_VIEWER_ROLES, HearthError, pool, createProposal, currentPreferences, decideProposal, listLedger, listMoments, listProposals,
    loadPreferences, loadSimulation, memberActor, parentActor, presenceViewFor, recordLedger, withTransaction,
    writePreferences,
} from '../lib/hearth/store';

// Hearth: family presence with parent-controlled sharing. Mounted on /api/hearth.
// Two identities reach these routes: the parent's paired device (X-Kiosk-Token)
// and circle members (session + X-Circle-Id). The sharing policy is enforced in
// lib/hearth/store.presenceViewFor, the only path to presence data.
const router = Router();

const COORDINATOR_ROLES: CircleRole[] = ['admin', 'family'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIDEO_DATA_URL_RE = /^data:video\/(mp4|webm);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_VIDEO_CHARS = 6 * 1024 * 1024;
const MAX_AWAY_DAYS = 30;

const LEVEL_SUMMARY: Record<SharingLevel, string> = {
    light: 'Your family now sees only a simple status, like "normal pattern" or "not enough data".',
    rhythm: 'Your family now sees the status and timing summaries, like when your day started.',
    glimpse: 'Your family now sees the status, timings and short descriptions like "kitchen: movement".',
    recovery: 'Recovery is on. Your family sees what you chose, until the end date. Then it goes back automatically.',
};

const deviceOrRoles = (...roles: CircleRole[]) => (req: KioskRequest, res: Response, next: NextFunction) =>
    req.kioskDevice ? next() : requireRole(...roles)(req, res, next);
const membersOnly = [authMiddleware, circleMiddleware];

async function actorOf(req: KioskRequest): Promise<Actor> {
    if (req.kioskDevice) return parentActor(req.kioskDevice);
    return memberActor(req.userId!, req.memberId!, req.circleRole!);
}

const iso = (d: Date | null): string | null => (d ? toLocalISO(d) : null);
const publicPolicy = (p: ParentPreferences) => ({
    level: p.level,
    previous_level: p.previous_level,
    recovery_until: iso(p.recovery_until),
    recovery_extras: p.recovery_extras,
    delegate_member_id: p.delegate_member_id,
    away_until: iso(p.away_until),
});

const fail = (res: Response, error: unknown, where: string) => {
    if (error instanceof HearthError) return res.status(error.status).json({ success: false, error: error.code });
    logger.error(`hearth.${where}_error`, { error: error instanceof Error ? error.message : String(error) });
    return res.status(500).json({ success: false, error: 'Internal server error' });
};

// ─── Shared loaders ───────────────────────────────────────────────────────────

async function upcomingVisits(circleId: string, now: Date, days = 7) {
    const end = new Date(now.getTime() + days * 86400000);
    const [events, members] = await Promise.all([
        query(
            `SELECT id, title, start_time, end_time, rrule, exceptions, member_ids FROM events
             WHERE circle_id = $1 AND category = 'visit' AND (rrule IS NOT NULL OR start_time <= $3) AND (rrule IS NOT NULL OR COALESCE(end_time, start_time) >= $2)`,
            [circleId, now, end]
        ),
        query('SELECT m.id, u.name FROM circle_members m JOIN users u ON u.id = m.user_id WHERE m.circle_id = $1', [circleId]),
    ]);
    const nameById = new Map(members.rows.map((m: any) => [m.id, m.name as string]));
    const out: Array<{ id: string; title: string; start_time: string; end_time: string | null; member_ids: string[]; members: string[] }> = [];
    for (const ev of events.rows as any[]) {
        const ids: string[] = Array.isArray(ev.member_ids) ? ev.member_ids : [];
        for (const occ of expandEventOccurrences(ev, now, end)) {
            out.push({
                id: ev.id, title: ev.title, start_time: toLocalISO(occ.start), end_time: occ.end ? toLocalISO(occ.end) : null,
                member_ids: ids, members: ids.map((id) => nameById.get(id)).filter((n): n is string => Boolean(n)),
            });
        }
    }
    return out.sort((a, b) => a.start_time.localeCompare(b.start_time)).slice(0, 10);
}

async function openResponsibilities(circleId: string) {
    const { rows } = await query(
        `SELECT t.id, t.title, t.category, t.due_date, t.assigned_to,
                COALESCE((SELECT json_agg(u.name) FROM circle_members m JOIN users u ON u.id = m.user_id
                          WHERE m.circle_id = t.circle_id AND t.assigned_to @> to_jsonb(m.id::text)), '[]') AS assignees
         FROM tasks t WHERE t.circle_id = $1 AND t.is_completed = FALSE
         ORDER BY t.due_date ASC NULLS LAST, t.created_at DESC LIMIT 12`,
        [circleId]
    );
    return rows;
}

// ─── Overview (family dashboard) ──────────────────────────────────────────────

router.get('/overview', ...membersOnly, requireRole(...HEARTH_VIEWER_ROLES), async (req: CircleRequest, res: Response) => {
    try {
        const now = new Date();
        const actor = await actorOf(req);
        const { view, prefs } = await presenceViewFor(req.circleId!, actor, 'app', now);
        const [visits, responsibilities, proposals, moments, recipient] = await Promise.all([
            upcomingVisits(req.circleId!, now),
            openResponsibilities(req.circleId!),
            listProposals(req.circleId!, now),
            listMoments(req.circleId!, 5),
            query('SELECT first_name, phone FROM care_recipients WHERE circle_id = $1', [req.circleId]),
        ]);
        res.json({
            success: true,
            data: {
                presence: view,
                policy: publicPolicy(prefs),
                can_manage_policy: canManagePreferences(actor, prefs),
                recipient: recipient.rows[0] ?? null,
                upcoming_visits: visits,
                responsibilities,
                proposals: proposals.filter((p: any) => p.status === 'pending'),
                recent_decisions: proposals.filter((p: any) => p.status !== 'pending').slice(0, 5),
                moments,
            },
        });
    } catch (error) {
        fail(res, error, 'overview');
    }
});

// ─── Ask Hearth (Amazon Bedrock) ──────────────────────────────────────────────

router.post('/ask', ...membersOnly, requireRole(...HEARTH_VIEWER_ROLES), async (req: CircleRequest, res: Response) => {
    try {
        const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
        if (!question || question.length > MAX_QUESTION_CHARS) {
            return res.status(400).json({ success: false, error: `question must be 1 to ${MAX_QUESTION_CHARS} characters` });
        }
        const actor = await actorOf(req) as Extract<Actor, { kind: 'member' }>;
        res.json({ success: true, data: await askHearth(req.circleId!, actor, question) });
    } catch (error) {
        fail(res, error, 'ask');
    }
});

// ─── Glimpse Dial ─────────────────────────────────────────────────────────────

router.get('/policy', kioskOrMember(), deviceOrRoles(...HEARTH_VIEWER_ROLES), async (req: KioskRequest, res: Response) => {
    try {
        const actor = await actorOf(req);
        const prefs = await currentPreferences(req.circleId!);
        const members = await query(
            `SELECT m.id, u.name, m.role FROM circle_members m JOIN users u ON u.id = m.user_id
             WHERE m.circle_id = $1 AND m.role IN ('admin', 'family') ORDER BY u.name`,
            [req.circleId]
        );
        res.json({
            success: true,
            data: {
                policy: publicPolicy(prefs),
                can_manage: canManagePreferences(actor, prefs),
                can_choose_delegate: canChooseDelegate(actor),
                delegate_candidates: req.kioskDevice ? members.rows : undefined,
            },
        });
    } catch (error) {
        fail(res, error, 'policy_get');
    }
});

router.put('/policy', kioskOrMember(), deviceOrRoles(...HEARTH_VIEWER_ROLES), async (req: KioskRequest, res: Response) => {
    try {
        const parsed = parsePolicyChange(req.body);
        if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });
        const actor = await actorOf(req);
        const now = new Date();
        const outcome = await withTransaction(async (c) => {
            const stored = await loadPreferences(c, req.circleId!, true);
            const { recovery_expired: _x, ...current } = effectivePreferences(stored, now);
            if (!canManagePreferences(actor, current)) return { denied: true as const, current };
            const next = applyPolicyChange(current, parsed.value, now);
            await writePreferences(c, req.circleId!, next);
            const ledgerId = await recordLedger(c, req.circleId!, actor, {
                action: 'policy_changed', category: 'sharing_policy', level: next.level,
                detail: { from: current.level, to: next.level, recovery_until: iso(next.recovery_until), recovery_extras: next.recovery_extras },
            });
            return { denied: false as const, next, ledgerId };
        });
        if (outcome.denied) {
            // The refusal itself is worth showing the parent.
            await recordLedger(pool, req.circleId!, actor, {
                action: 'policy_change_denied', category: 'sharing_policy', level: outcome.current.level,
                detail: { requested: parsed.value.level },
            });
            return res.status(403).json({ success: false, error: 'ONLY_PARENT_OR_DELEGATE' });
        }
        await broadcastToCircle(req.circleId!, { type: 'update', entity: 'hearth', action: 'updated' });
        res.json({
            success: true,
            data: { policy: publicPolicy(outcome.next), ledger_id: outcome.ledgerId, confirmation: LEVEL_SUMMARY[outcome.next.level] },
        });
    } catch (error) {
        fail(res, error, 'policy_put');
    }
});

router.put('/delegate', kioskOrMember(), requireDevice, async (req: KioskRequest, res: Response) => {
    try {
        const memberId = req.body?.member_id ?? null;
        if (memberId !== null && (typeof memberId !== 'string' || !UUID_RE.test(memberId))) {
            return res.status(400).json({ success: false, error: 'member_id must be a member id or null' });
        }
        if (memberId) {
            const ok = await query(`SELECT 1 FROM circle_members WHERE id = $1 AND circle_id = $2 AND role IN ('admin', 'family')`, [memberId, req.circleId]);
            if (!ok.rows.length) return res.status(400).json({ success: false, error: 'Delegate must be a family member of this circle' });
        }
        const actor = await actorOf(req);
        const now = new Date();
        const next = await withTransaction(async (c) => {
            const { recovery_expired: _x, ...current } = effectivePreferences(await loadPreferences(c, req.circleId!, true), now);
            const updated = { ...current, delegate_member_id: memberId };
            await writePreferences(c, req.circleId!, updated);
            await recordLedger(c, req.circleId!, actor, { action: 'delegate_changed', category: 'sharing_policy', level: current.level, detail: { delegate_member_id: memberId } });
            return updated;
        });
        await broadcastToCircle(req.circleId!, { type: 'update', entity: 'hearth', action: 'updated' });
        res.json({ success: true, data: { policy: publicPolicy(next) } });
    } catch (error) {
        fail(res, error, 'delegate');
    }
});

router.put('/away', kioskOrMember(), deviceOrRoles(...HEARTH_VIEWER_ROLES), async (req: KioskRequest, res: Response) => {
    try {
        const raw = req.body?.until ?? null;
        const now = new Date();
        let until: Date | null = null;
        if (raw !== null) {
            until = typeof raw === 'string' ? new Date(raw) : new Date(NaN);
            if (Number.isNaN(until.getTime()) || until <= now || until.getTime() - now.getTime() > MAX_AWAY_DAYS * 86400000) {
                return res.status(400).json({ success: false, error: `until must be a future date within ${MAX_AWAY_DAYS} days, or null` });
            }
        }
        const actor = await actorOf(req);
        const next = await withTransaction(async (c) => {
            const { recovery_expired: _x, ...current } = effectivePreferences(await loadPreferences(c, req.circleId!, true), now);
            if (!canManagePreferences(actor, current)) return null;
            const updated = { ...current, away_until: until };
            await writePreferences(c, req.circleId!, updated);
            await recordLedger(c, req.circleId!, actor, { action: 'away_changed', category: 'presence_status', level: current.level, detail: { away_until: iso(until) } });
            return updated;
        });
        if (!next) return res.status(403).json({ success: false, error: 'ONLY_PARENT_OR_DELEGATE' });
        await broadcastToCircle(req.circleId!, { type: 'update', entity: 'hearth', action: 'updated' });
        res.json({ success: true, data: { policy: publicPolicy(next) } });
    } catch (error) {
        fail(res, error, 'away');
    }
});

// ─── Trust Ledger ─────────────────────────────────────────────────────────────

router.get('/ledger', kioskOrMember(), deviceOrRoles(...HEARTH_VIEWER_ROLES), async (req: KioskRequest, res: Response) => {
    try {
        res.json({ success: true, data: await listLedger(req.circleId!, Number(req.query.limit) || 100) });
    } catch (error) {
        fail(res, error, 'ledger');
    }
});

// ─── Parent's own screen ──────────────────────────────────────────────────────

router.get('/kiosk', kioskOrMember(), requireDevice, async (req: KioskRequest, res: Response) => {
    try {
        const now = new Date();
        const actor = await actorOf(req);
        const { view, prefs } = await presenceViewFor(req.circleId!, actor, 'kiosk', now);
        const [moments, visits, ledger] = await Promise.all([
            listMoments(req.circleId!, 10), upcomingVisits(req.circleId!, now), listLedger(req.circleId!, 8),
        ]);
        res.json({ success: true, data: { policy: publicPolicy(prefs), presence: view, moments, upcoming_visits: visits, ledger } });
    } catch (error) {
        fail(res, error, 'kiosk');
    }
});

// ─── Proposals (Piggyback Planner) ────────────────────────────────────────────

router.get('/proposals', ...membersOnly, requireRole(...HEARTH_VIEWER_ROLES), async (req: CircleRequest, res: Response) => {
    try {
        res.json({ success: true, data: await listProposals(req.circleId!) });
    } catch (error) {
        fail(res, error, 'proposals_list');
    }
});

router.post('/proposals', ...membersOnly, requireRole(...COORDINATOR_ROLES), async (req: CircleRequest, res: Response) => {
    try {
        const b = (req.body ?? {}) as Record<string, unknown>;
        const target = typeof b.target_member_id === 'string' && UUID_RE.test(b.target_member_id) ? b.target_member_id : null;
        if (!target) return res.status(400).json({ success: false, error: 'target_member_id is required' });
        const member = await query(`SELECT 1 FROM circle_members WHERE id = $1 AND circle_id = $2 AND role IN ('admin', 'family')`, [target, req.circleId]);
        if (!member.rows.length) return res.status(400).json({ success: false, error: 'Target must be a family member of this circle' });

        const actor = await actorOf(req);
        if (b.kind === 'visit') {
            const title = typeof b.title === 'string' ? b.title.trim().slice(0, 200) : '';
            const start = typeof b.start_time === 'string' ? new Date(b.start_time) : new Date(NaN);
            if (!title || Number.isNaN(start.getTime()) || start <= new Date()) {
                return res.status(400).json({ success: false, error: 'A visit needs a title and a future start_time' });
            }
            const row = await createProposal(req.circleId!, actor, {
                kind: 'visit', title, rationale: typeof b.rationale === 'string' ? b.rationale.slice(0, 500) : '',
                payload: { start_time: toLocalISO(start) }, target_member_id: target,
            });
            return res.json({ success: true, data: row });
        }
        if (b.kind === 'assign_task') {
            const taskId = typeof b.task_id === 'string' && UUID_RE.test(b.task_id) ? b.task_id : null;
            const task = taskId ? await query('SELECT id, title FROM tasks WHERE id = $1 AND circle_id = $2 AND is_completed = FALSE', [taskId, req.circleId]) : null;
            if (!task?.rows.length) return res.status(400).json({ success: false, error: 'task_id must be an open task of this circle' });
            const row = await createProposal(req.circleId!, actor, {
                kind: 'assign_task', title: `Take on: ${task.rows[0].title}`, rationale: typeof b.rationale === 'string' ? b.rationale.slice(0, 500) : '',
                payload: { task_id: taskId }, target_member_id: target,
            });
            return res.json({ success: true, data: row });
        }
        res.status(400).json({ success: false, error: 'kind must be visit or assign_task' });
    } catch (error) {
        fail(res, error, 'proposals_create');
    }
});

/**
 * Piggyback Planner: look for errands that overlap a planned visit, and for a
 * check-in when today's pattern is unusual. Only creates pending proposals.
 */
export async function suggestProposals(circleId: string, actor: Actor, now = new Date()) {
    const [tasks, visits, { view, name }] = await Promise.all([
        query(`SELECT id, title, due_date, assigned_to FROM tasks WHERE circle_id = $1 AND is_completed = FALSE`, [circleId]),
        upcomingVisits(circleId, now),
        presenceViewFor(circleId, actor, 'planner', now),
    ]);
    const open: OpenTask[] = tasks.rows.map((t: any) => ({
        id: t.id, title: t.title, due_date: t.due_date ? new Date(String(t.due_date)) : null,
        assigned_to: Array.isArray(t.assigned_to) ? t.assigned_to : [],
    }));
    const upcoming: UpcomingVisit[] = visits.map((v) => ({ id: v.id, title: v.title, start_time: new Date(v.start_time), member_ids: v.member_ids }));
    const created: unknown[] = [];
    for (const m of findPiggybacks(open, upcoming, now)) {
        const visit = visits.find((v) => v.id === m.visit.id)!;
        const who = visit.members[0] ?? 'A family member';
        const row = await createProposal(circleId, actor, {
            kind: 'assign_task',
            title: `${who} could take care of "${m.task.title}" during their visit`,
            rationale: `${who} is visiting on ${visit.start_time.slice(0, 10)} at ${visit.start_time.slice(11, 16)}. "${m.task.title}" is ${m.task.due_date ? `due ${toLocalISO(m.task.due_date).slice(0, 10)}` : 'not scheduled yet'}.`,
            payload: { task_id: m.task.id, visit_event_id: m.visit.id }, target_member_id: m.member_id, dedupe_key: m.dedupe_key,
        }, now);
        if (row) created.push(row);
    }
    if (view.state === 'unusual' || view.state === 'signal_unavailable') {
        const card = view.why_cards[0];
        const who = name || 'your parent';
        const row = await createProposal(circleId, actor, {
            kind: 'check_in',
            title: `Call ${who} to check in`,
            rationale: card ? `${card.title}. ${card.observed}` : view.summary,
            payload: { why_card_id: card?.id ?? null }, target_member_id: null, dedupe_key: `check_in:${toLocalISO(now).slice(0, 10)}`,
        }, now);
        if (row) created.push(row);
    }
    return created;
}

router.post('/proposals/suggest', ...membersOnly, requireRole(...COORDINATOR_ROLES), async (req: CircleRequest, res: Response) => {
    try {
        const created = await suggestProposals(req.circleId!, await actorOf(req));
        if (created.length) await broadcastToCircle(req.circleId!, { type: 'update', entity: 'hearth', action: 'created' });
        res.json({ success: true, data: created });
    } catch (error) {
        fail(res, error, 'proposals_suggest');
    }
});

router.post('/proposals/:id/decision', ...membersOnly, requireRole(...COORDINATOR_ROLES), async (req: CircleRequest, res: Response) => {
    try {
        const decision = req.body?.decision;
        if (decision !== 'approve' && decision !== 'reject') return res.status(400).json({ success: false, error: 'decision must be approve or reject' });
        if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'PROPOSAL_NOT_FOUND' });
        const actor = await actorOf(req) as Extract<Actor, { kind: 'member' }>;
        const result = await decideProposal(req.circleId!, req.params.id, actor, decision);
        await broadcastToCircle(req.circleId!, { type: 'update', entity: 'hearth', action: 'updated' });
        if (result.status === 'expired') return res.status(409).json({ success: false, error: 'PROPOSAL_EXPIRED' });
        if (result.status === 'approved') {
            await broadcastToCircle(req.circleId!, { type: 'update', entity: result.kind === 'visit' ? 'events' : 'tasks', action: 'updated' });
        }
        res.json({ success: true, data: result });
    } catch (error) {
        fail(res, error, 'proposals_decide');
    }
});

// ─── Hearth Moments ───────────────────────────────────────────────────────────

router.get('/moments', kioskOrMember(), deviceOrRoles(...HEARTH_VIEWER_ROLES), async (req: KioskRequest, res: Response) => {
    try {
        res.json({ success: true, data: await listMoments(req.circleId!, 30) });
    } catch (error) {
        fail(res, error, 'moments_list');
    }
});

router.get('/moments/:id/media', kioskOrMember(), deviceOrRoles(...HEARTH_VIEWER_ROLES), async (req: KioskRequest, res: Response) => {
    try {
        if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
        const { rows } = await query('SELECT media_data_url FROM hearth_moments WHERE id = $1 AND circle_id = $2', [req.params.id, req.circleId]);
        if (!rows[0]?.media_data_url) return res.status(404).json({ success: false, error: 'Not found' });
        res.json({ success: true, data: { media_data_url: rows[0].media_data_url } });
    } catch (error) {
        fail(res, error, 'moments_media');
    }
});

router.post('/moments', ...membersOnly, requireRole(...COORDINATOR_ROLES), async (req: CircleRequest, res: Response) => {
    try {
        const kind = req.body?.kind;
        const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        const media = typeof req.body?.media_data_url === 'string' ? req.body.media_data_url : null;
        if (kind !== 'message' && kind !== 'video') return res.status(400).json({ success: false, error: 'kind must be message or video' });
        if (message.length > 500) return res.status(400).json({ success: false, error: 'message is limited to 500 characters' });
        if (kind === 'message' && !message) return res.status(400).json({ success: false, error: 'message is required' });
        if (kind === 'video' && (!media || media.length > MAX_VIDEO_CHARS || !VIDEO_DATA_URL_RE.test(media))) {
            return res.status(400).json({ success: false, error: 'video must be an mp4 or webm clip under 4 MB' });
        }
        const actor = await actorOf(req);
        const row = await withTransaction(async (c) => {
            const { rows } = await c.query(
                `INSERT INTO hearth_moments (circle_id, author_user_id, kind, message, media_data_url)
                 VALUES ($1, $2, $3, $4, $5) RETURNING id, kind, message, created_at`,
                [req.circleId, req.userId, kind, message, kind === 'video' ? media : null]
            );
            await recordLedger(c, req.circleId!, actor, { action: 'moment_shared', category: 'moments', detail: { moment_id: rows[0].id, kind } });
            return rows[0];
        });
        await broadcastToCircle(req.circleId!, { type: 'update', entity: 'hearth', action: 'created' });
        res.json({ success: true, data: { ...row, tv_delivery: 'unavailable' } });
    } catch (error) {
        fail(res, error, 'moments_create');
    }
});

router.post('/moments/:id/seen', kioskOrMember(), requireDevice, async (req: KioskRequest, res: Response) => {
    try {
        if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
        await query('UPDATE hearth_moments SET seen_at = COALESCE(seen_at, NOW()) WHERE id = $1 AND circle_id = $2', [req.params.id, req.circleId]);
        await broadcastToCircle(req.circleId!, { type: 'update', entity: 'hearth', action: 'updated' });
        res.json({ success: true });
    } catch (error) {
        fail(res, error, 'moments_seen');
    }
});

// ─── Alexa+ assistant tokens (MCP) ────────────────────────────────────────────

router.get('/assistant-tokens', ...membersOnly, requireRole(...COORDINATOR_ROLES), async (req: CircleRequest, res: Response) => {
    try {
        const { rows } = await query(
            `SELECT id, label, last_used_at, created_at FROM assistant_tokens
             WHERE circle_id = $1 AND user_id = $2 AND revoked_at IS NULL ORDER BY created_at DESC`,
            [req.circleId, req.userId]
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        fail(res, error, 'tokens_list');
    }
});

router.post('/assistant-tokens', ...membersOnly, requireRole(...COORDINATOR_ROLES), async (req: CircleRequest, res: Response) => {
    try {
        const label = typeof req.body?.label === 'string' && req.body.label.trim() ? req.body.label.trim().slice(0, 100) : 'Alexa+';
        const token = `hth_${crypto.randomBytes(32).toString('hex')}`;
        const hash = crypto.createHash('sha256').update(token).digest('hex');
        const actor = await actorOf(req);
        const row = await withTransaction(async (c) => {
            const { rows } = await c.query(
                'INSERT INTO assistant_tokens (circle_id, user_id, token_hash, label) VALUES ($1, $2, $3, $4) RETURNING id, label, created_at',
                [req.circleId, req.userId, hash, label]
            );
            await recordLedger(c, req.circleId!, actor, { action: 'assistant_connected', category: 'assistant', detail: { token_id: rows[0].id, label } });
            return rows[0];
        });
        // The token is shown once and only its hash is stored.
        res.json({ success: true, data: { ...row, token } });
    } catch (error) {
        fail(res, error, 'tokens_create');
    }
});

router.delete('/assistant-tokens/:id', ...membersOnly, requireRole(...COORDINATOR_ROLES), async (req: CircleRequest, res: Response) => {
    try {
        if (!UUID_RE.test(req.params.id)) return res.status(404).json({ success: false, error: 'Not found' });
        const actor = await actorOf(req);
        const done = await withTransaction(async (c) => {
            const { rows } = await c.query(
                'UPDATE assistant_tokens SET revoked_at = NOW() WHERE id = $1 AND circle_id = $2 AND user_id = $3 AND revoked_at IS NULL RETURNING id',
                [req.params.id, req.circleId, req.userId]
            );
            if (rows[0]) await recordLedger(c, req.circleId!, actor, { action: 'assistant_revoked', category: 'assistant', detail: { token_id: rows[0].id } });
            return Boolean(rows[0]);
        });
        if (!done) return res.status(404).json({ success: false, error: 'Not found' });
        res.json({ success: true });
    } catch (error) {
        fail(res, error, 'tokens_revoke');
    }
});

// ─── Simulator (demo circles only) ────────────────────────────────────────────

export const simulatorEnabled = (): boolean =>
    process.env.NODE_ENV !== 'production' || process.env.HEARTH_SIMULATOR_ENABLED === 'true';

router.post('/simulator/run', ...membersOnly, requireRole('admin'), async (req: CircleRequest, res: Response) => {
    try {
        if (!simulatorEnabled()) return res.status(404).json({ success: false, error: 'Not found' });
        const scenario = req.body?.scenario;
        if (!(SIM_SCENARIOS as readonly string[]).includes(scenario)) {
            return res.status(400).json({ success: false, error: `scenario must be one of ${SIM_SCENARIOS.join(', ')}` });
        }
        const seed = Number.isInteger(req.body?.seed) ? req.body.seed : 42;
        const result = await loadSimulation(req.circleId!, scenario as SimScenario, await actorOf(req), new Date(), seed);
        await broadcastToCircle(req.circleId!, { type: 'update', entity: 'presence', action: 'synced' });
        res.json({ success: true, data: result });
    } catch (error) {
        fail(res, error, 'simulator');
    }
});

export default router;
