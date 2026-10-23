import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, ScrollText, Mic, Check, Copy } from 'lucide-react';
import { api, API_BASE_URL } from '../lib/api';
import { serverUrl } from '../lib/serverUrl';
import { cn } from '../lib/utils';
import { useCircle } from '../contexts/CircleContext';
import { useWebSocketUpdates } from '../hooks/useWebSocketUpdates';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui';
import RingConnect from '../components/app/RingConnect';
import { intlLocale } from '../i18n/format';
import { LedgerRow, Policy, SHARING_LEVELS, SharingLevel, formatWhen, useLedgerSentence } from '../lib/hearth';

interface AssistantToken { id: string; label: string; last_used_at: string | null; created_at: string }

const HearthTrust: React.FC = () => {
    const { t } = useTranslation(['hearth', 'common']);
    const { activeCircle, canWriteContent, isAdmin } = useCircle();
    const { showToast } = useToast();
    const sentence = useLedgerSentence();
    const [policy, setPolicy] = useState<Policy | null>(null);
    const [canManage, setCanManage] = useState(false);
    const [ledger, setLedger] = useState<LedgerRow[]>([]);
    const [limit, setLimit] = useState(50);
    const [tokens, setTokens] = useState<AssistantToken[]>([]);
    const [newToken, setNewToken] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const name = activeCircle?.recipient_first_name || '';
    const who = name || t('hearth:dashboard.titleFallback');

    const load = useCallback(async () => {
        try {
            const [p, l] = await Promise.all([
                api.get<{ success: boolean; data: { policy: Policy; can_manage: boolean } }>('/api/hearth/policy'),
                api.get<{ success: boolean; data: LedgerRow[] }>(`/api/hearth/ledger?limit=${limit}`),
            ]);
            if (p.data) { setPolicy(p.data.policy); setCanManage(p.data.can_manage); }
            setLedger(l.data ?? []);
        } catch {
            setPolicy(null);
        }
        if (canWriteContent) {
            api.get<{ success: boolean; data: AssistantToken[] }>('/api/hearth/assistant-tokens').then((r) => setTokens(r.data ?? [])).catch(() => setTokens([]));
        }
    }, [limit, canWriteContent]);

    useEffect(() => { if (activeCircle?.id) void load(); }, [activeCircle?.id, load]);
    useWebSocketUpdates('hearth', () => void load());

    const setLevel = async (level: SharingLevel) => {
        try {
            const body = level === 'recovery' ? { level, recovery_days: 7, recovery_extras: ['night_rest'] } : { level };
            await api.put('/api/hearth/policy', body);
            showToast({ title: t('hearth:trust.changed', { level: t(`hearth:levels.${level}.name`) }) });
            void load();
        } catch (e) {
            showToast({ title: e instanceof Error ? e.message : String(e) });
        }
    };

    const createToken = async () => {
        const r = await api.post<{ success: boolean; data: { token: string } }>('/api/hearth/assistant-tokens', { label: 'Alexa+' });
        setNewToken(r.data?.token ?? null);
        void load();
    };
    const revoke = async (id: string) => {
        await api.delete(`/api/hearth/assistant-tokens/${id}`);
        void load();
    };
    const mcpUrl = serverUrl(API_BASE_URL, window.location.origin, '/mcp');

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <header>
                <h1 className="text-display text-foreground">{t('hearth:trust.title')}</h1>
                <p className="mt-1 text-body text-muted-foreground">{t('hearth:trust.intro', { name: who })}</p>
            </header>

            <section className="rounded-card border border-border bg-card p-5 shadow-surface" aria-labelledby="dial-title">
                <h2 id="dial-title" className="mb-1 flex items-center gap-2 text-h2 text-foreground"><ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />{t('hearth:trust.dialTitle', { name: who })}</h2>
                <p className="mb-4 text-caption text-muted-foreground">{canManage ? t('hearth:trust.youAreDelegate', { name: who }) : t('hearth:trust.onlyParent', { name: who })}</p>
                <ol className="grid gap-3 sm:grid-cols-2">
                    {SHARING_LEVELS.map((level) => {
                        const active = policy?.level === level;
                        return (
                            <li key={level} className={cn('rounded-card border p-4', active ? 'border-primary bg-primary-soft' : 'border-border bg-surface')}>
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-body font-semibold text-foreground">{t(`hearth:levels.${level}.name`)}</p>
                                    {active && <span className="inline-flex items-center gap-1 text-micro font-semibold text-primary"><Check className="h-4 w-4" aria-hidden="true" />{t('hearth:trust.current')}</span>}
                                </div>
                                <p className="mt-1 text-caption text-muted-foreground">{t(`hearth:levels.${level}.family`)}</p>
                                {active && level === 'recovery' && policy?.recovery_until && (
                                    <p className="mt-2 text-caption text-foreground">{t('hearth:dashboard.recoveryUntil', { date: formatWhen(policy.recovery_until, intlLocale()) })}</p>
                                )}
                                {canManage && !active && (
                                    <Button size="sm" variant="secondary" className="mt-3" onClick={() => void setLevel(level)}>{t('hearth:trust.change', { level: t(`hearth:levels.${level}.name`) })}</Button>
                                )}
                            </li>
                        );
                    })}
                </ol>
                {policy?.away_until && <p className="mt-4 text-caption text-foreground">{t('hearth:trust.away', { date: formatWhen(policy.away_until, intlLocale()) })}</p>}
            </section>

            <section className="rounded-card border border-border bg-card p-5 shadow-surface" aria-labelledby="ledger-title">
                <h2 id="ledger-title" className="mb-1 flex items-center gap-2 text-h2 text-foreground"><ScrollText className="h-5 w-5 text-primary" aria-hidden="true" />{t('hearth:trust.ledgerTitle')}</h2>
                <p className="mb-4 text-caption text-muted-foreground">{t('hearth:trust.ledgerIntro', { name: who })}</p>
                {ledger.length === 0 ? (
                    <p className="text-caption text-muted-foreground">{t('hearth:trust.ledgerEmpty')}</p>
                ) : (
                    <ul className="divide-y divide-border">
                        {ledger.map((row) => {
                            const s = sentence(row, who);
                            return (
                                <li key={row.id} className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-baseline sm:gap-4">
                                    <time className="w-40 shrink-0 text-caption tabular-nums text-muted-foreground" dateTime={row.created_at}>{formatWhen(row.created_at, intlLocale())}</time>
                                    <p className="text-caption text-foreground"><span className="font-semibold">{s.who}</span> {s.what}</p>
                                </li>
                            );
                        })}
                    </ul>
                )}
                {ledger.length >= limit && <Button size="sm" variant="ghost" className="mt-3" onClick={() => setLimit((l) => l + 100)}>{t('hearth:trust.loadMore')}</Button>}
            </section>

            {canWriteContent && (
                <section className="rounded-card border border-border bg-card p-5 shadow-surface" aria-labelledby="alexa-title">
                    <h2 id="alexa-title" className="mb-1 flex items-center gap-2 text-h2 text-foreground"><Mic className="h-5 w-5 text-primary" aria-hidden="true" />{t('hearth:alexa.title')}</h2>
                    <p className="mb-3 text-caption text-muted-foreground">{t('hearth:alexa.intro', { name: who })}</p>
                    <p className="text-caption font-medium text-foreground">{t('hearth:alexa.endpoint')}</p>
                    <code className="mt-1 block break-all rounded-input border border-border bg-surface-2 px-3 py-2 text-caption">{mcpUrl}</code>
                    {newToken && (
                        <div className="mt-4 rounded-input border border-warning/30 bg-warning-soft p-3">
                            <p className="text-caption font-medium text-foreground">{t('hearth:alexa.tokenOnce')}</p>
                            <code className="mt-1 block break-all text-caption">{newToken}</code>
                            <Button size="sm" variant="secondary" className="mt-2" onClick={() => { void navigator.clipboard?.writeText(newToken).then(() => setCopied(true)); }}>
                                <Copy className="h-4 w-4" aria-hidden="true" />{copied ? t('hearth:alexa.copied') : t('hearth:alexa.copy')}
                            </Button>
                        </div>
                    )}
                    <ul className="mt-4 divide-y divide-border">
                        {tokens.length === 0 && <li className="py-2 text-caption text-muted-foreground">{t('hearth:alexa.none')}</li>}
                        {tokens.map((tok) => (
                            <li key={tok.id} className="flex items-center justify-between gap-3 py-2.5 text-caption">
                                <span className="text-foreground">
                                    {tok.label} · {t('hearth:alexa.connected', { date: formatWhen(tok.created_at, intlLocale()) })} · {tok.last_used_at ? t('hearth:alexa.lastUsed', { date: formatWhen(tok.last_used_at, intlLocale()) }) : t('hearth:alexa.never')}
                                </span>
                                <Button size="sm" variant="ghost" onClick={() => void revoke(tok.id)}>{t('hearth:alexa.revoke')}</Button>
                            </li>
                        ))}
                    </ul>
                    <Button size="sm" className="mt-3" onClick={() => void createToken()}>{t('hearth:alexa.connect')}</Button>
                    <p className="mt-3 text-micro text-muted-foreground">{t('hearth:alexa.notLive')}</p>
                </section>
            )}

            {isAdmin && <RingConnect who={who} />}
        </div>
    );
};

export default HearthTrust;
