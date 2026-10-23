/**
 * Hearth Glimpse Dial: the parent's information-sharing policy.
 *
 * Pure module (no database): every REST route and every MCP tool goes through
 * these functions, so the rules live in one place and are unit-tested.
 *
 *   light    -> high-level presence status only
 *   rhythm   -> + timing summaries (first/last activity, counts, usual times)
 *   glimpse  -> + privacy-preserving descriptions of supported events
 *   recovery -> + the extras the parent picked, for a limited time, then back
 *               to the previous level automatically
 */

export const SHARING_LEVELS = ['light', 'rhythm', 'glimpse', 'recovery'] as const;
export type SharingLevel = (typeof SHARING_LEVELS)[number];
export type BaseLevel = Exclude<SharingLevel, 'recovery'>;

export const RECOVERY_EXTRAS = ['medication_confirmations', 'night_rest'] as const;
export type RecoveryExtra = (typeof RECOVERY_EXTRAS)[number];

export const DEFAULT_RECOVERY_DAYS = 7;
export const MAX_RECOVERY_DAYS = 30;

const RANK: Record<SharingLevel, number> = { light: 0, rhythm: 1, glimpse: 2, recovery: 3 };

export interface ParentPreferences {
    level: SharingLevel;
    previous_level: BaseLevel | null;
    recovery_until: Date | null;
    recovery_extras: RecoveryExtra[];
    delegate_member_id: string | null;
    away_until: Date | null;
}

/** Private by default: a circle with no saved preference shares status only. */
export const DEFAULT_PREFERENCES: ParentPreferences = {
    level: 'light',
    previous_level: null,
    recovery_until: null,
    recovery_extras: [],
    delegate_member_id: null,
    away_until: null,
};

/** Who is asking. The parent is the paired kiosk/phone device of the circle. */
export type Actor =
    | { kind: 'parent'; deviceId: string; label: string }
    | { kind: 'member'; userId: string; memberId: string; role: string; label: string }
    | { kind: 'assistant'; userId: string; memberId: string; role: string; label: string }
    | { kind: 'system'; label: string };

const isLevel = (v: unknown): v is SharingLevel => typeof v === 'string' && (SHARING_LEVELS as readonly string[]).includes(v);
const isExtra = (v: unknown): v is RecoveryExtra => typeof v === 'string' && (RECOVERY_EXTRAS as readonly string[]).includes(v);

/**
 * Recovery that has run out is reported as the level it returns to. The
 * stored row is rewritten lazily by the store (with a ledger entry), but no
 * reader ever sees an expired Recovery, even before that write.
 */
export function effectivePreferences(prefs: ParentPreferences, now: Date): ParentPreferences & { recovery_expired: boolean } {
    if (prefs.level === 'recovery' && (!prefs.recovery_until || prefs.recovery_until.getTime() <= now.getTime())) {
        return {
            ...prefs,
            level: prefs.previous_level ?? 'light',
            previous_level: null,
            recovery_until: null,
            recovery_extras: [],
            recovery_expired: true,
        };
    }
    return { ...prefs, recovery_expired: false };
}

export const isAway = (prefs: ParentPreferences, now: Date): boolean =>
    prefs.away_until !== null && prefs.away_until.getTime() > now.getTime();

/**
 * Only the parent (their paired device) or the delegate the parent named can
 * change the dial, the delegate or the away status. Family members, admins
 * included, cannot: an admin is often the adult child, and "family cannot
 * raise the level" must hold without exceptions. Assistants never can.
 */
export function canManagePreferences(actor: Actor, prefs: ParentPreferences): boolean {
    if (actor.kind === 'parent') return true;
    if (actor.kind === 'member') return prefs.delegate_member_id !== null && actor.memberId === prefs.delegate_member_id;
    return false;
}

/** Naming or removing the delegate is the parent's own decision. */
export const canChooseDelegate = (actor: Actor): boolean => actor.kind === 'parent';

export interface PolicyChangeInput {
    level: SharingLevel;
    recovery_days: number;
    recovery_extras: RecoveryExtra[];
}

export function parsePolicyChange(body: unknown): { ok: true; value: PolicyChangeInput } | { ok: false; error: string } {
    const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    if (!isLevel(raw.level)) return { ok: false, error: 'level must be one of light, rhythm, glimpse, recovery' };
    if (raw.level !== 'recovery') return { ok: true, value: { level: raw.level, recovery_days: 0, recovery_extras: [] } };

    const days = raw.recovery_days === undefined ? DEFAULT_RECOVERY_DAYS : raw.recovery_days;
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > MAX_RECOVERY_DAYS) {
        return { ok: false, error: `recovery_days must be an integer between 1 and ${MAX_RECOVERY_DAYS}` };
    }
    const extras = raw.recovery_extras === undefined ? [] : raw.recovery_extras;
    if (!Array.isArray(extras) || !extras.every(isExtra)) {
        return { ok: false, error: `recovery_extras may only contain ${RECOVERY_EXTRAS.join(', ')}` };
    }
    return { ok: true, value: { level: 'recovery', recovery_days: days, recovery_extras: [...new Set(extras)] } };
}

/** New stored preferences after a validated change (delegate and away untouched). */
export function applyPolicyChange(current: ParentPreferences, change: PolicyChangeInput, now: Date): ParentPreferences {
    const base = effectivePreferences(current, now);
    if (change.level !== 'recovery') {
        return { ...base, level: change.level, previous_level: null, recovery_until: null, recovery_extras: [] };
    }
    return {
        ...base,
        level: 'recovery',
        // Extending Recovery keeps the level it will return to.
        previous_level: base.level === 'recovery' ? base.previous_level ?? 'light' : (base.level as BaseLevel),
        recovery_until: new Date(now.getTime() + change.recovery_days * 24 * 60 * 60 * 1000),
        recovery_extras: change.recovery_extras,
    };
}

export type Disclosure = 'status' | 'timing' | 'events' | RecoveryExtra;

/** What a family viewer may receive at this effective level. */
export function allows(prefs: ParentPreferences, what: Disclosure): boolean {
    const rank = RANK[prefs.level];
    if (what === 'status') return true;
    if (what === 'timing') return rank >= RANK.rhythm;
    if (what === 'events') return rank >= RANK.glimpse;
    return prefs.level === 'recovery' && prefs.recovery_extras.includes(what);
}

export const levelRank = (level: SharingLevel): number => RANK[level];
