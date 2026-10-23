# Hearth demo

Reproduces the main flow end to end on one machine, without Docker. Every
sensor event in the demo is simulated and labelled as such on screen.

Run it after about 07:00 local time: the simulator places Margaret's usual
morning about three hours before "now", so the quiet-morning state appears.

## 1. Start

```bash
npm install
npm run db:pglite                     # terminal 1: PostgreSQL (PGlite) on 127.0.0.1:55432
```

`.env` at the repository root (copy `.env.example`, then set):

```
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=55432
POSTGRES_USER=postgres
POSTGRES_DB=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_POOL_MAX=1
JWT_SECRET=<openssl rand -hex 32>
```

```bash
npm run dev                           # terminal 2: API :3001 + app :5173
npm run demo:seed                     # terminal 3: prints logins, a kiosk code and an Alexa+ token
```

The seed can be re-run at any time: it deletes and recreates only the demo
circles and the `@demo.hearth.test` accounts. Password for all accounts:
`HearthDemo!2026`.

## 2. The family's view

1. Open http://localhost:5173 and sign in as `alex@demo.hearth.test`.
2. Hearth shows **Unusual pattern: review suggested** for Margaret, with the
   banner "Demo data: these sensor events are simulated".
3. "How Hearth knows" compares today with 9 simulated days. Margaret shares at
   **Rhythm**, so Alex sees times but the page says event details are not shared.
4. The Why Card explains what was observed, the usual time, the evidence,
   *Simulated* and *Medium confidence*, and one next step (call).
5. Switch the circle (top left) to **Walter**: **Not enough data**, 3 of 7
   days. Hearth never calls a day normal without a baseline.

## 3. Margaret decides

1. In a second browser profile (or a private window), open
   http://localhost:5173/kiosk/pair and enter the code printed by the seed.
2. Tap **Family and sharing**, then **What my family sees**, then **Glimpse**.
   The screen confirms what the family now sees.
3. Back in Alex's window the dashboard updates: today's event list appears.
   Choose **Light** on the kiosk: times and events disappear from Alex's view.
   This is enforced by the API, not hidden by the page:
   `curl -H "Authorization: Bearer <alex jwt>" -H "X-Circle-Id: <id>" localhost:3001/api/hearth/overview`
   returns no `timing` or `events` fields at Light.
4. Alex opens **Sharing and trust**: the dial is read-only for him ("Only
   Margaret or the delegate she chose can change this"). A direct
   `PUT /api/hearth/policy` from his account returns 403 and the refusal is
   written to the Trust Ledger.

## 4. Coordination with confirmation

1. On Alex's dashboard, **Waiting for a decision** → **Look for ways to help**.
2. The Piggyback Planner proposes that Sam, who visits tomorrow, picks up the
   prescription refill and the groceries, and proposes a check-in call because
   the morning is unusual. Nothing is assigned yet (see Family responsibilities).
3. Approve the check-in with **I'll do it**: a "Call Margaret to check in" task
   appears, assigned to Alex. Sign in as `sam@demo.hearth.test` to approve
   the errands meant for Sam (Alex, as admin, could also decide them).
4. **Sharing and trust → Trust Ledger** lists each step: proposals created,
   approved, disclosures with the level and fields, the parent's level changes.

## 5. Moments

Alex: **Send a moment** (a message, or an mp4/webm under 4 MB). On the kiosk,
**Family and sharing → From your family** shows it, with **I've seen it**. The
family sees "Seen". Every moment states that TV delivery is not available.

## 6. Alexa+ (MCP)

The seed prints an assistant token for Alex. Any MCP client that speaks
Streamable HTTP can connect to `http://localhost:3001/mcp` with
`Authorization: Bearer hth_...`. Example with the official SDK, from `server/`:

```js
// node probe.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const transport = new StreamableHTTPClientTransport(new URL('http://localhost:3001/mcp'),
  { requestInit: { headers: { Authorization: 'Bearer hth_...' } } });
const client = new Client({ name: 'probe', version: '1' });
await client.connect(transport);
console.log(transport.protocolVersion);            // 2025-11-25
console.log((await client.callTool({ name: 'get_presence_summary', arguments: {} })).content[0].text);
```

Tools: `get_presence_summary`, `list_why_cards`, `list_family_tasks`,
`list_pending_proposals`, `propose_visit`, `suggest_coordination`,
`decide_proposal`, `send_message_to_parent`. Answers follow Margaret's level
and each one is logged as "Alex Rivera via Alexa+" in the Trust Ledger.
`decide_proposal` asks the user through MCP elicitation; a client that cannot
elicit gets an error and nothing changes.

This is protocol-tested against the SDK client (`tests/integration/hearth.test.ts`).
It has not been connected to the live Alexa+ service.

## 7. Verify

```bash
npm test                   # 318 tests, including the integration suite
npm run build
npm run smoke:api          # against the running server
```
