import { describe, it, expect } from 'vitest';
import { DEFAULT_PREFERENCES, ParentPreferences } from '../../server/src/lib/hearth/policy';
import { assessPresence, renderPresenceView, PresenceEvent, MIN_BASELINE_DAYS } from '../../server/src/lib/hearth/presence';
import { simulate, SIM_SCENARIOS } from '../../server/src/lib/hearth/simulator';

const now = new Date(2026, 9, 22, 11, 0);
const prefs = (p: Partial<ParentPreferences> = {}): ParentPreferences => ({ ...DEFAULT_PREFERENCES, ...p });
let seq = 0;
const ev = (daysAgo: number, h: number, m = 0, source = 'kitchen_motion', simulated = false): PresenceEvent => ({
    id: `e${seq++}`, source, kind: 'motion', provenance: simulated ? 'simulator' : 'home_assistant', simulated,
    occurred_at: new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, h, m),
});
/** n past days with first activity at 07:30 and another at 18:00. */
const history = (days: number, source = 'kitchen_motion') =>
    Array.from({ length: days }, (_, i) => [ev(i + 1, 7, 30, source), ev(i + 1, 18, 0, source)]).flat();

describe('unknown or missing data is never a safety claim', () => {
    it('no events at all -> insufficient data', () => {
        const a = assessPresence([], now, prefs());
        expect(a.state).toBe('insufficient_data');
        expect(a.reason).toBe('no_signals');
    });

    it('fewer than the baseline days -> insufficient data, even with activity today', () => {
        const a = assessPresence([...history(MIN_BASELINE_DAYS - 1), ev(0, 7, 30)], now, prefs());
        expect(a.state).toBe('insufficient_data');
        expect(a.reason).toBe('building_baseline');
    });

    it('every sensor silent for a day -> signal unavailable, not normal and not an incident', () => {
        const events = history(10).filter((e) => e.occurred_at < new Date(now.getTime() - 25 * 3600000));
        const a = assessPresence(events, now, prefs());
        expect(a.state).toBe('signal_unavailable');
    });

    it('no green state in any of these cases, whatever the level', () => {
        const cases = [[], history(3), history(10).filter((e) => e.occurred_at < new Date(now.getTime() - 30 * 3600000))];
        for (const events of cases) {
            for (const level of ['light', 'rhythm', 'glimpse'] as const) {
                const v = renderPresenceView(assessPresence(events, now, prefs({ level })), prefs({ level }), { name: 'Mom' });
                expect(v.state).not.toBe('normal');
                expect(v.headline).not.toMatch(/normal/i);
            }
        }
    });

    it('every view says sensors cannot confirm safety', () => {
        const v = renderPresenceView(assessPresence([...history(10), ev(0, 7, 20)], now, prefs()), prefs(), { name: 'Mom' });
        expect(v.state).toBe('normal');
        expect(v.disclaimer).toMatch(/cannot confirm that Mom is safe/);
        expect(v.disclaimer).toMatch(/not a medical or emergency service/);
    });
});

describe('states from a baseline', () => {
    it('normal when today started within the usual window', () => {
        expect(assessPresence([...history(10), ev(0, 7, 40)], now, prefs()).state).toBe('normal');
    });

    it('awaiting before the usual time, unusual after it', () => {
        const early = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 0);
        expect(assessPresence(history(10), early, prefs()).state).toBe('awaiting');
        const a = assessPresence(history(10), now, prefs());
        expect(a.state).toBe('unusual');
        expect(a.reason).toBe('no_activity_by_usual_time');
    });

    it('a late start is unusual and explained', () => {
        const a = assessPresence([...history(10), ev(0, 10, 30)], now, prefs());
        expect(a.reason).toBe('late_first_activity');
    });

    it('away wins over everything else', () => {
        const away = prefs({ away_until: new Date(now.getTime() + 3600000) });
        expect(assessPresence(history(10), now, away).state).toBe('away');
        const ended = prefs({ away_until: new Date(now.getTime() - 1) });
        expect(assessPresence(history(10), now, ended).state).toBe('unusual');
    });

    it('a once-a-day sensor that has not fired yet today is not reported as broken', () => {
        const events = [...history(10, 'kitchen_motion'), ...Array.from({ length: 10 }, (_, i) => ev(i + 1, 6, 0, 'bedroom_motion'))];
        expect(assessPresence(events, now, prefs()).stale_sources).toEqual([]);
    });

    it('a sensor silent for two days while others report is reported as unavailable', () => {
        const events = [
            ...history(10, 'kitchen_motion'), ev(0, 7, 30),
            ...Array.from({ length: 8 }, (_, i) => ev(i + 3, 6, 0, 'front_door')),
        ];
        const a = assessPresence(events, now, prefs());
        expect(a.stale_sources.map((s) => s.source)).toEqual(['front_door']);
    });
});

