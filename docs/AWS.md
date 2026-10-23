# Hearth on AWS: Ask Hearth with Amazon Bedrock

Hearth uses **Amazon Bedrock** (Converse API with tool use) to answer a family
member's question in plain words, for example "How is Mom doing today?" or
"Who is covering the errands this week?". The default model is
**Amazon Nova 2 Lite** through the global inference profile
`global.amazon.nova-2-lite-v1:0`.

## Where it is in the code

| Piece | File |
| --- | --- |
| Agent loop (Converse + tool use, up to 5 turns) | `server/src/lib/hearth/askHearth.ts` |
| HTTP endpoint `POST /api/hearth/ask` | `server/src/routes/hearth.ts` |
| Dashboard card "Ask Hearth" | `client/src/pages/Hearth.tsx` (`AskHearthCard`) |
| Tests with a scripted Bedrock client | `tests/integration/hearth.test.ts`, "Ask Hearth on Amazon Bedrock" |

SDK: `@aws-sdk/client-bedrock-runtime` (`BedrockRuntimeClient`, `ConverseCommand`).

## How it works

1. The family member asks a question in the dashboard.
2. Hearth sends it to Bedrock with a system prompt and six read-only tools:
   `get_presence_summary`, `list_why_cards`, `list_family_tasks`,
   `list_upcoming_visits`, `list_pending_proposals`, `get_local_weather`.
3. When the model asks for a tool, Hearth runs it on the server and returns
   the result in a `toolResult` block, then calls Converse again.
4. The final text goes back to the dashboard with the model id and the list of
   tools used.

What the model can and cannot do is enforced in code, not in the prompt:

- Every presence tool reads through `presenceViewFor`, the same function the
  app, the kiosk and the Alexa+ MCP server use. At the parent's Light level the
  model receives a status only: no times, no events. A test checks the exact
  tool result sent to Bedrock.
- Each read is written to the Trust Ledger as "<member> via Ask Hearth"
  (channel `bedrock`), plus one `ask_hearth` entry with the mode, model and
  tools. The question text is not stored.
- There are no write tools. The model can suggest; approving anything stays
  with a person.
- The only outside lookup is public weather from open-meteo.com, using the
  parent's city coordinates and nothing else.
- If Bedrock is not configured, refuses, or throttles, the family gets the
  deterministic status, labelled "Basic answer", with the reason.

## Configuration

```
HEARTH_BEDROCK_MODEL_ID=global.amazon.nova-2-lite-v1:0
HEARTH_BEDROCK_REGION=ap-south-1        # any region where the profile is available
```

Credentials come from the standard AWS chain (environment variables, `~/.aws`,
or an IAM role on the host). Minimum IAM policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["bedrock:InvokeModel"],
    "Resource": [
      "arn:aws:bedrock:*:*:inference-profile/global.amazon.nova-2-lite-v1:0",
      "arn:aws:bedrock:*::foundation-model/amazon.nova-2-lite-v1:0"
    ]
  }]
}
```

Leave `HEARTH_BEDROCK_MODEL_ID` empty to run without AWS.

## Status (2026-10-22)

- The agent loop, the policy filtering of tool results, the ledger entries and
  the fallbacks are covered by tests that use a scripted Bedrock client.
- Live calls from our AWS account currently fail: the first call returned
  `AccessDeniedException: Your account is currently being verified`, later
  calls return `ValidationException: Operation not allowed` in both
  `ap-south-1` and `us-east-1`, with or without tools. Hearth shows the basic
  answer and says why. Once AWS finishes the verification, no code change
  is needed. Check with:

```bash
aws bedrock-runtime converse --region ap-south-1 --model-id global.amazon.nova-2-lite-v1:0 \
  --messages '[{"role":"user","content":[{"text":"Say ok"}]}]' --inference-config '{"maxTokens":10}'
```
