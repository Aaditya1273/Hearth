import { describe, it, expect } from 'vitest';
import { canDecide, findPiggybacks, isExpired } from '../../server/src/lib/hearth/proposals';

const now = new Date(2026, 9, 22, 9, 0);
const day = 86400000;

describe('who decides a proposal', () => {
    it('the targeted member or an admin', () => {
        expect(canDecide({ role: 'family', memberId: 'sam' }, { target_member_id: 'sam' })).toBe(true);
        expect(canDecide({ role: 'family', memberId: 'kim' }, { target_member_id: 'sam' })).toBe(false);
        expect(canDecide({ role: 'admin', memberId: 'alex' }, { target_member_id: 'sam' })).toBe(true);
    });

    it('any admin or family member for an untargeted one, never viewers or professionals', () => {
        expect(canDecide({ role: 'family', memberId: 'kim' }, { target_member_id: null })).toBe(true);
        expect(canDecide({ role: 'viewer', memberId: 'jo' }, { target_member_id: null })).toBe(false);
        expect(canDecide({ role: 'professional', memberId: 'n' }, { target_member_id: null })).toBe(false);
    });
});

describe('expiry', () => {
    it('only pending proposals past their deadline expire', () => {
        expect(isExpired({ status: 'pending', expires_at: new Date(now.getTime() - 1) }, now)).toBe(true);
        expect(isExpired({ status: 'pending', expires_at: new Date(now.getTime() + 1) }, now)).toBe(false);
        expect(isExpired({ status: 'approved', expires_at: new Date(now.getTime() - 1) }, now)).toBe(false);
    });
});

describe('Piggyback Planner', () => {
    const visit = { id: 'v1', title: 'Sam visits', start_time: new Date(now.getTime() + day), member_ids: ['sam'] };

    it('pairs errands due near a visit, or unscheduled, with the visitor', () => {
        const matches = findPiggybacks([
            { id: 't1', title: 'Pharmacy', due_date: new Date(now.getTime() + day + 3600000), assigned_to: [] },
            { id: 't2', title: 'Groceries', due_date: null, assigned_to: [] },
            { id: 't3', title: 'Taxes', due_date: new Date(now.getTime() + 10 * day), assigned_to: [] },
            { id: 't4', title: 'Already Sam', due_date: null, assigned_to: ['sam'] },
        ], [visit], now);
        expect(matches.map((m) => [m.task.id, m.member_id])).toEqual([['t1', 'sam'], ['t2', 'sam']]);
        expect(matches[0].dedupe_key).toBe('piggyback:t1:v1');
    });

    it('ignores past visits, visits beyond a week and visits with nobody attached', () => {
        const task = [{ id: 't', title: 'x', due_date: null, assigned_to: [] }];
        expect(findPiggybacks(task, [{ ...visit, start_time: new Date(now.getTime() - 1) }], now)).toEqual([]);
        expect(findPiggybacks(task, [{ ...visit, start_time: new Date(now.getTime() + 8 * day) }], now)).toEqual([]);
        expect(findPiggybacks(task, [{ ...visit, member_ids: [] }], now)).toEqual([]);
    });
});
