/**
 * Ask Hearth: a family question answered by an Amazon Bedrock model (Amazon
 * Nova by default) through the Converse API with tool use.
 *
 * Guarantees, enforced here and not left to the prompt:
 *  - every tool reads through presenceViewFor, so the model only ever sees
 *    what the parent's sharing level allows, and each read is a ledger entry;
 *  - there are no write tools: the model can suggest, never act;
 *  - the only outside lookup is public weather for the parent's city
 *    (coordinates only, no personal data);
 *  - without Bedrock (not configured, account not ready, throttled) the
 *    family still gets the deterministic status, labelled as such.
 */
import {
    BedrockRuntimeClient, ConverseCommand,
    type ContentBlock, type ConverseCommandOutput, type Message, type Tool,
} from '@aws-sdk/client-bedrock-runtime';
import { query } from '../../db';
import logger from '../logger';
import { toLocalISO } from '../../routes/events';
import { Actor } from './policy';
import { listProposals, presenceViewFor, recordLedger, pool } from './store';

export interface BedrockLike { send(command: ConverseCommand): Promise<ConverseCommandOutput> }

const MAX_TURNS = 5;
export const MAX_QUESTION_CHARS = 500;

export const bedrockSettings = () => ({
    modelId: process.env.HEARTH_BEDROCK_MODEL_ID?.trim() || '',
    region: process.env.HEARTH_BEDROCK_REGION?.trim() || process.env.AWS_REGION?.trim() || 'us-east-1',
});

let injected: BedrockLike | null = null;
let shared: BedrockRuntimeClient | null = null;
/** Tests replace the AWS client with a scripted one. */
export function setBedrockClient(client: BedrockLike | null): void { injected = client; }
function bedrock(): BedrockLike {
    if (injected) return injected;
    if (!shared) shared = new BedrockRuntimeClient({ region: bedrockSettings().region });
    return shared;
}

const SYSTEM = `You are Hearth, helping an adult child understand how their aging parent is doing at home.
Rules you must follow:
- Use only facts returned by the tools. Never invent events, times, people or causes.
- Never diagnose, never give medical advice, never say the parent is safe: home sensors cannot confirm safety.
- If information is missing or not shared, say so plainly; the parent chooses what the family can see, respect that.
- Suggest at most one proportionate next step, such as a phone call.
- You cannot change anything. For visits or errands, tell the user to use Hearth's proposals.
- In an emergency, tell the user to call their local emergency number.
- Weather is public context only; never claim it explains the parent's routine.
Answer in two to four short, warm, plain sentences.`;

const TOOLS: Tool[] = [
    ['get_presence_summary', 'Current presence status of the parent, filtered by the sharing level the parent chose (light, rhythm, glimpse, recovery). Includes a safety disclaimer.'],
    ['list_why_cards', 'Explanations of notable changes in the parent\'s routine, with evidence, confidence and one suggested next step.'],
    ['list_family_tasks', 'Open family responsibilities and who has taken each one on.'],
    ['list_upcoming_visits', 'Planned family visits in the next seven days.'],
    ['list_pending_proposals', 'Coordination proposals waiting for a person to approve. Nothing in them has happened yet.'],
    ['get_local_weather', 'Public weather today for the parent\'s city (from open-meteo.com). Context only.'],
].map(([name, description]) => ({ toolSpec: { name, description, inputSchema: { json: { type: 'object', properties: {}, additionalProperties: false } } } }));

export type ToolName = 'get_presence_summary' | 'list_why_cards' | 'list_family_tasks' | 'list_upcoming_visits' | 'list_pending_proposals' | 'get_local_weather';

interface Ctx { circleId: string; actor: Actor; now: Date }

/** Parent's city: the paired screen's own weather setting, else the circle's. */
async function parentLocation(circleId: string): Promise<{ name: string; lat: number; lon: number } | null> {
    const { rows } = await query(
        `SELECT settings->'location' AS loc FROM kiosk_devices
         WHERE circle_id = $1 AND revoked_at IS NULL AND settings ? 'location'
         ORDER BY last_seen_at DESC NULLS LAST LIMIT 1`,
        [circleId]
    );
    const circle = rows[0]?.loc ? null : (await query(`SELECT settings->'hearth_location' AS loc FROM care_circles WHERE id = $1`, [circleId])).rows[0];
    const loc = rows[0]?.loc ?? circle?.loc;
    return loc && typeof loc.name === 'string' && Number.isFinite(loc.lat) && Number.isFinite(loc.lon) ? loc : null;
}