describe('the policy filters the view (allowlist, not deletion)', () => {
    const events = [...history(10), ev(0, 7, 35), ev(0, 9, 10, 'front_door')];
    const a = assessPresence(events, now, prefs());
    const keys = (level: ParentPreferences['level']) => Object.keys(renderPresenceView(a, prefs({ level, recovery_until: new Date(now.getTime() + 86400000), recovery_extras: ['night_rest'] }), { name: 'Mom' })).sort();

    it('light has no timing and no events', () => {
        expect(keys('light')).not.toContain('timing');
        expect(keys('light')).not.toContain('events');
        expect(keys('light')).not.toContain('extras');
        const json = JSON.stringify(renderPresenceView(a, prefs({ level: 'light' }), { name: 'Mom' }));
        expect(json).not.toMatch(/07:35|09:10|front door/i);
    });

    it('rhythm adds timing only', () => {
        expect(keys('rhythm')).toContain('timing');
        expect(keys('rhythm')).not.toContain('events');
    });

    it('glimpse adds behaviour-only descriptions, never payloads', () => {
        const v = renderPresenceView(a, prefs({ level: 'glimpse' }), { name: 'Mom' });
        expect(v.events?.map((e) => e.description)).toEqual(['Front door: movement', 'Kitchen motion: movement']);
        expect(JSON.stringify(v)).not.toMatch(/payload/);
    });

    it('recovery adds only the extras the parent chose', () => {
        const v = renderPresenceView(a, prefs({ level: 'recovery', recovery_until: new Date(now.getTime() + 86400000), recovery_extras: ['night_rest'] }), { name: 'Mom', medications: [] });
        expect(Object.keys(v.extras ?? {})).toEqual(['night_rest']);
    });

    it('light Why Cards carry no times', () => {
        const late = assessPresence([...history(10), ev(0, 10, 30)], now, prefs());
        const v = renderPresenceView(late, prefs({ level: 'light' }), { name: 'Mom' });
        expect(v.why_cards).toHaveLength(1);
        expect(JSON.stringify(v.why_cards)).not.toMatch(/10:30|07:30/);
    });
});

describe('Why Cards', () => {
    it('ground the unusual-morning card in the baseline, with provenance', () => {
        const sim = simulate('quiet_morning', now);
        const events: PresenceEvent[] = sim.map((e, i) => ({ id: String(i), source: e.source, kind: e.kind, provenance: 'simulator', simulated: true, occurred_at: e.occurred_at }));
        const v = renderPresenceView(assessPresence(events, now, prefs({ level: 'rhythm' })), prefs({ level: 'rhythm' }), { name: 'Mom' });
        const card = v.why_cards[0];
        expect(card.rule).toBe('no_activity_by_usual_time');
        expect(card.provenance).toBe('simulated');
        expect(card.difference).toMatch(/usually first active by \d\d:\d\d/);
        expect(card.evidence.length).toBeGreaterThan(0);
        expect(card.next_step).toMatch(/call/i);
        expect(v.simulated).toBe(true);
    });

    it('a silent hub card is marked unavailable, with low confidence', () => {
        const events = history(10).filter((e) => e.occurred_at < new Date(now.getTime() - 30 * 3600000));
        const v = renderPresenceView(assessPresence(events, now, prefs({ level: 'rhythm' })), prefs({ level: 'rhythm' }), { name: 'Mom' });
        expect(v.why_cards[0]).toMatchObject({ provenance: 'unavailable', confidence: 'low' });
    });
});

describe('simulator', () => {
    it('is reproducible for the same scenario, seed and clock', () => {
        for (const s of SIM_SCENARIOS) expect(simulate(s, now, 7)).toEqual(simulate(s, now, 7));
    });

    it('changes with the seed and keeps ids unique', () => {
        expect(simulate('normal_day', now, 1)).not.toEqual(simulate('normal_day', now, 2));
        const ids = simulate('normal_day', now).map((e) => e.external_id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('never produces future events', () => {
        for (const s of SIM_SCENARIOS) expect(simulate(s, now).every((e) => e.occurred_at <= now)).toBe(true);
    });

    it('each scenario lands on the state it is meant to show', () => {
        const states = Object.fromEntries(SIM_SCENARIOS.map((s) => {
            const events = simulate(s, now).map((e, i) => ({ id: String(i), source: e.source, kind: e.kind, provenance: 'simulator', simulated: true, occurred_at: e.occurred_at }));
            return [s, assessPresence(events, now, prefs()).state];
        }));
        expect(states).toEqual({ quiet_morning: 'unusual', normal_day: 'normal', new_setup: 'insufficient_data', sensor_offline: 'signal_unavailable' });
    });
});
