import { describe, it, expect } from 'vitest';
import {
    Actor, DEFAULT_PREFERENCES, ParentPreferences, allows, applyPolicyChange, canChooseDelegate,
    canManagePreferences, effectivePreferences, parsePolicyChange,
} from '../../server/src/lib/hearth/policy';

const now = new Date(2026, 9, 22, 10, 0);
const parent: Actor = { kind: 'parent', deviceId: 'dev-1', label: 'Parent' };
const admin: Actor = { kind: 'member', userId: 'u-admin', memberId: 'm-admin', role: 'admin', label: 'Alex' };
const family: Actor = { kind: 'member', userId: 'u-sam', memberId: 'm-sam', role: 'family', label: 'Sam' };
const assistant: Actor = { kind: 'assistant', userId: 'u-sam', memberId: 'm-sam', role: 'family', label: 'Sam via Alexa+' };
const prefs = (p: Partial<ParentPreferences> = {}): ParentPreferences => ({ ...DEFAULT_PREFERENCES, ...p });

describe('Glimpse Dial: who may change it', () => {
    it('is private by default', () => {
        expect(DEFAULT_PREFERENCES.level).toBe('light');
    });

    it('lets the parent change it', () => {
        expect(canManagePreferences(parent, prefs())).toBe(true);
    });

    it('never lets a family member or an admin change it (so they cannot raise it)', () => {
        expect(canManagePreferences(family, prefs())).toBe(false);
        expect(canManagePreferences(admin, prefs())).toBe(false);
        expect(canManagePreferences(admin, prefs({ delegate_member_id: 'm-sam' }))).toBe(false);
    });

    it('lets the delegate the parent named change it', () => {
        expect(canManagePreferences(family, prefs({ delegate_member_id: 'm-sam' }))).toBe(true);
    });

    it('never lets an assistant change it, even for the delegate', () => {
        expect(canManagePreferences(assistant, prefs({ delegate_member_id: 'm-sam' }))).toBe(false);
    });

    it('only the parent chooses the delegate', () => {
        expect(canChooseDelegate(parent)).toBe(true);
        expect(canChooseDelegate(admin)).toBe(false);
        expect(canChooseDelegate(family)).toBe(false);
    });
});

describe('Glimpse Dial: validation', () => {
    it('rejects unknown levels', () => {
        expect(parsePolicyChange({ level: 'everything' }).ok).toBe(false);
        expect(parsePolicyChange({}).ok).toBe(false);
        expect(parsePolicyChange(null).ok).toBe(false);
    });

    it('bounds Recovery duration and extras', () => {
        expect(parsePolicyChange({ level: 'recovery', recovery_days: 0 }).ok).toBe(false);
        expect(parsePolicyChange({ level: 'recovery', recovery_days: 31 }).ok).toBe(false);
        expect(parsePolicyChange({ level: 'recovery', recovery_days: 2.5 }).ok).toBe(false);
        expect(parsePolicyChange({ level: 'recovery', recovery_extras: ['camera'] }).ok).toBe(false);
        const ok = parsePolicyChange({ level: 'recovery', recovery_days: 3, recovery_extras: ['night_rest', 'night_rest'] });
        expect(ok).toEqual({ ok: true, value: { level: 'recovery', recovery_days: 3, recovery_extras: ['night_rest'] } });
    });

    it('drops Recovery fields for other levels', () => {
        expect(parsePolicyChange({ level: 'rhythm', recovery_days: 9, recovery_extras: ['night_rest'] }))
            .toEqual({ ok: true, value: { level: 'rhythm', recovery_days: 0, recovery_extras: [] } });
    });
});

describe('Recovery mode', () => {
    it('remembers the level to return to and expires on time', () => {
        const change = parsePolicyChange({ level: 'recovery', recovery_days: 3, recovery_extras: ['night_rest'] });
        if (!change.ok) throw new Error('invalid');
        const next = applyPolicyChange(prefs({ level: 'rhythm' }), change.value, now);
        expect(next.level).toBe('recovery');
        expect(next.previous_level).toBe('rhythm');
        expect(next.recovery_until!.getTime()).toBe(now.getTime() + 3 * 86400000);

        const justBefore = new Date(next.recovery_until!.getTime() - 1);
        expect(effectivePreferences(next, justBefore).level).toBe('recovery');

        const after = effectivePreferences(next, next.recovery_until!);
        expect(after.level).toBe('rhythm');
        expect(after.recovery_expired).toBe(true);
        expect(after.recovery_extras).toEqual([]);
        expect(allows(after, 'night_rest')).toBe(false);
    });

    it('extending Recovery keeps the original level to return to', () => {
        const first = applyPolicyChange(prefs({ level: 'glimpse' }), { level: 'recovery', recovery_days: 2, recovery_extras: [] }, now);
        const extended = applyPolicyChange(first, { level: 'recovery', recovery_days: 5, recovery_extras: [] }, now);
        expect(extended.previous_level).toBe('glimpse');
    });

    it('falls back to light when Recovery has no previous level or end date', () => {
        expect(effectivePreferences(prefs({ level: 'recovery', recovery_until: null }), now).level).toBe('light');
    });
});

describe('what each level discloses', () => {
    it('follows light < rhythm < glimpse < recovery', () => {
        const at = (level: ParentPreferences['level'], extras: ParentPreferences['recovery_extras'] = []) =>
            prefs({ level, recovery_extras: extras, recovery_until: new Date(now.getTime() + 86400000) });
        expect(['status', 'timing', 'events'].map((w) => allows(at('light'), w as never))).toEqual([true, false, false]);
        expect(['status', 'timing', 'events'].map((w) => allows(at('rhythm'), w as never))).toEqual([true, true, false]);
        expect(['status', 'timing', 'events'].map((w) => allows(at('glimpse'), w as never))).toEqual([true, true, true]);
        expect(allows(at('glimpse'), 'night_rest')).toBe(false);
        expect(allows(at('recovery', ['night_rest']), 'night_rest')).toBe(true);
        expect(allows(at('recovery', ['night_rest']), 'medication_confirmations')).toBe(false);
    });
});
