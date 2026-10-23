/**
 * Hearth presence engine and Why Cards. Pure and deterministic: same events,
 * same clock -> same answer. No model is involved in any state transition.
 *
 * Ground rules (tested in tests/server/hearthPresence.test.ts):
 *  - no baseline (fewer than MIN_BASELINE_DAYS active days) => never "normal";
 *  - no events at all, or no signal for STALE_HOURS => a data state, never a
 *    statement about the parent;
 *  - every view carries the disclaimer: sensors cannot confirm safety.
 */
import { allows, isAway, ParentPreferences, SharingLevel } from './policy';

export interface PresenceEvent {
    id: string;
    source: string;
    kind: string;
    provenance: string;
    simulated: boolean;
    occurred_at: Date;
}

export type PresenceState = 'normal' | 'awaiting' | 'unusual' | 'insufficient_data' | 'away' | 'signal_unavailable';
export type PresenceReason =
    | 'pattern_matches' | 'before_usual_time' | 'no_activity_by_usual_time' | 'late_first_activity'
    | 'building_baseline' | 'no_signals' | 'all_sources_silent' | 'parent_away';

export const BASELINE_WINDOW_DAYS = 14;
export const MIN_BASELINE_DAYS = 7;
/** Activity before 04:00 belongs to the night, not to "the day started". */
export const DAY_START_MINUTE = 4 * 60;
export const GRACE_MINUTES = 45;
export const STALE_HOURS = 24;
/**
 * A single source is called unavailable only after this long, and only while
 * other sources still report: a once-a-day sensor that has not fired yet
 * today is inactivity, not a broken sensor, and must not be reported as one.
 */
export const SOURCE_STALE_HOURS = 48;
/** A source counts as "regular" once it reported on this many baseline days. */
const REGULAR_SOURCE_DAYS = 3;

export interface Baseline {
    days: number;
    usual_first_minute: number;
    /** p90 of the first-activity minute + GRACE_MINUTES: past this, today is unusual. */
    latest_expected_minute: number;
}

export interface Assessment {
    state: PresenceState;
    reason: PresenceReason;
    now: Date;
    baseline: Baseline | null;
    baseline_days_observed: number;
    today_events: PresenceEvent[];
    first_today: PresenceEvent | null;
    last_today: PresenceEvent | null;
    last_signal: PresenceEvent | null;
    /** Last event of the previous evening (18:00 onwards), for night rest. */
    last_evening: PresenceEvent | null;
    stale_sources: Array<{ source: string; last_seen: Date }>;
    away_until: Date | null;
    /** True when any event that shaped this assessment is simulated. */
    simulated: boolean;
}

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const minuteOfDay = (d: Date): number => d.getHours() * 60 + d.getMinutes();
const dayKey = (d: Date): string => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const median = (xs: number[]): number => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

export function computeBaseline(events: PresenceEvent[], now: Date): { baseline: Baseline | null; daysObserved: number } {
    const today = startOfDay(now);
    const from = addDays(today, -BASELINE_WINDOW_DAYS);
    const firstByDay = new Map<string, number>();
    for (const e of events) {
        if (e.occurred_at < from || e.occurred_at >= today) continue;
        const m = minuteOfDay(e.occurred_at);
        if (m < DAY_START_MINUTE) continue;
        const k = dayKey(e.occurred_at);
        const prev = firstByDay.get(k);
        if (prev === undefined || m < prev) firstByDay.set(k, m);
    }
    const firsts = [...firstByDay.values()].sort((a, b) => a - b);
    if (firsts.length < MIN_BASELINE_DAYS) return { baseline: null, daysObserved: firsts.length };
    const p90 = firsts[Math.ceil(0.9 * firsts.length) - 1];
    return {
        baseline: { days: firsts.length, usual_first_minute: median(firsts), latest_expected_minute: p90 + GRACE_MINUTES },
        daysObserved: firsts.length,
    };
}