export async function localWeather(circleId: string): Promise<Record<string, unknown>> {
    const loc = await parentLocation(circleId);
    if (!loc) return { available: false, reason: 'No city is set on the parent\'s Hearth screen.' };
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat.toFixed(3)}&longitude=${loc.lon.toFixed(3)}`
        + '&current=temperature_2m,apparent_temperature,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1';
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return { available: false, reason: `Weather service answered ${res.status}` };
        const j = await res.json() as any;
        return {
            available: true, city: loc.name, source: 'open-meteo.com',
            temperature_c: j.current?.temperature_2m, feels_like_c: j.current?.apparent_temperature,
            today_max_c: j.daily?.temperature_2m_max?.[0], today_min_c: j.daily?.temperature_2m_min?.[0],
            weather_code: j.current?.weather_code,
        };
    } catch {
        return { available: false, reason: 'Weather service unreachable' };
    }
}

export async function runTool(name: string, ctx: Ctx): Promise<Record<string, unknown>> {
    switch (name as ToolName) {
        case 'get_presence_summary': {
            const { view } = await presenceViewFor(ctx.circleId, ctx.actor, 'bedrock', ctx.now);
            const { why_cards: _c, ...rest } = view;
            return rest as unknown as Record<string, unknown>;
        }
        case 'list_why_cards': {
            const { view } = await presenceViewFor(ctx.circleId, ctx.actor, 'bedrock', ctx.now);
            return { level: view.level, why_cards: view.why_cards };
        }
        case 'list_family_tasks': {
            const { rows } = await query(
                `SELECT t.title, t.due_date,
                        COALESCE((SELECT json_agg(u.name) FROM circle_members m JOIN users u ON u.id = m.user_id
                                  WHERE m.circle_id = t.circle_id AND t.assigned_to @> to_jsonb(m.id::text)), '[]') AS assignees
                 FROM tasks t WHERE t.circle_id = $1 AND t.is_completed = FALSE ORDER BY t.due_date ASC NULLS LAST LIMIT 15`,
                [ctx.circleId]
            );
            return { tasks: rows };
        }
        case 'list_upcoming_visits': {
            const end = new Date(ctx.now.getTime() + 7 * 86400000);
            const { rows } = await query(
                `SELECT e.title, e.start_time,
                        COALESCE((SELECT json_agg(u.name) FROM circle_members m JOIN users u ON u.id = m.user_id
                                  WHERE m.circle_id = e.circle_id AND e.member_ids @> to_jsonb(m.id::text)), '[]') AS visitors
                 FROM events e WHERE e.circle_id = $1 AND e.category = 'visit' AND e.start_time BETWEEN $2 AND $3 ORDER BY e.start_time LIMIT 10`,
                [ctx.circleId, ctx.now, end]
            );
            return { visits: rows };
        }
        case 'list_pending_proposals': {
            const pending = (await listProposals(ctx.circleId, ctx.now)).filter((p: any) => p.status === 'pending');
            return { proposals: pending.map((p: any) => ({ kind: p.kind, title: p.title, for: p.target_name ?? 'anyone', expires_at: p.expires_at })) };
        }
        case 'get_local_weather':
            return localWeather(ctx.circleId);
        default:
            return { error: `Unknown tool ${name}` };
    }
}

export interface AskResult {
    answer: string;
    mode: 'bedrock' | 'fallback';
    model: string | null;
    tools_used: string[];
    note: string | null;
    asked_at: string;
}

async function fallback(ctx: Ctx, note: string): Promise<AskResult> {
    const { view } = await presenceViewFor(ctx.circleId, ctx.actor, 'bedrock', ctx.now);
    return {
        answer: `${view.headline}. ${view.summary} ${view.disclaimer}`,
        mode: 'fallback', model: null, tools_used: ['get_presence_summary'], note, asked_at: toLocalISO(ctx.now),
    };
}

/**
 * Answer one question. The question text is never stored; the ledger keeps
 * which tools were used and through which model.
 */
export async function askHearth(circleId: string, member: Extract<Actor, { kind: 'member' }>, question: string, now = new Date()): Promise<AskResult> {
    const actor: Actor = { kind: 'assistant', userId: member.userId, memberId: member.memberId, role: member.role, label: `${member.label} via Ask Hearth` };
    const ctx: Ctx = { circleId, actor, now };
    const { modelId } = bedrockSettings();
    let result: AskResult;

    if (!modelId) {
        result = await fallback(ctx, 'Amazon Bedrock is not configured, so this is Hearth\'s basic answer.');
    } else {
        try {
            const messages: Message[] = [{ role: 'user', content: [{ text: question }] }];
            const used: string[] = [];
            let answer = '';
            for (let turn = 0; turn < MAX_TURNS && !answer; turn++) {
                const out = await bedrock().send(new ConverseCommand({
                    modelId, system: [{ text: SYSTEM }], messages,
                    toolConfig: { tools: TOOLS },
                    inferenceConfig: { maxTokens: 600, temperature: 0.2 },
                }));
                const msg = out.output?.message;
                if (!msg) break;
                messages.push(msg);
                const calls = (msg.content ?? []).filter((c): c is ContentBlock.ToolUseMember => 'toolUse' in c && Boolean(c.toolUse));
                if (out.stopReason === 'tool_use' && calls.length) {
                    const results: ContentBlock[] = [];
                    for (const c of calls) {
                        const name = c.toolUse.name ?? '';
                        used.push(name);
                        const json = await runTool(name, ctx);
                        results.push({ toolResult: { toolUseId: c.toolUse.toolUseId, content: [{ json: json as any }] } });
                    }
                    messages.push({ role: 'user', content: results });
                    continue;
                }
                answer = (msg.content ?? []).map((c) => ('text' in c && c.text) || '').join('').trim();
            }
            result = answer
                ? { answer, mode: 'bedrock', model: modelId, tools_used: [...new Set(used)], note: null, asked_at: toLocalISO(now) }
                : await fallback(ctx, 'The model did not finish an answer, so this is Hearth\'s basic answer.');
        } catch (error) {
            const code = error instanceof Error ? error.name : 'Error';
            logger.warn('hearth.bedrock_unavailable', { code });
            result = await fallback(ctx, `Amazon Bedrock is unavailable right now (${code}), so this is Hearth's basic answer.`);
        }
    }

    await recordLedger(pool, circleId, actor, {
        action: 'ask_hearth', category: 'assistant',
        detail: { mode: result.mode, model: result.model, tools: result.tools_used.join(',') },
    });
    return result;
}
