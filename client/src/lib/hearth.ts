/**
 * Hearth client types (payloads of /api/hearth/*) and display helpers shared
 * by the family dashboard, the Sharing & trust page and the parent's screen.
 * Every privacy rule lives on the server: optional fields below are simply
 * absent when the parent does not share them.
 */
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Clock, AlertCircle, HelpCircle, Plane, WifiOff, type LucideIcon } from 'lucide-react';

export const SHARING_LEVELS = ['light', 'rhythm', 'glimpse', 'recovery'] as const;
export type SharingLevel = (typeof SHARING_LEVELS)[number];
export const RECOVERY_EXTRAS = ['night_rest', 'medication_confirmations'] as const;
export type RecoveryExtra = (typeof RECOVERY_EXTRAS)[number];
export type PresenceState = 'normal' | 'awaiting' | 'unusual' | 'insufficient_data' | 'away' | 'signal_unavailable';

export interface WhyCard {
    id: string;
    title: string;
    observed: string;
    difference: string | null;
    evidence: Array<{ text: string; at: string | null; simulated: boolean }>;
    confidence: 'low' | 'medium' | 'high';
    next_step: string;
    at: string;
    provenance: 'real' | 'simulated' | 'unavailable';
}

export interface PresenceView {
    level: SharingLevel;
    state: PresenceState;
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
        medication_confirmations?: Array<{ due_at: string; status: string; confirmed_at: string | null }>;
    };
    why_cards: WhyCard[];
}

export interface Policy {
    level: SharingLevel;
    previous_level: SharingLevel | null;
    recovery_until: string | null;
    recovery_extras: RecoveryExtra[];
    delegate_member_id: string | null;
    away_until: string | null;
}

export interface Proposal {
    id: string;
    kind: 'assign_task' | 'visit' | 'check_in';
    title: string;
    rationale: string;
    target_member_id: string | null;
    target_name: string | null;
    status: 'pending' | 'approved' | 'rejected' | 'expired';
    proposed_by_label: string;
    decided_by_name: string | null;
    decided_at: string | null;
    expires_at: string;
    created_at: string;
}

export interface Moment {
    id: string;
    kind: 'message' | 'visit' | 'video';
    message: string;
    visit_at: string | null;
    seen_at: string | null;
    created_at: string;
    has_video: boolean;
    author_name: string | null;
    author_avatar: string | null;
    tv_delivery: 'unavailable';
}

export interface UpcomingVisit { id: string; title: string; start_time: string; end_time: string | null; member_ids: string[]; members: string[] }

export interface LedgerRow {
    id: string;
    actor_kind: 'member' | 'parent' | 'system' | 'assistant';
    actor_label: string;
    action: string;
    category: string;
    level: SharingLevel | null;
    detail: Record<string, unknown>;
    created_at: string;
}

export interface HearthOverview {
    presence: PresenceView;
    policy: Policy;
    can_manage_policy: boolean;
    recipient: { first_name: string; phone: string | null } | null;
    upcoming_visits: UpcomingVisit[];
    responsibilities: Array<{ id: string; title: string; category: string; due_date: string | null; assigned_to: string[]; assignees: string[] }>;
    proposals: Proposal[];
    recent_decisions: Proposal[];
    moments: Moment[];
}

/**
 * One visual tone per state. Green only for an observed normal pattern, amber
 * for "review suggested", red never: urgent help requests have their own UI.
 */
export const STATE_STYLE: Record<PresenceState, { icon: LucideIcon; tone: string; dot: string }> = {
    normal: { icon: CheckCircle2, tone: 'border-success/25 bg-success-soft text-success', dot: 'bg-success' },
    awaiting: { icon: Clock, tone: 'border-border bg-surface-2 text-muted-foreground', dot: 'bg-muted-foreground' },
    unusual: { icon: AlertCircle, tone: 'border-warning/30 bg-warning-soft text-warning', dot: 'bg-warning' },
    insufficient_data: { icon: HelpCircle, tone: 'border-border bg-surface-2 text-muted-foreground', dot: 'bg-muted-foreground' },
    away: { icon: Plane, tone: 'border-info/25 bg-info-soft text-info', dot: 'bg-info' },
    signal_unavailable: { icon: WifiOff, tone: 'border-border bg-surface-2 text-muted-foreground', dot: 'bg-muted-foreground' },
};

/** "HH:MM" of a naive local ISO string, without any timezone shift. */
export const clockOf = (iso: string | null | undefined): string => (iso ? iso.slice(11, 16) : '');

/** Short local date + time of a naive local ISO string. */
export const formatWhen = (iso: string | null | undefined, locale?: string): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
};

/** Value for an <input type="datetime-local"> some hours from now. */
export const localInputValue = (hoursFromNow: number): string => {
    const d = new Date(Date.now() + hoursFromNow * 3600000);
    d.setMinutes(0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const MAX_VIDEO_BYTES = 4 * 1024 * 1024;

export const readAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
});

/** One readable sentence per ledger row, from ids and field names only. */
export function useLedgerSentence() {
    const { t } = useTranslation('hearth');
    return (row: LedgerRow, parentName: string): { who: string; what: string } => {
        const d = row.detail as Record<string, string>;
        const level = (l: unknown) => (typeof l === 'string' && SHARING_LEVELS.includes(l as SharingLevel) ? t(`levels.${l}.name`) : String(l ?? ''));
        const who = row.actor_kind === 'parent' ? t('trust.actor.parent', { name: parentName }) : row.actor_label || t('trust.actor.system');
        const fields = typeof d.fields === 'string' ? d.fields.split(',').map((f) => t(`trust.fields.${f}`, { defaultValue: f })).join(', ') : '';
        const channel = typeof d.channel === 'string' ? ` ${t(`trust.channels.${d.channel}`, { defaultValue: '' })}` : '';
        const what = t(`trust.actions.${row.action}`, {
            defaultValue: row.action,
            fields, level: level(row.level), from: level(d.from), to: level(d.to), requested: level(d.requested),
            kind: d.kind ? t(`proposals.kinds.${d.kind}`, { defaultValue: d.kind }).toLowerCase() : '',
            mode: d.mode === 'bedrock' ? 'Amazon Bedrock' : 'basic answer',
        }) + (row.action === 'disclosure' ? channel : '');
        return { who, what };
    };
}
