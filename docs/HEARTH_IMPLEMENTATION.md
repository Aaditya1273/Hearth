# Hearth implementation checklist

Hearth is built on the existing OpenCare code (Express + PostgreSQL + React/Vite,
AGPL-3.0). Nothing was re-scaffolded: Hearth adds one policy layer, a few tables
and screens, and reuses circles, roles, kiosk devices, tasks, calendar, visits,
notifications and the passive-presence webhook.

## Baseline found (2026-10-22)

| Area | State before Hearth | Hearth decision |
|---|---|---|
| Circles, roles (`admin/family/professional/neighbor/viewer`) | Working, enforced in `middleware/circle.ts` | Reused as step 1–3 of every check |
| Paired parent device (kiosk / phone, `X-Kiosk-Token`) | Working | The device **is the parent's identity** for policy changes |
| Passive presence (`presence_signals`, Home Assistant webhook) | Working, but `/status` said `normal_activity` after one signal, webhook URL visible to every member, raw payloads returned | Extended into the typed event model; status now goes through the presence engine and the sharing policy |
| "No sign of life" alert (`presenceMonitor`, `attention`) | Red/urgent, alarming wording | Amber "review suggested", neutral wording, skipped while parent is away |
| Tasks with `assigned_to` (member ids) | Working | Reused for assignment; proposals write through it |
| Calendar events (`category = 'visit'`, `member_ids`) | Working | Reused for upcoming visits and confirmed visits |
| Kiosk (large targets, help button, visitors) | Working | Extended with Moments, sharing dial, "I'm away" |
| Unit tests (vitest, pure logic) | 257 passing | Kept; Hearth adds pure tests + DB-backed integration tests (PGlite) |
| Smoke test (`scripts/smoke-api.sh`) | Passing | Still passing |

## Checklist (verified 2026-10-22)

- [x] Typed presence events: `presence_signals` + `provenance`, `simulated`, `external_id` (idempotent webhook `event_id`), `confidence`
- [x] Parent preferences (`parent_preferences`): level, Recovery expiry and previous level, delegate, away
- [x] Policy layer `server/src/lib/hearth/policy.ts`, used by REST, kiosk and MCP through `store.presenceViewFor`
- [x] Trust Ledger (`trust_ledger`), written in the same transaction as policy, delegate, away, proposal and moment changes; refused policy changes recorded too
- [x] Presence engine with explicit states; fewer than 7 baseline days ⇒ insufficient data; silent sensors ⇒ signal unavailable
- [x] Single-sensor staleness only after 48 h while other sensors report (a once-a-day sensor is not "broken" before it fires)
- [x] Why Cards (deterministic), with evidence, confidence, provenance; filtered per level (no times below Rhythm)
- [x] Proposals: assign errand, visit, check-in; approve/reject/expire; executed only on approval
- [x] Moments: message, short video (data URL, under 4 MB), confirmed visit; kiosk "seen"; TV delivery reported unavailable
- [x] Family dashboard `/`, Sharing and trust `/hearth/trust`; original dashboard kept at `/today`
- [x] Kiosk: Family and sharing panel (moments, dial, Recovery days and extras, delegate, away), honest help confirmation
- [x] Existing defects fixed: webhook URL was visible to every member (now admin only), raw payloads and "normal activity after one signal" removed, "no sign of life" alert reworded and downgraded from red to amber, skipped while away
- [x] Simulator + `npm run demo:seed` (demo circles only; refused in production unless `HEARTH_SIMULATOR_ENABLED=true`)
- [x] Alexa+ MCP server at `/mcp`: Streamable HTTP, protocol 2025-11-25 (SDK 1.32), hashed scoped tokens, sessions bound to their token, elicitation before any decision
- [x] Tests: `tests/server/hearth*.test.ts` (40 pure tests) and `tests/integration/hearth.test.ts` (21 tests: real app, SQL in PGlite, MCP SDK client)
- [x] `npm test` (318 passing), `npm run build`, `scripts/smoke-api.sh` passing
- [x] Fresh-install bootstrap and upgrade migrations both exercised
- [x] Docs: README "What works today", `docs/HEARTH_DEMO.md`

## Not verified here

- Docker images (no Docker daemon in the build environment). `server/Dockerfile` now ships `schema.sql`; `docker-compose.yml` now passes `.env` to the server.
- A live Alexa+ connection (needs Amazon developer access).

## Deliberately out of scope

- Ring, Fire TV / Vega OS, Bee: no credentials, devices or simulators here. No code pretends otherwise.
- The Glimpse Dial governs Hearth presence data (status, timings, event descriptions,
  Why Cards, MCP answers). Existing OpenCare modules (medications, journal, vitals)
  keep their role-based permissions; see README "Known limitations".
