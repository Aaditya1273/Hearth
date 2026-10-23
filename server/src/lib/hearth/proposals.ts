/**
 * Piggyback Planner rules. Pure: who may decide, when a proposal expires and
 * which errands overlap an upcoming visit. Nothing here writes; the store
 * executes an approved proposal inside a transaction with its ledger entry.
 */

export const PROPOSAL_KINDS = ['assign_task', 'visit', 'check_in'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export const PROPOSAL_TTL_HOURS = 72;
export const DECIDER_ROLES = ['admin', 'family'];

export interface ProposalRow {
    id: string;
    kind: ProposalKind;
    status: 'pending' | 'approved' | 'rejected' | 'expired';
    target_member_id: string | null;
    expires_at: Date;
}

export const isExpired = (p: Pick<ProposalRow, 'status' | 'expires_at'>, now: Date): boolean =>
    p.status === 'pending' && p.expires_at.getTime() <= now.getTime();

/**
 * A proposal aimed at a member is decided by that member, or by an admin. An
 * untargeted one by any admin or family member (who then takes it on).
 * Assistants and parent devices never approve: approval is a person's choice.
 */
export function canDecide(decider: { role: string; memberId: string }, p: Pick<ProposalRow, 'target_member_id'>): boolean {
    if (!DECIDER_ROLES.includes(decider.role)) return false;
    if (p.target_member_id && p.target_member_id !== decider.memberId) return decider.role === 'admin';
    return true;
}

export interface OpenTask { id: string; title: string; due_date: Date | null; assigned_to: string[] }
export interface UpcomingVisit { id: string; title: string; start_time: Date; member_ids: string[] }
export interface PiggybackMatch { task: OpenTask; visit: UpcomingVisit; member_id: string; dedupe_key: string }

const DAY = 24 * 60 * 60 * 1000;

/**
 * Errands with no due date, or due within a day of a planned visit, can ride
 * along with that visit. One suggestion per task (the earliest visit), never
 * for a member who already has the task.
 */
export function findPiggybacks(tasks: OpenTask[], visits: UpcomingVisit[], now: Date): PiggybackMatch[] {
    const soon = visits
        .filter((v) => v.member_ids.length > 0 && v.start_time > now && v.start_time.getTime() - now.getTime() <= 7 * DAY)
        .sort((a, b) => a.start_time.getTime() - b.start_time.getTime());
    const out: PiggybackMatch[] = [];
    for (const task of tasks) {
        const visit = soon.find((v) =>
            !task.assigned_to.includes(v.member_ids[0])
            && (task.due_date === null || Math.abs(task.due_date.getTime() - v.start_time.getTime()) <= DAY));
        if (!visit) continue;
        out.push({ task, visit, member_id: visit.member_ids[0], dedupe_key: `piggyback:${task.id}:${visit.id}` });
    }
    return out;
}
