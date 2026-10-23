/**
 * Hearth presence simulator. Pure and seeded: the same scenario, seed and
 * reference clock always yield the same events. Every event is flagged
 * simulated with provenance 'simulator' and carries a deterministic external
 * id. The store only writes them into circles flagged as demo circles.
 *
 * Times are placed relative to `now` (the usual morning start is about three
 * hours before it) so a demo shows the intended state whenever it is run
 * after about 07:00 local time.
 */

export const SIM_SCENARIOS = ['quiet_morning', 'normal_day', 'new_setup', 'sensor_offline'] as const;
export type SimScenario = (typeof SIM_SCENARIOS)[number];

export interface SimEvent {
    external_id: string;
    source: string;
    kind: 'motion' | 'door' | 'power';
    occurred_at: Date;
}

/** mulberry32: tiny deterministic PRNG, good enough for demo jitter. */
function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const HISTORY_DAYS: Record<SimScenario, number> = { quiet_morning: 9, normal_day: 9, new_setup: 3, sensor_offline: 9 };

/** One simulated day: morning start, a few appliance/door uses, evening wind-down. */
const ROUTINE: Array<{ offset: number; source: string; kind: SimEvent['kind'] }> = [
    { offset: 0, source: 'bedroom_motion', kind: 'motion' },
    { offset: 12, source: 'kitchen_motion', kind: 'motion' },
    { offset: 20, source: 'kettle', kind: 'power' },
    { offset: 150, source: 'front_door', kind: 'door' },
    { offset: 240, source: 'kitchen_motion', kind: 'motion' },
    { offset: 420, source: 'living_room_motion', kind: 'motion' },
    { offset: 600, source: 'kettle', kind: 'power' },
    { offset: 780, source: 'hallway_motion', kind: 'motion' },
];

export function simulate(scenario: SimScenario, now: Date, seed = 42): SimEvent[] {
    const rand = rng(seed + SIM_SCENARIOS.indexOf(scenario) * 1000);
    const nowMinute = now.getHours() * 60 + now.getMinutes();
    const usualStart = Math.min(9 * 60, Math.max(4 * 60 + 30, nowMinute - 180));
    const events: SimEvent[] = [];
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const addDay = (dayOffset: number, upTo: Date | null) => {
        const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset);
        const start = usualStart + Math.round((rand() - 0.5) * 40); // +-20 min jitter
        ROUTINE.forEach((step, i) => {
            const minute = Math.min(23 * 60 + 50, start + step.offset + Math.round(rand() * 10));
            const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minute / 60), minute % 60);
            if (upTo && at > upTo) return;
            events.push({ external_id: `sim:${scenario}:${seed}:${dayOffset}:${i}`, source: step.source, kind: step.kind, occurred_at: at });
        });
    };

    for (let d = HISTORY_DAYS[scenario]; d >= 1; d--) addDay(-d, null);
    if (scenario === 'normal_day') addDay(0, now);
    if (scenario === 'sensor_offline') {
        // The hub stopped reporting 30 hours ago: drop everything after that.
        const cutoff = new Date(now.getTime() - 30 * 60 * 60 * 1000);
        return events.filter((e) => e.occurred_at <= cutoff);
    }
    return events;
}
