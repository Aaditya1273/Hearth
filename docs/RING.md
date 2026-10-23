# Hearth on Ring: the front door as a presence source

Hearth reads the rhythm of the front door, not its picture. A Ring doorbell or
contact sensor becomes one more presence source next to Home Assistant and the
parent's Hearth screen, behind the same Glimpse Dial and Trust Ledger.

## Where it is in the code

| Piece | File |
| --- | --- |
| Mapping, signature check, API client, history import | `server/src/lib/hearth/ring.ts` |
| `POST /api/ring/webhook` (public, signed), `GET /api/ring/status`, `POST /api/ring/sync` (admin) | `server/src/routes/ring.ts` |
| "Ring front door" panel on Sharing & trust (admin) | `client/src/components/app/RingConnect.tsx` |
| Tests | `tests/server/hearthRing.test.ts`, `tests/integration/hearth.test.ts` ("Ring Partner API") |

Ring API used: `GET /v1/devices`, `GET /v1/users/me`,
`GET /v1/history/devices/{id}/events?event_types=…` (with `links.next`
paging), and the v1.1 webhooks `motion_detected` and `contact_sensor_faulted`.
Every request carries the required `User-Agent` and `Hardware_Id` headers.

## What Hearth keeps, and what it refuses

| Ring event | Hearth signal |
| --- | --- |
| `motion_detected`, sub_type `human` | door movement, confidence 0.8 |
| `motion_detected`, sub_type `motion` / `other_motion` (Smart Alerts off) | door movement |
| `contact_sensor_faulted` (door opened) | door used |
| history `motion` | door movement |
| `vehicle`, `package_delivery`, `button_press` / `ding` | ignored: not the parent's own rhythm (a doorbell press is a visitor; counting it would turn an unanswered ring into a "normal day") |

Hearth never calls the live view, video clip or image endpoints. Only a
source name, a kind and a time are stored.

## Two ways in

1. **Import (works today with the Developer Playground).** An admin pastes a
   Ring access token on *Sharing & trust → Ring front door*. Hearth reads the
   devices and their event history once. The token is used for that call
   only and is never stored; the Ring account id and device names are kept so
   webhooks can be routed. Each import is written to the Trust Ledger.
   In the Playground, the Motion / Package / Vehicle buttons record a
   simulated live-view event (`on_demand`). With the Playground box ticked,
   those become door movement marked **simulated** (`provenance
   ring_playground`) everywhere in the app; without it they are ignored.
2. **Signed webhooks (real Ring accounts).** Set `RING_HMAC_SIGNING_KEY` and
   register `https://<your server>/api/ring/webhook` in the Ring Developer
   Portal. Hearth checks `X-Signature` (HMAC-SHA256, hex) over the raw body
   before parsing, stores each delivery once (keyed on `meta.request_id`),
   and answers 200 for events it ignores so Ring does not disable the
   endpoint. The Playground sends no webhooks, so this path is covered by
   signed test deliveries.

## Not built

- Ring Appstore account linking (token exchange URL, HMAC nonce, POST + PATCH
  app-integrations). It needs a Developer Portal app with staging users, and
  the docs limit testing to US devices.
- Chime audio and sensor polling: neither is available in the Playground.