export function assessPresence(eventsIn: PresenceEvent[], now: Date, prefs: ParentPreferences): Assessment {
    const events = [...eventsIn].filter((e) => e.occurred_at <= now).sort((a, b) => a.occurred_at.getTime() - b.occurred_at.getTime());
    const today = startOfDay(now);
    const windowStart = addDays(today, -BASELINE_WINDOW_DAYS);
    const inWindow = events.filter((e) => e.occurred_at >= windowStart);
    const todayEvents = inWindow.filter((e) => e.occurred_at >= today);
    const dayEvents = todayEvents.filter((e) => minuteOfDay(e.occurred_at) >= DAY_START_MINUTE);
    const lastSignal = inWindow.length ? inWindow[inWindow.length - 1] : null;
    const eveningStart = new Date(addDays(today, -1).getTime() + 18 * 60 * 60 * 1000);
    const evening = inWindow.filter((e) => e.occurred_at >= eveningStart && e.occurred_at < today);
    const { baseline, daysObserved } = computeBaseline(inWindow, now);

    // Regular sources that went quiet (hub offline, battery, unplugged).
    const daysBySource = new Map<string, Set<string>>();
    const lastBySource = new Map<string, Date>();
    for (const e of inWindow) {
        if (e.source === 'kiosk') continue; // a manual check-in is not a sensor
        if (e.occurred_at < today) {
            if (!daysBySource.has(e.source)) daysBySource.set(e.source, new Set());
            daysBySource.get(e.source)!.add(dayKey(e.occurred_at));
        }
        lastBySource.set(e.source, e.occurred_at);
    }
    const staleBefore = new Date(now.getTime() - STALE_HOURS * 60 * 60 * 1000);
    const sourceStaleBefore = new Date(now.getTime() - SOURCE_STALE_HOURS * 60 * 60 * 1000);
    const othersRecent = (source: string) => [...lastBySource.entries()].some(([s, at]) => s !== source && at >= staleBefore);
    const stale = [...daysBySource.entries()]
        .filter(([source, days]) => days.size >= REGULAR_SOURCE_DAYS && lastBySource.get(source)! < sourceStaleBefore && othersRecent(source))
        .map(([source]) => ({ source, last_seen: lastBySource.get(source)! }));

    const base: Omit<Assessment, 'state' | 'reason'> = {
        now,
        baseline,
        baseline_days_observed: daysObserved,
        today_events: todayEvents,
        first_today: dayEvents[0] ?? null,
        last_today: todayEvents.length ? todayEvents[todayEvents.length - 1] : null,
        last_signal: lastSignal,
        last_evening: evening.length ? evening[evening.length - 1] : null,
        stale_sources: stale,
        away_until: isAway(prefs, now) ? prefs.away_until : null,
        simulated: inWindow.some((e) => e.simulated),
    };
    const result = (state: PresenceState, reason: PresenceReason): Assessment => ({ ...base, state, reason });

    if (base.away_until) return result('away', 'parent_away');
    if (inWindow.length === 0) return result('insufficient_data', 'no_signals');
    if (!lastSignal || lastSignal.occurred_at < staleBefore) return result('signal_unavailable', 'all_sources_silent');
    if (!baseline) return result('insufficient_data', 'building_baseline');
    if (!base.first_today) {
        return minuteOfDay(now) > baseline.latest_expected_minute
            ? result('unusual', 'no_activity_by_usual_time')
            : result('awaiting', 'before_usual_time');
    }
    if (minuteOfDay(base.first_today.occurred_at) > baseline.latest_expected_minute) return result('unusual', 'late_first_activity');
    return result('normal', 'pattern_matches');
}

// ─── Rendering for a viewer, filtered by the parent's policy ──────────────────

const pad = (n: number): string => String(n).padStart(2, '0');
export const hhmm = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const minuteToHhmm = (m: number): string => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
/** Naive local ISO, the same shape as every TIMESTAMP the API returns. */
export const localIso = (d: Date): string =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${hhmm(d)}:${pad(d.getSeconds())}`;
const when = (d: Date, now: Date): string => {
    const diff = Math.round((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86400000);
    if (diff === 0) return `today ${hhmm(d)}`;
    if (diff === 1) return `yesterday ${hhmm(d)}`;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hhmm(d)}`;
};

