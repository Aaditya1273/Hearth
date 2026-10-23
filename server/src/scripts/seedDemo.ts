/**
 * Hearth demo seed: `npm run demo:seed` (from the repository root).
 *
 * Recreates two demo circles from scratch (deterministic, seed 42) and prints
 * the logins, a kiosk pairing code and an Alexa+ assistant token. Everything
 * it creates is marked: circles carry settings.hearth_demo = true, accounts
 * use the reserved @demo.hearth.test domain, sensor events are simulated.
 * It never touches circles that are not demo circles.
 *
 * Refuses to run with NODE_ENV=production unless HEARTH_SIMULATOR_ENABLED=true.
 */
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import pool, { runMigrations, query } from '../db';
import { pool as hearthDb, loadSimulation, recordLedger, writePreferences } from '../lib/hearth/store';
import { DEFAULT_PREFERENCES } from '../lib/hearth/policy';

const DOMAIN = 'demo.hearth.test';
const PASSWORD = 'HearthDemo!2026';
const SYSTEM = { kind: 'system' as const, label: 'Demo seed' };

async function user(email: string, name: string, hash: string): Promise<string> {
    const { rows } = await query(
        `INSERT INTO users (email, password_hash, name, language) VALUES ($1, $2, $3, 'en') RETURNING id`,
        [`${email}@${DOMAIN}`, hash, name]
    );
    return rows[0].id;
}

async function circle(name: string, adminId: string, recipient: { first: string; last: string; phone: string }): Promise<string> {
    // hearth_location: the city Ask Hearth uses for public weather until the
    // parent's own screen sets one.
    const { rows } = await query(
        `INSERT INTO care_circles (name, created_by, currency, settings) VALUES ($1, $2, 'USD', $3::jsonb) RETURNING id`,
        [name, adminId, JSON.stringify({
            hearth_demo: true, unit_system: 'imperial', week_start: 'sunday', emergency_numbers: '911',
            hearth_location: { name: 'Portland, Oregon', lat: 45.523, lon: -122.676 },
        })]
    );
    const id = rows[0].id as string;
    await query(`INSERT INTO care_recipients (circle_id, first_name, last_name, phone) VALUES ($1, $2, $3, $4)`, [id, recipient.first, recipient.last, recipient.phone]);
    return id;
}

async function member(circleId: string, userId: string, role: string, color: string): Promise<string> {
    const { rows } = await query(`INSERT INTO circle_members (circle_id, user_id, role, color) VALUES ($1, $2, $3, $4) RETURNING id`, [circleId, userId, role, color]);
    return rows[0].id;
}

async function main() {
    if (process.env.NODE_ENV === 'production' && process.env.HEARTH_SIMULATOR_ENABLED !== 'true') {
        throw new Error('Refusing to seed demo data in production (set HEARTH_SIMULATOR_ENABLED=true to override).');
    }
    await runMigrations();

    // Reset: only demo circles and demo accounts.
    await query(`DELETE FROM care_circles WHERE settings->>'hearth_demo' = 'true'`);
    await query(`DELETE FROM users WHERE email LIKE $1`, [`%@${DOMAIN}`]);

    const hash = await bcrypt.hash(PASSWORD, 12);
    const alex = await user('alex', 'Alex Rivera', hash);
    const sam = await user('sam', 'Sam Rivera', hash);
    const jordan = await user('jordan', 'Jordan Lee', hash);

    // ── Margaret: an established routine, but a quiet morning today ──
    const margaret = await circle("Margaret's circle (demo)", alex, { first: 'Margaret', last: 'Rivera', phone: '+1 555 0100' });
    const alexM = await member(margaret, alex, 'admin', '#3E6B54');
    const samM = await member(margaret, sam, 'family', '#B07D62');
    await member(margaret, jordan, 'viewer', '#44617C');

    await writePreferences(hearthDb, margaret, { ...DEFAULT_PREFERENCES, level: 'rhythm' });
    await recordLedger(hearthDb, margaret, SYSTEM, {
        action: 'policy_changed', category: 'sharing_policy', level: 'rhythm', detail: { from: 'light', to: 'rhythm', seeded: true },
    });
    const sim = await loadSimulation(margaret, 'quiet_morning', SYSTEM);

    const now = new Date();
    const at = (days: number, h: number, m = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, h, m);
    await query(
        `INSERT INTO tasks (circle_id, title, category, due_date, assigned_to) VALUES
         ($1, 'Pick up the prescription refill', 'pharmacy', $2, '[]'::jsonb),
         ($1, 'Groceries for the week', 'shopping', NULL, '[]'::jsonb),
         ($1, 'Replace the hallway smoke detector battery', 'other', $3, $4::jsonb)`,
        [margaret, at(1, 17), at(3, 12), JSON.stringify([alexM])]
    );
    await query(
        `INSERT INTO events (circle_id, title, category, start_time, end_time, member_ids, created_by)
         VALUES ($1, 'Sam visits Mom', 'visit', $2, $3, $4::jsonb, $5)`,
        [margaret, at(1, 10), at(1, 12), JSON.stringify([samM]), sam]
    );
    await query(
        `INSERT INTO hearth_moments (circle_id, author_user_id, kind, message) VALUES ($1, $2, 'message', $3)`,
        [margaret, sam, "Can't wait to see you tomorrow, Mom! I'll bring the photo album."]
    );

    const code = Array.from(crypto.randomBytes(8), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
    await query(
        `INSERT INTO kiosk_pairings (circle_id, code, kind, name, created_by, expires_at) VALUES ($1, $2, 'kiosk', $3, $4, $5)`,
        [margaret, code, "Margaret's kitchen tablet", alex, new Date(now.getTime() + 24 * 3600000)]
    );

    const token = `hth_${crypto.randomBytes(32).toString('hex')}`;
    await query(
        `INSERT INTO assistant_tokens (circle_id, user_id, token_hash, label) VALUES ($1, $2, $3, 'Alexa+ (demo)')`,
        [margaret, alex, crypto.createHash('sha256').update(token).digest('hex')]
    );

    // ── Walter: sensors installed three days ago, no baseline yet ──
    const walter = await circle("Walter's circle (demo)", alex, { first: 'Walter', last: 'Lee', phone: '+1 555 0101' });
    await member(walter, alex, 'admin', '#3E6B54');
    await writePreferences(hearthDb, walter, { ...DEFAULT_PREFERENCES, level: 'glimpse' });
    await loadSimulation(walter, 'new_setup', SYSTEM);

    console.log(`
Hearth demo ready (all sensor data is SIMULATED).

  Family app      http://localhost:5173  (or :3000 with Docker)
  Password        ${PASSWORD} for every account
    alex@${DOMAIN}    admin   (adult child, sees both circles)
    sam@${DOMAIN}     family  (visiting tomorrow at 10:00)
    jordan@${DOMAIN}  viewer

  Margaret's screen  open /kiosk/pair and enter ${code} (valid 24 h)
  Alexa+ (MCP)       POST http://localhost:3001/mcp
                     Authorization: Bearer ${token}

  Margaret: ${sim.events} simulated events, sharing level Rhythm, quiet morning today.
  Walter:   3 days of simulated events, Glimpse, not enough data yet.
`);
}

main()
    .catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => void pool.end());
