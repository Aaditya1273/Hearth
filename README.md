# Hearth: Family Presence for Aging Parents

> **Know that Mom had a normal day. Let Mom decide what the family gets to know.**
>
> Hearth is built on [OpenCare](https://github.com/NexaFlowFrance/OpenCare) (AGPL-3.0). It is not a medical device or an emergency service.

## What works today

This repository is a working app (Express + PostgreSQL + React), not a mockup. Everything below runs locally and is covered by tests unless the row says otherwise.

| Feature | Status | Where |
| --- | --- | --- |
| Family dashboard: status, how Hearth knows, Why Cards, visits, responsibilities, proposals, moments | Working, tested | `client/src/pages/Hearth.tsx`, `GET /api/hearth/overview` |
| Glimpse Dial (Light, Rhythm, Glimpse, Recovery with auto-expiry), enforced on the server | Working, tested | `server/src/lib/hearth/policy.ts` |
| Only the parent's screen or their chosen delegate can change it; family and admins cannot | Working, tested | same |
| Trust Ledger: disclosures, policy changes (and refused attempts), proposals, moments, written in the same transaction | Working, tested | `trust_ledger` table, `/hearth/trust` page |
| Presence engine: no baseline means "not enough data", never "normal"; silent sensors are a data state, not an incident | Working, tested | `server/src/lib/hearth/presence.ts` |
| Why Cards from deterministic rules, with evidence, confidence and provenance (real, simulated, unavailable) | Working, tested | same |
| Piggyback Planner: proposes errands that fit a planned visit and a check-in when the morning is unusual; nothing happens until a person approves | Working, tested | `server/src/lib/hearth/proposals.ts` |
| Hearth Moments (message, short video, confirmed visit) on the parent's kiosk | Working | kiosk "Family and sharing" panel |
| Parent kiosk: large targets, sharing dial, delegate, "I'm away", honest help button | Working | `client/src/components/app/KioskHearth.tsx` |
| **Alexa+ track**: self-hosted MCP server, Streamable HTTP, protocol 2025-11-25, scoped tokens, policy-filtered answers, human confirmation by MCP elicitation | Working, protocol-tested with the official MCP SDK client | `server/src/routes/mcp.ts` |
| **AWS: Ask Hearth** on Amazon Bedrock (Nova 2 Lite, Converse API with tool use). Tools read through the same sharing policy, have no write access, and every read is in the Trust Ledger; public weather (Open-Meteo) is the only outside lookup | Working, tested with a scripted Bedrock client. **Live calls blocked until AWS finishes verifying our account**; meanwhile it returns a labelled basic answer. See [docs/AWS.md](docs/AWS.md) | `server/src/lib/hearth/askHearth.ts` |
| **Ring front door** through the Ring Partner API: event history (works with the Ring Developer Playground) and HMAC-verified webhooks for person motion and contact sensors. No video, pictures or live view; vehicles, deliveries and the doorbell button are ignored | Working, tested with a scripted Ring API and signed webhooks. Playground events are marked simulated. Account linking for the Ring Appstore is not built. See [docs/RING.md](docs/RING.md) | `server/src/lib/hearth/ring.ts` |
| Presence events from Home Assistant (webhook, idempotent `event_id`) | Working (existing OpenCare feature, extended) | `POST /api/presence/webhook/...` |
| Deterministic simulator and demo seed | Working, tested; demo circles only; every event flagged simulated | `npm run demo:seed` |
| Connection to the live Alexa+ service | **Not done**: needs Amazon developer access. The MCP server has only been exercised by the SDK client in tests | |
| Ring, Fire TV / Vega OS, Bee | **Not built.** No credentials, devices or simulators were available; nothing in the code claims otherwise | |
| TV delivery of moments | **Not available**; every moment says so | |

Hearth screens are in English. The rest of the OpenCare app keeps its French, English and Spanish translations.

## Quick start

```bash
npm install
npm run db:pglite          # PostgreSQL in-process (PGlite), no Docker; or use docker-compose up -d postgres
cp .env.example .env       # then set POSTGRES_PORT=55432, POSTGRES_USER=postgres, POSTGRES_DB=postgres,
                           # POSTGRES_POOL_MAX=1 and a JWT_SECRET (openssl rand -hex 32)
npm run dev                # API on :3001, app on :5173
npm run demo:seed          # demo circles, logins, kiosk pairing code, Alexa+ token
```

The step-by-step demo is in [docs/HEARTH_DEMO.md](docs/HEARTH_DEMO.md). Docker, reverse proxy and backups are in [INSTALLATION.md](INSTALLATION.md).

| Command | What it does |
| --- | --- |
| `npm test` | All tests: unit tests plus the integration suite (real Express app, real SQL in PGlite, real MCP client) |
| `npm run test:integration` | Integration suite only |
| `npm run build` | Production build (shared, server, client) |
| `npm run smoke:api` | End-to-end API smoke test against a running server |

### Environment

Secrets live only in `.env` (git-ignored). Hearth adds two optional settings to the OpenCare ones in `.env.example`:

- `HEARTH_SIMULATOR_ENABLED=true` allows the simulator and `demo:seed` when `NODE_ENV=production` (off by default).
- `POSTGRES_POOL_MAX` caps the database pool; set it to `1` with PGlite.
- `HEARTH_BEDROCK_MODEL_ID` (for example `global.amazon.nova-2-lite-v1:0`) and `HEARTH_BEDROCK_REGION` turn on Ask Hearth; credentials come from the standard AWS chain. See [docs/AWS.md](docs/AWS.md).
- `RING_HMAC_SIGNING_KEY` turns on the signed Ring webhook. Importing from Ring needs no setting: an admin pastes a token on the Sharing & trust page. See [docs/RING.md](docs/RING.md).

Alexa+ tokens are created per member in the app (Sharing and trust), shown once and stored hashed.

## How the parent stays in control

Every request for presence data, from the app, the kiosk or Alexa+, goes through one function (`presenceViewFor`): authenticate, check circle membership and role (admin, family, viewer only), apply the parent's current level, build the answer from an allowlist of fields, and write the disclosure to the Trust Ledger before answering. Recovery that has run out is reported as the previous level immediately and rewritten with a ledger entry. Approving a proposal, changing the level, the delegate or the away status each commit together with their ledger row or not at all.

The parent's identity is their paired kiosk or phone. A family admin pairs that device, so the device is only as private as the home it sits in; every change it makes is recorded with the device name.

## Known limitations

- The Glimpse Dial governs Hearth presence data (status, timings, event descriptions, Why Cards, Alexa+). Existing OpenCare modules (medications, journal, vitals) keep their role-based permissions.
- The baseline needs 7 active days in the last 14; until then the status stays "not enough data".
- With PGlite the database runs one connection at a time; use PostgreSQL 14+ in production.
- The static GitHub Pages demo build (`VITE_DEMO`) has no Hearth backend, so Hearth screens do not work there.
- Docker images were not rebuilt in this environment (no Docker daemon); the Dockerfiles were updated but not test-built.

## License and attribution

Hearth is a modified version of OpenCare by NexaFlow, distributed under the GNU Affero General Public License v3.0 ([licence.md](licence.md)). If you run a modified version as a network service, the AGPL requires you to offer its source code to its users.

---

## Product vision

The rest of this document is the product vision and pitch. Where it describes surfaces or infrastructure that are not in "What works today" (Ring, Fire TV, Bee, EventBridge, DynamoDB, Bedrock-generated Why Cards), it describes the target, not this build. Bedrock is used today for Ask Hearth only.

## The pitch

**Hearth is a light that tells you Mom had a normal day, controlled by Mom, with a family that earns the right to look by showing up.**

Hundreds of millions of adult children ask the same question every morning: is my parent okay? The answers on the market are cameras parents refuse, pendants they take off, and a WhatsApp group where meds and visits get lost. Hearth turns the three devices an older parent already uses without being asked, the TV, the front door, and the voice assistant, into a passive presence layer. The parent owns what is shared; the family gets a daily signal, an explanation when something is off, and a coordinator that does the planning. No new hardware, no video by default, no nagging.

Amazon built a version of this (Care Hub, then Alexa Together at $19.99/month) and retired it in May 2025. Hearth is what that product should have been, rebuilt on Alexa+, Ring, Fire TV, and Bee, with the parent as a participant rather than a subject.

## The problem

One in four Americans is a family caregiver, and most older adults want to stay in their own home. The daily cost of that preference lands on an adult child, usually one sibling, usually at a distance, carrying three burdens at once.

**Burden 1: not knowing.** The question "is Mom okay today?" has no good answer. A phone call is a chore for both sides and gets skipped. A camera is surveillance: an NRI engineer on Blind whose father lives alone in India tried cameras and called it painful because someone has to keep watching. A pendant only works if worn and charged; a caregiver on r/eldercare reports her grandmother with dementia forgot to press hers twice in one week.

**Burden 2: coordinating.** Care is run out of group chats. A thread on r/CaregiverSupport titled "How are you and your siblings coordinating care?" lists appointments, new meds, follow-ups and insurance paperwork tracked in a messy group chat and random Google Calendar entries. Another asks whether any family coordination app exists because group texts get messy fast. A third, "My parents never made a plan. I became the plan," describes one person coordinating between three doctors who don't talk to each other.

**Burden 3: the parent's dignity.** Every current tool treats the parent as the thing being watched. Interview research with ten older adults and their caregivers found they manage care by deciding which child handles which task and by not letting any one child see everything. Some gave up daily activities rather than burden their children. Tools that broadcast everything to everyone break the way older adults actually protect their autonomy.

| Current answer | Why it fails | Who rejects it |
| --- | --- | --- |
| Cameras | Surveillance; someone must watch; parent feels spied on | Parent |
| Fall pendants | Taken off, uncharged, forgotten; monthly fee | Parent |
| Daily check-in apps (Snug, OneTapSafe) | Needs a smartphone and a daily tap; binary signal | Parent, then family |
| Phone calls | Intrusive, skipped, one data point a day | Both |
| WhatsApp group | Meds, visits and decisions get buried | Family |
| Sensor kits ($299 + $40/mo) | New hardware, surveillance framing, false alarms | Both |
| Live tele-caregivers ($600–$1,000+/mo) | Cost and maximum intrusion | Both |

The common thread: every tool serves the watcher. None serves the person being cared for, and none connects the signal (is she okay) to the work (who does what).

## The painkiller test

Hearth is bought at a moment of fear, used daily out of love, and kept because it removes a recurring argument. That is the shape of a painkiller, not a vitamin.

**The purchase moment.** Families buy after a scare: a fall, a hospital discharge, an unanswered phone, or a news story. The Nancy Guthrie case this year, where doorbell-camera footage showed an armed intruder at an older woman's home, produced a wave of "is my parent safe at home?" advice columns. Research confirms the pattern: older adults' comfort with home sensors rises sharply when they feel a need for monitoring while alone or recovering from illness. Hearth's Recovery mode exists for exactly that moment.

**The daily use.** Reassurance fades into background once the Light is reliably green, so Hearth gives both sides a second daily reason. The adult child opens it to send a 20-second video to the TV; the parent turns on the TV to receive one. Checking on Mom becomes a side effect of being present for her.

**The retention reason.** Sibling resentment is the most common thread in caregiver forums: one person does everything and the others get "only the big updates." Hearth makes the division of labor explicit, assigned by the parent, and proposes who should do what. Remove that argument and the family does not cancel.

**Proof that people will pay.** Amazon charged $19.99/month for Alexa Together's activity feed and support circle. Density's Routines charges $99 per sensor plus $10/month on the Ring Appstore. Snug charges $20/month for its dispatch plan. Tele-caregiving runs $600 to $1,000+/month. The willingness to pay is established; what's missing is a product that doesn't require new hardware or the parent's surrender.

## Market

The aging-in-place smart-home segment is projected to reach $14 billion by 2028, and the top 50 elder-care startups tracked by Dealroom have raised $12 billion combined, including 14 unicorns. Funding volume cooled in early 2026, but the AI-powered monitoring layer kept attracting capital, and AARP's AgeTech Collaborative brought its largest cohort yet to CES 2026 with nearly a third of startups AI-focused.

| Buyer | What they pay for | Price point | Channel |
| --- | --- | --- | --- |
| Adult child (consumer) | Peace of mind + coordination | $9–12/month family plan | Ring Appstore, Fire TV Appstore, Alexa+ add-on |
| Home-care agency (B2B2C) | Visit confirmation, client dashboard, fewer calls | Per-client/month | Direct sales; Honor-style networks ($322M raised) |
| Medicare Advantage / insurer | Early-deviation signals that reduce ER visits | Per-member/month | Partnerships after outcome data |
| Senior-living operator | Resident presence across units | Per-unit/month | Alexa Smart Properties channel |

**Installed base is the moat.** Roughly 600 million Alexa-enabled devices have been sold, Ring has more than 100 million cameras in the field, and Fire TV is one of the largest connected-TV platforms. Hearth's addressable base is every home where an older adult already has one of those three, which is most US homes with an older adult.

**Geography.** US first: Ring Appstore, Alexa+, and Vega all launched US-only. India, the UK, and Germany follow as Alexa+ expands; the NRI-with-parents-in-India segment is a natural second market given the Blind-forum demand.

**Investability.** Series A gates for remote-monitoring companies run roughly $3–10 million in per-member revenue. The investor-grade story is: zero hardware cost, two app stores with billing built in, a cross-device rhythm model competitors can't replicate from one sensor, and an incumbent that validated demand then walked away.

## Why now

Five things changed in the last 18 months, and together they make Hearth possible for the first time.

1. **Alexa Together died and left a hole.** Amazon's Care Hub (2020, free) became Alexa Together (2021, $19.99/month) with an activity feed, care alerts, a support circle, and urgent response. Amazon retired it in May 2025. Guides written since tell families no single replacement exists and that they must stitch together a daily check-in, activity alerts, an emergency path, and a nearby helper. Those customers are orphaned and still paying for pieces.
2. **Alexa+ can now explain, not just log.** Old Alexa could say "no activity since 9 AM." Alexa+ with the MCP toolkit (spec 2025-11-25, Streamable HTTP, MCP Apps for on-screen cards) can hold family state across sessions, summarize a day in plain language, and orchestrate services. Research shows that is exactly what remote family members want: not what the sensors recorded, but how their parent is doing and why.
3. **Ring opened its cameras to developers.** The Ring Appstore launched this year with elder care as a headline category, launched with about 15 apps against a goal of hundreds by year end, and explicitly bans facial recognition and license-plate reading. A privacy-first caretaking app is the kind of app Ring is looking for.
4. **Fire TV is being rebuilt.** Vega OS replaces Android on all future Fire TV sticks and needs new apps outside plain streaming. A TV-native family presence card is the kind of non-streaming app the platform lacks.
5. **Bee joined Amazon.** Bee's co-founder describes Bee as understanding life outside the house and Alexa as understanding inside it, and Amazon's Alexa VP has said the two will come together. A product that joins the adult child's day (outside) to the parent's home (inside) is a working preview of that roadmap.

The hackathon brief itself names the target: connect the living room, the front door, and the cloud. Hearth is that sentence as a product.

## Competitive landscape

Every competitor is either a monitor or a coordinator. None is both, none gives the parent control, and all but one require new hardware.

| Product | What it does | Price | Parent control | Coordination | New hardware | Surfaces |
| --- | --- | --- | --- | --- | --- | --- |
| [Density Routines](https://ring.com/pages/appstore/routines) (Ring Appstore) | Radar sensor + Ring cameras learn routines; 14-day baseline; change alerts; live view; caregiver-arrival confirmation; AI chat | $99/sensor + $10/mo; Ring sub required | None | None | Yes (sensor) | Ring only |
| [Snug](https://savvysenior.org/?p=22307), OneTapSafe, LovedCircle, EchoCare | Daily "I'm OK" tap on a phone; missed check-in alerts contacts | Free–$20/mo | Tap only | Minimal | Phone | Phone only |
| [CarePenguin](https://solve.mit.edu/solutions/57636) | Water use as activity proxy | Low | None | None | Yes | Phone |
| People Power, SentryTell | Sensor kits + app | \~$299 + $40/mo | None | None | Yes | Phone |
| ResCare tele-caregivers | Humans watching cameras | $600–$1,000+/mo | None | Human | Yes (cameras) | Phone |
| Alexa Together (retired May 2025) | Activity feed, care alerts, support circle, urgent response | $19.99/mo | None | Circle | No | Echo only |
| **Hearth** | Presence light + explained deviations + parent-assigned coordination + family moments | $9–12/mo family | Glimpse Dial, Keep-a-Secret routing, Trust Ledger | Piggyback Planner | No | Echo, Ring, Fire TV, Bee, phone |

**Where Hearth is unique.** Zero new hardware. The parent as a participant with real controls. Signal fused with coordination. Cross-surface delivery (a door event becomes a TV caption, an Echo summary, and a phone glance). An errand-bundling agent grounded in published research on how families actually coordinate.

**Where Hearth is not unique and must not claim to be.** Routine-baseline learning and deviation alerts. Routines does it, and the literature is full of it (GRU-based routine-deviation detection in smart-home sensor networks, personalized routine modeling on CASAS homes, lifestyle monitoring from smart-meter data). Hearth's innovation is what it does with a deviation, not that it detects one.

## Research foundation

Six findings from 2025–2026 HCI and health-informatics research each produce one Hearth feature. Together they are the design rationale a judge or investor can check.

| Finding | Source | Hearth feature it produces |
| --- | --- | --- |
| Remote family members' sensemaking shifts from *what* data was collected to *how* their loved one is doing and *why* | [Li et al., Northeastern, 2026](https://www.alphaxiv.org/abs/2606.03876) | **Why Cards**: deviations delivered as an explanation with a suggested action, never a raw alert |
| Abstract, AI-generated "visual summaries" can give adult children awareness without raw video, protecting the older adult's dignity | ["A Glimpse, Not a Gaze", 2026](https://www.alphaxiv.org/abs/2606.05055) | **Glimpses**: door snapshots become behavior-only descriptions; live view is never the default |
| Older adults control care by assigning tasks to specific children and not letting any one child see everything; families use "piggybacking" (bundling errands that overlap) to cut caregiver effort | ["Can You Keep a Secret?", CMU, 2025](https://www.alphaxiv.org/abs/2512.12510) | **Keep-a-Secret routing** and the **Piggyback Planner** |
| High-agreeableness voice assistants are trusted more in routine scenarios, but clarity beats warmth in emergencies; real-time explanations beat history-based ones | ["Who wants to be nagged by AI?", 2026](https://www.alphaxiv.org/abs/2603.09012) | **Two voice modes** (warm routine, plain urgent) and explanations grounded in what is happening now |
| Higher automation in medication support did not produce higher trust across 53 participants | [Automation Boundaries, UTS, 2026](https://www.alphaxiv.org/abs/2606.28777) | **Propose, never auto-apply**: Bee-captured med changes require a human confirmation |
| Comfort with home sensors rises with perceived need (alone, recovering) and with stronger support from children | PMC12736577; PMC13465130 | **Recovery mode**: temporary higher sharing after illness, set by the parent, auto-expiring |

The literature also confirms the opposite: raw activity feeds and surveillance framing are the documented reasons older adults reject these tools. Hearth is built on what the research says works, and avoids what it says fails.

## The product

> Vision. Built today: the Glimpse Dial, Why Cards, Piggyback Planner, Moments (on the kiosk, not a TV) and the Trust Ledger. Keep-a-Secret routing, streaks and the Hearth Light on TV are not built yet.

Seven mechanics. The first is the thing people remember; the other six are why it is defensible.

**1. The Hearth Light.** A soft glow on every family device that means "normal day." Computed from rhythm, not from watching: the door opened near its usual time, the TV came on, a voice interaction happened, movement was ordinary. Green means normal, amber means quieter than usual, and the family gets detail only on amber. The parent sees the Light too, and sees what it was computed from.

**2. The Glimpse Dial.** The parent chooses, by voice or TV remote, how much the family sees. *Light only*: the glow and nothing else. *Rhythm*: door and TV timing summaries. *Glimpse*: behavior-only descriptions of door events ("delivery, package left at 2:10"). *Recovery*: full sharing for a set number of days after illness or discharge, then automatic return to the previous level. Every change is announced to the family. The parent turning the dial down on camera is the demo moment.

**3. Why Cards.** A deviation is never pushed as "ALERT: no activity." It arrives as a short explanation in Alexa+ voice and as an MCP App card on Echo Show: what is different, what it usually means, how confident Hearth is, and one suggested action ("a call around 11 would be normal, not alarming"). Warm tone for routine, plain and short for urgent.

**4. Keep-a-Secret routing.** The parent assigns domains to people: "Priya handles medicines, Raj handles the house, nobody but me sees the doctor notes." Hearth routes information accordingly, so each sibling's view differs by design. This is how older adults actually distribute care, and it ends the "one sibling does everything" argument by making the division explicit.

**5. The Piggyback Planner.** The agent watches the family plan and real-world context (calendars, Bee-captured mentions like "I'm near the pharmacy Thursday") and proposes bundles: "Raj is passing the clinic Thursday and the refill is ready Wednesday; move the pickup to Raj and cancel Priya's Saturday trip?" One confirmation executes it. This is the stateful, cross-service orchestration the Alexa+ rubric calls creative, with a named research basis nobody else has built on.

**6. Hearth Moments.** The daily habit loop, for the family rather than the parent. Anyone in the circle can send a 20-second video to the parent's TV, log a call, or confirm a visit. The parent's TV card shows new moments with a soft chime. The family app tracks a presence streak (days in a row someone showed up) and rotates "Light keeper" duty weekly. Grandchildren are the growth engine. Streaks are never attached to the parent's own check-ins; gamifying a parent's survival is both grim and, per the research on nagging, counterproductive.

**7. The Trust Ledger.** A parent-visible, TV-readable log of every glimpse shared: who saw what, when. It is the single strongest trust feature and it satisfies Ring's content-policy requirement that apps give customers easy access to monitoring activity logs.

**What Hearth refuses to do.** No facial recognition. No live video by default. No fall-detection claims it cannot verify. No sibling leaderboards. No AI companion chatbot for the parent. Each would weaken the privacy story that is the product's edge.

## Architecture

> Target architecture. This build runs the same ideas on the existing Express + PostgreSQL stack: typed events in `presence_signals`, the policy layer in `server/src/lib/hearth`, deterministic rules for every state and Why Card, Amazon Bedrock only for answering family questions (Ask Hearth, read-only tools), and the MCP server in `server/src/routes/mcp.ts`.

One shared core, four surfaces, two audiences. Each surface computes a meaningful Light from its own signals alone, so each stands as a product; the core fuses them when more than one is present.

&#91;embedded content: Hearth architecture · 4 surfaces, 1 core, 2 audiences\]

Signals flow down from the surfaces into the core; the core serves the family circle and the parent through the Sharing Policy, so the parent's Dial setting gates everything that leaves.

**Core components.** An EventBridge bus carries typed events (door.button, door.motion.human, tv.on, voice.interaction, bee.mention, plan.change). DynamoDB holds family state: members, domains, the plan, Dial level, baselines, and the ledger. Bedrock generates Why Cards, behavior-only scene descriptions, and Piggyback proposals. Lambda or AgentCore hosts the MCP server and the agent loop.

**Rhythm Engine.** A per-signal baseline (time-of-day distribution over a 14-day window, matching Routines' proven setup) plus a small set of named deviations: late start, quiet morning, no door by noon, unusual night activity, missed confirmation. Each deviation carries a plain-language cause template that Bedrock fills from live context, which is what makes a Why Card real-time rather than history-based.

**Standalone jobs per surface.** Ring: door rhythm, glimpses, three accessibility channels (lights, phone vibration, TV caption), caregiver-arrival confirmation. Fire TV: the parent's home card, Moments inbox, Dial, med nudges in natural viewing breaks. Alexa+: family queries, Why Cards, Keep-a-Secret routing, Piggyback Planner, Alexa Together import. Bee: doctor-visit capture to a proposed med change, passing mentions to plan candidates.

**Honesty about proactivity.** MCP is request-driven; Alexa+ invokes the server when asked. Hearth surfaces unresolved flags first on any request ("before that: Dad hasn't logged his 9 AM dose") and sends true push alerts through its own channel (SNS to phones), labeled as Hearth notifications rather than Alexa-initiated ones.

## Ethics and privacy by design

Privacy is Hearth's product, not its disclaimer. Five principles, each enforced in code and each mapped to a platform requirement.

| Principle | How it is enforced | Platform rule it satisfies |
| --- | --- | --- |
| The parent owns the Light | Glimpse Dial is parent-only; family cannot raise it; Recovery mode auto-expires | Ring: transparency and control for users |
| Glimpse, not gaze | Snapshots become behavior-only text; no identity, age, gender, or ethnicity attributes; no live view by default | Ring: no facial recognition, no cross-account correlation |
| Nothing is shared silently | Trust Ledger logs every glimpse with who, what, when; readable on the TV | Ring: easy access to monitoring activity logs |
| Information follows the parent's delegation | Keep-a-Secret routing; sibling views differ by design | Research: older adults control care by compartmentalizing it |
| Propose, never act alone | Med changes, plan changes, and visits require a human confirmation; two-mode voice (warm routine, plain urgent) | Alexa+ certification: no dead ends; accessibility support |

**Cognitive decline.** A parent who can no longer operate the Dial names a delegate in advance. The delegate's changes are logged in the Ledger with the delegate's name, so control is transferred transparently rather than lost.

**Not a medical device.** Hearth states plainly that it is not a fall-detection or emergency system, and routes "I need help" to Alexa Emergency Assist or local emergency services rather than claiming to handle it.

**Data minimization.** Raw media is processed and discarded; only the behavior description and the event timestamp persist. Baselines are stored per family, encrypted at rest, and deleted on request.

## Business model and investor narrative

Hearth sells peace of mind to the adult child, then sells fewer phone calls and better outcomes to the organizations that serve the parent.

**Revenue.** A family plan at $9–12/month (below Alexa Together's $19.99, which failed, and in line with Routines' $10). B2B2C through home-care agencies, which pay per client for visit confirmation and a client dashboard. Payer partnerships (Medicare Advantage, insurers) once deviation data shows fewer avoidable ER visits. Senior-living operators per unit through Alexa Smart Properties.

**Distribution.** The Ring Appstore and Fire TV Appstore are discovery and billing channels with zero customer-acquisition cost; Ring takes a 10% fee on partner sales. An Alexa+ add-on puts Hearth in front of every Prime household that upgrades. Alexa Together's orphaned customers are the first thousand users.

**Unit economics.** No hardware, no logistics, no installers. Cost per family is cloud inference and storage, well under $1/month at scale. A single Ring-connected family on a $10 plan is profitable from month one.

**The platform-risk question.** Investors will ask what happens if Amazon rebuilds this. The answer: Amazon tried, charged $19.99, and retired it in May 2025 during a devices-division cost-cutting wave that also ended HIPAA skills, celebrity voices, and Halo. Amazon's strategy since then is to run app stores and take a cut. Hearth is the partner that store wants, not a competitor Amazon needs to crush.

**The one-sentence investor pitch.** Demand is proven by an incumbent that charged for it, the hardware is already installed in most homes with an older adult, and the only thing missing is a product that gives the parent control.

## Risks and mitigations

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| "Amazon tried this and quit" | Alexa panel judges know Alexa Together existed | Name it first; show why the activity-feed model failed and what Alexa+ changes; offer an import path |
| Multiple entries judged as one project split four ways | Rules require each submission to be substantially different | Each repo stands alone with its own name, README, video, and a Light computed from its own signals; submit two, not four |
| Proactivity claims MCP can't deliver | Tech Implementation score drops if alerts are faked | Surface flags on any request; push through Hearth's own channel, labeled as such |
| False alarms | One 2 AM false "something's off" kills trust | 14-day baseline, confidence shown on every Why Card, an "away" mode, no alerts below a confidence floor |
| Cold start | Family sees nothing useful on day 1 | Day-1 mode shows Moments and the plan; the Light appears after baseline; a scenario simulator for demos |
| Ring sandbox limits | Playground may not stream live events; media is watermarked | Replay harness fires signed webhooks; vision prompts tested on watermarked frames |
| Routines already ships on Ring | "A worse Routines" is a losing pitch | Lead with accessibility and parent control; never pitch monitoring |
| Parent cannot operate the Dial | Cognitive decline | Named delegate, logged in the Ledger |
| Liability if the Light is green and a fall occurs | Legal and reputational | Explicit not-a-medical-device language; route help requests to Alexa Emergency Assist |
| US-only platforms | Limits early market | US first; India and Europe as Alexa+ and Ring expand |

## Hackathon mapping

Every submission is scored 1 to 5 on four equally weighted criteria after a pass/fail check that the required technology is used at runtime. Friction logs add up to 10%. The table shows where each track entry scores and the one mechanic that carries it.

| Track | Rubric's "creative" examples | Hearth entry | Carrying mechanic | Risk to a 5 |
| --- | --- | --- | --- | --- |
| Alexa+ ($25K 1st) | Agentic orchestration across services; state across sessions; MCP Apps; media cards | Hearth Circle: MCP server over Streamable HTTP + MCP App card | Piggyback Planner + Why Cards + Keep-a-Secret routing | Faked proactivity; the Alexa Together question unaddressed |
| Ring ($12K 1st) | Non-security use: accessibility, care-taking, event-based triggers, multi-camera pipelines | Hearth Door: webhook pipeline to glimpses and three accessibility channels | Glimpse Dial + Trust Ledger (policy-compliant by design) | Looking like Routines; attribute inference in scene descriptions |
| Fire TV ($25K 1st) | AI-enhanced viewing adapting to household patterns; multi-modal voice + D-pad + visual | Hearth TV on Vega: parent's card, Moments inbox, Dial, captioned events | Household-adaptive nudges in natural viewing breaks | Thin standalone case; Vega setup time |
| Bee ($12K 1st) | Cross-device orchestration; ambient context feeding a workflow; facts and insights | Hearth Pocket: doctor visit to proposed med change; mentions to plan candidates | Propose-never-apply confirmation loop | Requires real Bee or Apple Watch data |
| AWS Builder mini | Multi-service pipeline, agent orchestration | Bedrock + AgentCore/Lambda + EventBridge + DynamoDB | Documented in product feedback | None if documented |
| Open Source mini | Meaningful feature with tests; new integration pattern | Extracted event-bus and Ring webhook-verification library | Separate licensed repo | Must be a new, additional repo |

**Submission framing, in this order.** The Alexa Together gap (why now). Three research findings in one sentence each (how/why summaries, glimpse-not-gaze, parent-controlled information). The mechanic unique to that surface. The business path through the Ring and Fire TV app stores. That sequence demonstrates understanding of the developer ecosystem and the end user, which is the literal wording of the Quality of the Idea criterion.

**Demo video beats (under 3 minutes).** 0:00 the Light turns green on a phone, a TV, and an Echo Show, with one sentence: "Mom had a normal day, and Mom decided we could know that." 0:20 the problem in two lines with a real caregiver quote. 0:40 the parent turns the Glimpse Dial down on the TV and the family's view visibly shrinks. 1:10 a Why Card: quieter morning, here is why, here is what to do. 1:40 the Piggyback Planner proposes a bundle; one confirmation executes it. 2:10 the Trust Ledger on the TV. 2:30 the track's required technology shown in code for ten seconds, then the business line and the Alexa Together import.

**Product feedback and friction log.** Touching four SDKs lets Hearth report on the seams between them (Ring webhooks to Alexa+ state, Bee facts to a plan), which is exactly what the internal teams cannot see. Log every setup error from hour one.

## Sources

**Amazon's prior attempt**

- [Alexa Together launch and May 2025 retirement notice (Amazon)](https://www.aboutamazon.com/news/devices/alexa-together-launches-to-help-customers-remotely-care-for-loved-ones)
- [Alexa Together discontinued: what families use instead](https://parentshomecare.com/guides/alexa-together-discontinued)
- [What to use now that Alexa Together is gone (Beside Care)](https://www.besidecare.com/blog/what-to-use-now-that-alexa-together-is-gone/)
- [Care Hub launch (TechCrunch, 2020)](https://techcrunch.com/?p=2072645)
- [Alexa Together features (TechCrunch)](https://techcrunch.com/?p=2317705)
- [Amazon ends HIPAA Alexa skills; devices losses (TechCrunch)](https://techcrunch.com/?p=2455722)
- [Zombie Alexas: Care Hub notifications after a death](https://nealungerleider.substack.com/p/zombie-alexas)

**Platforms**

- [Ring Appstore launch (TechCrunch, March 2026)](https://techcrunch.com/2026/03/31/ring-app-store-bets-on-ai-to-go-beyond-home-security/)
- [Ring Appstore content policy](https://developer.amazon.com/docs/ring/content-policy.html)
- [Ring Partner API documentation](https://developer.amazon.com/docs/ring/api-documentation.html)
- [Alexa+ MCP toolkit overview](https://developer.amazon.com/docs/alexaplus/add-ons/mcp-toolkit-overview)
- [Alexa+ new ways to build (Amazon, July 2026)](https://developer.amazon.com/alexaplus/blogs/2026/07/alexa-plus-new-ways-to-build-experiences)
- [Why Amazon bought Bee (TechCrunch, Jan 2026)](https://techcrunch.com/2026/01/12/why-amazon-bought-bee-an-ai-wearable/)
- [Vega OS and the Fire TV transition (AFTVnews)](https://www.aftvnews.com/?p=46379)
- [Hackathon official rules](https://amazonappdev2026.devpost.com/rules)

**Competitors**

- [Density Routines on the Ring Appstore](https://ring.com/pages/appstore/routines)
- [Routines press release (pricing)](https://www.businesswire.com/news/home/20250723446325/en/New-AI-Assistant-Routines-Helps-Caregivers-Check-on-Seniors-Remotely-Without-Invading-Privacy)
- [Snug and check-in apps (Savvy Senior)](https://savvysenior.org/?p=22307)
- [CarePenguin (MIT Solve)](https://solve.mit.edu/solutions/57636)
- [Monitoring systems and costs (Berkeley Journalism)](https://journalism.berkeley.edu/projects/how-new-monitoring-systems-keep-a-close-watch-on-older-people/)
- [Tele-caregiver costs (NPR)](https://www.npr.org/2010/08/24/129104664/wired-homes-keep-tabs-on-aging-parents)

**Caregiver voices**

- [r/CaregiverSupport: sibling coordination](https://www.reddit.com/r/CaregiverSupport/comments/1ricuz1/how_are_you_and_your_siblings_coordinating_care/)
- [r/CaregiverSupport: family coordination apps](https://www.reddit.com/r/CaregiverSupport/comments/1n9kxm1/are_there_any_family_care_coordination_apps/)
- [r/CaregiverSupport: "I became the plan"](https://www.reddit.com/r/CaregiverSupport/comments/1skmxih/my_parents_never_made_a_plan_i_became_the_plan/)
- [r/eldercare: forgotten panic button](https://www.reddit.com/r/eldercare/comments/1rmskkv/my_grandma_has_dementia_and_forgot_to_use_her/)
- [Blind: remote care for a parent in India](https://www.teamblind.com/post/remote-healthcare-for-aging-parents-qqhnejfc)
- [Nancy Guthrie case and long-distance caregiving (AARP figures)](https://www.yahoo.com/lifestyle/articles/nancy-guthries-disappearance-highlights-common-120020005.html)

**Research**

- ["A Glimpse, Not a Gaze" (arXiv 2606.05055)](https://www.alphaxiv.org/abs/2606.05055)
- [From "What" to "How" and "Why" (arXiv 2606.03876)](https://www.alphaxiv.org/abs/2606.03876)
- [Can You Keep a Secret? (arXiv 2512.12510)](https://www.alphaxiv.org/abs/2512.12510)
- ["Who wants to be nagged by AI?" (arXiv 2603.09012)](https://www.alphaxiv.org/abs/2603.09012)
- [Designing Automation Boundaries for Smart Medication Support (arXiv 2606.28777)](https://www.alphaxiv.org/abs/2606.28777)

**Market and funding**

- [AgeTech funding update 2026 (Best Years)](https://www.bestyears.com/post/agetech-aids-aging-in-place)
- [Elder-care startups by funding (Dealroom)](https://dealroom.co/lists/elderly-care-startups/)
- [AI elder care fundraising guide 2026](https://startupfundraising.com/ai-elder-care-aging-in-place-fundraising)
- [Elder care investors list](https://www.ellty.com/blog/elder-care-investors)