const KIND_LABEL: Record<string, string> = { motion: 'movement', door: 'door used', power: 'appliance used', other: 'activity' };
const sourceLabel = (source: string): string => {
    const s = source.replace(/[_.-]+/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Sensor';
};
/** Behaviour-focused, no payload, no media, no inference about the person. */
export const describeEvent = (e: PresenceEvent): string =>
    e.source === 'kiosk' ? 'Checked in on the Hearth screen' : `${sourceLabel(e.source)}: ${KIND_LABEL[e.kind] ?? 'activity'}`;

export type Provenance = 'real' | 'simulated' | 'unavailable';

export interface WhyCard {
    id: string;
    title: string;
    observed: string;
    difference: string | null;
    evidence: Array<{ text: string; at: string | null; simulated: boolean }>;
    confidence: 'low' | 'medium' | 'high';
    next_step: string;
    at: string;
    provenance: Provenance;
    rule: PresenceReason | 'source_silent';
}

export interface MedicationConfirmation { due_at: string; status: string; confirmed_at: string | null }

export interface PresenceView {
    level: SharingLevel;
    state: PresenceState;
    reason: PresenceReason;
    headline: string;
    summary: string;
    disclaimer: string;
    simulated: boolean;
    checked_at: string;
    data_quality: { baseline: 'ready' | 'building' | 'none'; baseline_days_observed: number; baseline_days_needed: number; unavailable_sources: string[] };
    timing?: {
        first_activity_at: string | null;
        last_activity_at: string | null;
        signals_today: number;
        usual_first_activity: string | null;
        latest_expected_first_activity: string | null;
        last_signal_at: string | null;
        away_until: string | null;
    };
    events?: Array<{ at: string; description: string; simulated: boolean; provenance: string }>;
    extras?: {
        night_rest?: { quiet_from: string | null; quiet_until: string | null };
        medication_confirmations?: MedicationConfirmation[];
    };
    why_cards: WhyCard[];
}

const HEADLINE: Record<PresenceState, string> = {
    normal: 'Normal pattern observed',
    awaiting: 'No activity yet today',
    unusual: 'Unusual pattern: review suggested',
    insufficient_data: 'Not enough data',
    away: 'Marked as away',
    signal_unavailable: 'A signal is unavailable',
};

const confidenceOf = (a: Assessment): WhyCard['confidence'] =>
    !a.baseline ? 'low' : a.baseline.days >= 12 ? 'high' : 'medium';

function summaryFor(a: Assessment, name: string, timing: boolean): string {
    const b = a.baseline;
    switch (a.reason) {
        case 'pattern_matches':
            return timing && a.first_today
                ? `${name}'s day started at ${hhmm(a.first_today.occurred_at)}, within the usual window (usually by ${minuteToHhmm(b!.usual_first_minute)}).`
                : `Today's activity looks like ${name}'s usual routine.`;
        case 'before_usual_time':
            return timing ? `It is still before ${name}'s usual first activity (by ${minuteToHhmm(b!.latest_expected_minute)} at the latest).` : `It is still within ${name}'s usual morning window.`;
        case 'no_activity_by_usual_time':
            return timing
                ? `No activity has been detected today. ${name} is usually first active by ${minuteToHhmm(b!.usual_first_minute)}; it is now ${hhmm(a.now)}.`
                : 'No activity has been detected yet today, later than usual.';
        case 'late_first_activity':
            return timing
                ? `First activity at ${hhmm(a.first_today!.occurred_at)}, later than usual (usually by ${minuteToHhmm(b!.usual_first_minute)}).`
                : 'The day started later than usual. Activity has been observed since.';
        case 'building_baseline':
            return `Hearth needs ${MIN_BASELINE_DAYS} days of activity to learn the usual routine (${a.baseline_days_observed} of ${MIN_BASELINE_DAYS} so far). Until then it will not call any day normal.`;
        case 'no_signals':
            return 'No presence signals have been received. Connect a sensor or use the check-in button on the Hearth screen.';
        case 'all_sources_silent':
            return timing && a.last_signal
                ? `No sensor has reported since ${when(a.last_signal.occurred_at, a.now)}. This is likely a connection problem; it tells us nothing about ${name}.`
                : `No sensor has reported for over ${STALE_HOURS} hours. This is likely a connection problem; it tells us nothing about ${name}.`;
        case 'parent_away':
            return timing && a.away_until ? `${name} marked themselves as away until ${when(a.away_until, a.now)}.` : `${name} marked themselves as away.`;
    }
}

function buildCards(a: Assessment, name: string, prefs: ParentPreferences, fullAccess: boolean): WhyCard[] {
    const timing = fullAccess || allows(prefs, 'timing');
    const events = fullAccess || allows(prefs, 'events');
    const b = a.baseline;
    const day = localIso(a.now).slice(0, 10);
    const provenance: Provenance = a.simulated ? 'simulated' : 'real';
    const lastSeen = a.last_signal;
    const evidence = (): WhyCard['evidence'] => {
        const out: WhyCard['evidence'] = [];
        if (b) out.push({ text: timing ? `Usual first activity: ${minuteToHhmm(b.usual_first_minute)} (median of ${b.days} days)` : `Compared with ${b.days} days of ${name}'s usual routine`, at: null, simulated: a.simulated });
        if (lastSeen) {
            out.push(events
                ? { text: `Last activity: ${describeEvent(lastSeen)}, ${when(lastSeen.occurred_at, a.now)}`, at: localIso(lastSeen.occurred_at), simulated: lastSeen.simulated }
                : timing
                    ? { text: `Last activity ${when(lastSeen.occurred_at, a.now)}`, at: localIso(lastSeen.occurred_at), simulated: lastSeen.simulated }
                    : { text: 'Based on home sensor activity only', at: null, simulated: a.simulated });
        }
        return out;
    };
    const cards: WhyCard[] = [];
    if (a.reason === 'no_activity_by_usual_time') {
        cards.push({
            id: `no_activity:${day}`, rule: a.reason, provenance,
            title: 'No activity detected this morning',
            observed: timing ? `No sensor activity today as of ${hhmm(a.now)}.` : 'No sensor activity yet today.',
            difference: timing ? `${name} is usually first active by ${minuteToHhmm(b!.usual_first_minute)}, and in the last ${b!.days} active days almost always by ${minuteToHhmm(b!.latest_expected_minute - GRACE_MINUTES)}.` : 'Later than the usual routine.',
            evidence: evidence(), confidence: confidenceOf(a),
            next_step: `Give ${name} a call to check in. If you cannot reach them, ask someone nearby to stop by.`,
            at: localIso(a.now),
        });
    }
    if (a.reason === 'late_first_activity') {
        cards.push({
            id: `late_start:${day}`, rule: a.reason, provenance: a.first_today!.simulated ? 'simulated' : 'real',
            title: 'The day started later than usual',
            observed: timing ? `First activity today at ${hhmm(a.first_today!.occurred_at)}.` : 'Activity was observed today, later than usual.',
            difference: timing ? `Usually by ${minuteToHhmm(b!.usual_first_minute)}.` : null,
            evidence: [
                ...evidence(),
                ...(events ? [{ text: `First activity: ${describeEvent(a.first_today!)}`, at: localIso(a.first_today!.occurred_at), simulated: a.first_today!.simulated }] : []),
            ],
            confidence: confidenceOf(a),
            next_step: `No action needed if you have already heard from ${name}; otherwise a short call is enough.`,
            // The time of the first activity is timing data: below Rhythm the card is dated "now".
            at: timing ? localIso(a.first_today!.occurred_at) : localIso(a.now),
        });
    }
    if (a.reason === 'all_sources_silent') {
        cards.push({
            id: `silent:${day}`, rule: a.reason, provenance: 'unavailable',
            title: 'Sensors have stopped reporting',
            observed: timing && lastSeen ? `Last signal ${when(lastSeen.occurred_at, a.now)}.` : `No signal for over ${STALE_HOURS} hours.`,
            difference: null,
            evidence: [{ text: 'No events received from any configured source', at: null, simulated: false }],
            confidence: 'low',
            next_step: `Check that the sensor hub has power and Wi-Fi. A quick call to ${name} can confirm everything is fine.`,
            at: localIso(a.now),
        });
    }
    if (a.state !== 'signal_unavailable') {
        for (const s of a.stale_sources.slice(0, 2)) {
            cards.push({
                id: `source_silent:${s.source}:${day}`, rule: 'source_silent', provenance: 'unavailable',
                title: `${sourceLabel(s.source)} is not reporting`,
                observed: timing ? `Last report ${when(s.last_seen, a.now)}.` : `No report for over ${SOURCE_STALE_HOURS} hours.`,
                difference: null,
                evidence: [{ text: 'Other sources are still reporting; the status uses them', at: null, simulated: false }],
                confidence: 'low',
                next_step: 'Check the device battery or connection when convenient. No other action is suggested.',
                at: localIso(a.now),
            });
        }
    }
    if (a.reason === 'building_baseline') {
        cards.push({
            id: `baseline:${day}`, rule: a.reason, provenance,
            title: 'Hearth is still learning the routine',
            observed: `${a.baseline_days_observed} of ${MIN_BASELINE_DAYS} days with activity recorded.`,
            difference: null,
            evidence: [{ text: 'No baseline yet: Hearth does not compare today with anything', at: null, simulated: a.simulated }],
            confidence: 'low',
            next_step: `Keep checking in with ${name} the way you usually do.`,
            at: localIso(a.now),
        });
    }
    return cards;
}

/**
 * Build the view a viewer receives. Fields are added from an allowlist per
 * level; nothing is computed and then deleted, so a disallowed field cannot
 * leak by omission. `fullAccess` is for the parent's own screen only.
 */
export function renderPresenceView(
    a: Assessment,
    prefs: ParentPreferences,
    opts: { name: string; fullAccess?: boolean; medications?: MedicationConfirmation[] }
): PresenceView {
    const full = opts.fullAccess === true;
    const name = opts.name.trim() || 'your parent';
    const timing = full || allows(prefs, 'timing');
    const view: PresenceView = {
        level: prefs.level,
        state: a.state,
        reason: a.reason,
        headline: a.state === 'away' ? `${name} marked themselves as away` : HEADLINE[a.state],
        summary: summaryFor(a, name, timing),
        disclaimer: `Based on home sensor activity only. Hearth is not a medical or emergency service and cannot confirm that ${name} is safe.`,
        simulated: a.simulated,
        checked_at: localIso(a.now),
        data_quality: {
            baseline: a.baseline ? 'ready' : a.baseline_days_observed > 0 ? 'building' : 'none',
            baseline_days_observed: a.baseline_days_observed,
            baseline_days_needed: MIN_BASELINE_DAYS,
            unavailable_sources: a.stale_sources.map((s) => sourceLabel(s.source)),
        },
        why_cards: buildCards(a, name, prefs, full),
    };
    if (timing) {
        view.timing = {
            first_activity_at: a.first_today ? localIso(a.first_today.occurred_at) : null,
            last_activity_at: a.last_today ? localIso(a.last_today.occurred_at) : null,
            signals_today: a.today_events.length,
            usual_first_activity: a.baseline ? minuteToHhmm(a.baseline.usual_first_minute) : null,
            latest_expected_first_activity: a.baseline ? minuteToHhmm(a.baseline.latest_expected_minute) : null,
            last_signal_at: a.last_signal ? localIso(a.last_signal.occurred_at) : null,
            away_until: a.away_until ? localIso(a.away_until) : null,
        };
    }
    if (full || allows(prefs, 'events')) {
        view.events = a.today_events.slice(-40).reverse().map((e) => ({
            at: localIso(e.occurred_at), description: describeEvent(e), simulated: e.simulated, provenance: e.provenance,
        }));
    }
    const extras: NonNullable<PresenceView['extras']> = {};
    if (full || allows(prefs, 'night_rest')) {
        extras.night_rest = {
            quiet_from: a.last_evening ? localIso(a.last_evening.occurred_at) : null,
            quiet_until: a.first_today ? localIso(a.first_today.occurred_at) : null,
        };
    }
    if ((full || allows(prefs, 'medication_confirmations')) && opts.medications) {
        extras.medication_confirmations = opts.medications;
    }
    if (Object.keys(extras).length) view.extras = extras;
    return view;
}
