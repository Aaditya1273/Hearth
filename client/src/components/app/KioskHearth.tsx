import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Check, Play, Heart, ShieldCheck, Plane, CalendarHeart } from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { intlLocale } from '../../i18n/format';
import { LedgerRow, Moment, Policy, RECOVERY_EXTRAS, RecoveryExtra, SHARING_LEVELS, SharingLevel, formatWhen, useLedgerSentence } from '../../lib/hearth';

/**
 * The parent's own Hearth panel on the kiosk: messages from the family, what
 * the family sees (the Glimpse Dial, which only this screen or the chosen
 * delegate can change) and "I'm away". Large targets, calm words, no alarms.
 */

const C = {
    bg: '#f7f6f2', card: '#ffffff', border: '#d9d5cc', text: '#1f2a24', muted: '#55605a',
    green: '#2e5e45', greenDark: '#234a36', greenSoft: '#e7efe9', amberSoft: '#fbf1df',
};

interface Props {
    recipientName: string;
    fontScale: number;
    onClose: () => void;
    onChanged: () => void;
}

interface KioskHearthData { policy: Policy; moments: Moment[]; ledger: LedgerRow[] }
interface Candidate { id: string; name: string }
type Tab = 'moments' | 'sharing' | 'away';

const KioskHearth: React.FC<Props> = ({ recipientName, fontScale, onClose, onChanged }) => {
    const { t } = useTranslation('hearth');
    const sentence = useLedgerSentence();
    const [tab, setTab] = useState<Tab>('moments');
    const [data, setData] = useState<KioskHearthData | null>(null);
    const [candidates, setCandidates] = useState<Candidate[]>([]);
    const [videos, setVideos] = useState<Record<string, string>>({});
    const [recovery, setRecovery] = useState<{ days: number; extras: RecoveryExtra[] } | null>(null);
    const [confirmation, setConfirmation] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const closeRef = useRef<HTMLButtonElement>(null);
    const fs = (px: number): React.CSSProperties => ({ fontSize: `calc(${px}px * ${fontScale})` });
    const name = recipientName || '';

    const load = useCallback(async () => {
        try {
            const [k, p] = await Promise.all([
                api.get<{ success: boolean; data: KioskHearthData }>('/api/hearth/kiosk'),
                api.get<{ success: boolean; data: { delegate_candidates?: Candidate[] } }>('/api/hearth/policy'),
            ]);
            if (k.data) setData(k.data);
            setCandidates(p.data?.delegate_candidates ?? []);
        } catch {
            setError(t('dashboard.loadError'));
        }
    }, [t]);

    useEffect(() => { void load(); closeRef.current?.focus(); }, [load]);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const run = async (fn: () => Promise<unknown>) => {
        setBusy(true);
        setError('');
        try { await fn(); await load(); onChanged(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
    };

    const setLevel = (level: SharingLevel, extra?: { days: number; extras: RecoveryExtra[] }) => run(async () => {
        const body = level === 'recovery' ? { level, recovery_days: extra?.days ?? 7, recovery_extras: extra?.extras ?? [] } : { level };
        const res = await api.put<{ success: boolean; data: { confirmation: string } }>('/api/hearth/policy', body);
        setRecovery(null);
        setConfirmation(res.data?.confirmation ?? null);
    });

    const setAway = (days: number | null) => run(async () => {
        let until: string | null = null;
        if (days !== null) {
            const d = new Date();
            d.setDate(d.getDate() + days);
            d.setHours(23, 59, 0, 0);
            until = d.toISOString();
        }
        await api.put('/api/hearth/away', { until });
    });

    const play = async (m: Moment) => {
        const res = await api.get<{ success: boolean; data: { media_data_url: string } }>(`/api/hearth/moments/${m.id}/media`);
        if (res.data) setVideos((v) => ({ ...v, [m.id]: res.data!.media_data_url }));
    };

    const bigButton = 'flex min-h-[72px] w-full items-center gap-4 rounded-2xl px-5 text-left font-bold shadow-sm focus:outline-none focus-visible:ring-4 focus-visible:ring-[#2e5e45]/40';
    const policy = data?.policy;
    const unseen = data?.moments.filter((m) => !m.seen_at).length ?? 0;

    return (
        <div className="fixed inset-0 z-[90] flex flex-col overflow-y-auto font-kiosk" style={{ backgroundColor: C.bg, color: C.text }} role="dialog" aria-modal="true" aria-labelledby="kiosk-hearth-title">
            <div className="mx-auto w-full max-w-3xl flex-1 px-4 pb-10 pt-6 sm:px-6">
                <div className="mb-5 flex items-center justify-between gap-3">
                    <h1 id="kiosk-hearth-title" className="font-bold" style={fs(30)}>{t('kiosk.title')}</h1>
                    <button ref={closeRef} type="button" onClick={onClose} className="flex min-h-[64px] items-center gap-2 rounded-2xl px-5 font-bold" style={{ ...fs(20), backgroundColor: C.card, border: `2px solid ${C.border}` }}>
                        <X className="h-7 w-7" aria-hidden="true" />{t('kiosk.close')}
                    </button>
                </div>

                <div className="mb-6 grid grid-cols-3 gap-2" role="tablist" aria-label={t('kiosk.title')}>
                    {([['moments', Heart, t('kiosk.tabMoments')], ['sharing', ShieldCheck, t('kiosk.tabSharing')], ['away', Plane, t('kiosk.tabAway')]] as const).map(([key, Icon, label]) => (
                        <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                            className="flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-2xl px-2 font-bold"
                            style={{ ...fs(17), backgroundColor: tab === key ? C.green : C.card, color: tab === key ? '#fff' : C.text, border: `2px solid ${tab === key ? C.green : C.border}` }}>
                            <Icon className="h-7 w-7" aria-hidden="true" />
                            <span>{label}{key === 'moments' && unseen > 0 ? ` (${unseen})` : ''}</span>
                        </button>
                    ))}
                </div>

                {error && <p role="alert" className="mb-4 rounded-2xl p-4 font-bold" style={{ ...fs(18), backgroundColor: C.amberSoft }}>{error}</p>}
                {confirmation && (
                    <div role="status" className="mb-4 flex items-start gap-3 rounded-2xl p-5" style={{ backgroundColor: C.greenSoft, border: `2px solid ${C.green}` }}>
                        <Check className="h-8 w-8 shrink-0" style={{ color: C.green }} strokeWidth={3} aria-hidden="true" />
                        <div>
                            <p className="font-bold" style={fs(22)}>{t('kiosk.confirmTitle')}</p>
                            <p style={fs(19)}>{confirmation}</p>
                        </div>
                    </div>
                )}

                {!data ? <div className="spinner-brand mx-auto mt-10" aria-label="…" /> : (
                    <>
                        {tab === 'moments' && (
                            <section role="tabpanel" aria-label={t('kiosk.tabMoments')} className="space-y-4">
                                {data.moments.length === 0 && <p style={{ ...fs(20), color: C.muted }}>{t('kiosk.noMoments')}</p>}
                                {data.moments.map((m) => (
                                    <article key={m.id} className="rounded-2xl p-5" style={{ backgroundColor: C.card, border: `2px solid ${m.seen_at ? C.border : C.green}` }}>
                                        <p className="font-bold" style={{ ...fs(20), color: C.greenDark }}>{m.author_name ?? ''}</p>
                                        {m.kind === 'visit' && m.visit_at && (
                                            <p className="mt-1 flex items-center gap-2 font-bold" style={fs(22)}>
                                                <CalendarHeart className="h-7 w-7 shrink-0" style={{ color: C.green }} aria-hidden="true" />
                                                {t('kiosk.visitOn', { date: formatWhen(m.visit_at, intlLocale()) })}
                                            </p>
                                        )}
                                        {m.message && <p className="mt-2 leading-snug" style={fs(24)}>{m.message}</p>}
                                        {m.has_video && (videos[m.id]
                                            ? <video src={videos[m.id]} controls autoPlay className="mt-3 w-full rounded-xl" />
                                            : (
                                                <button type="button" onClick={() => void play(m)} className={cn(bigButton, 'mt-3 text-white')} style={{ ...fs(22), backgroundColor: C.green }}>
                                                    <Play className="h-8 w-8" aria-hidden="true" />{t('kiosk.playVideo')}
                                                </button>
                                            ))}
                                        {!m.seen_at && (
                                            <button type="button" disabled={busy} onClick={() => void run(() => api.post(`/api/hearth/moments/${m.id}/seen`, {}))} className={cn(bigButton, 'mt-3 justify-center')} style={{ ...fs(20), backgroundColor: C.greenSoft, color: C.greenDark }}>
                                                <Check className="h-7 w-7" strokeWidth={3} aria-hidden="true" />{t('kiosk.markSeen')}
                                            </button>
                                        )}
                                    </article>
                                ))}
                            </section>
                        )}

                        {tab === 'sharing' && policy && (
                            <section role="tabpanel" aria-label={t('kiosk.tabSharing')} className="space-y-4">
                                <p className="font-bold" style={fs(22)}>{t('kiosk.sharingNow')}</p>
                                <div role="radiogroup" aria-label={t('kiosk.tabSharing')} className="space-y-3">
                                    {SHARING_LEVELS.map((level) => {
                                        const chosen = policy.level === level;
                                        return (
                                            <button key={level} type="button" role="radio" aria-checked={chosen} disabled={busy}
                                                onClick={() => (level === 'recovery' ? setRecovery({ days: 7, extras: ['night_rest'] }) : chosen ? undefined : void setLevel(level))}
                                                className={cn(bigButton, 'items-start py-4')}
                                                style={{ backgroundColor: chosen ? C.greenSoft : C.card, border: `3px solid ${chosen ? C.green : C.border}`, color: C.text }}>
                                                <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: chosen ? C.green : C.bg, border: `2px solid ${C.green}` }}>
                                                    {chosen && <Check className="h-6 w-6 text-white" strokeWidth={3} aria-hidden="true" />}
                                                </span>
                                                <span>
                                                    <span className="block" style={fs(24)}>{t(`levels.${level}.name`)}{chosen ? ` · ${t('kiosk.chosen')}` : ''}</span>
                                                    <span className="block font-normal" style={{ ...fs(18), color: C.muted }}>{t(`levels.${level}.parent`)}</span>
                                                    {chosen && level === 'recovery' && policy.recovery_until && (
                                                        <span className="block font-normal" style={fs(18)}>{t('kiosk.recoveryEnds', { date: formatWhen(policy.recovery_until, intlLocale()) })}</span>
                                                    )}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>

                                {recovery && (
                                    <div className="space-y-4 rounded-2xl p-5" style={{ backgroundColor: C.card, border: `2px solid ${C.green}` }}>
                                        <p className="font-bold" style={fs(22)}>{t('kiosk.recoveryHow')}</p>
                                        <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label={t('kiosk.recoveryHow')}>
                                            {[3, 7, 14].map((d) => (
                                                <button key={d} type="button" role="radio" aria-checked={recovery.days === d} onClick={() => setRecovery({ ...recovery, days: d })}
                                                    className="min-h-[64px] rounded-2xl font-bold" style={{ ...fs(22), backgroundColor: recovery.days === d ? C.green : C.bg, color: recovery.days === d ? '#fff' : C.text, border: `2px solid ${C.green}` }}>
                                                    {d}
                                                </button>
                                            ))}
                                        </div>
                                        <p className="font-bold" style={fs(22)}>{t('kiosk.recoveryWhat')}</p>
                                        {RECOVERY_EXTRAS.map((x) => {
                                            const on = recovery.extras.includes(x);
                                            return (
                                                <button key={x} type="button" role="checkbox" aria-checked={on}
                                                    onClick={() => setRecovery({ ...recovery, extras: on ? recovery.extras.filter((e) => e !== x) : [...recovery.extras, x] })}
                                                    className={bigButton} style={{ ...fs(20), backgroundColor: on ? C.greenSoft : C.bg, border: `2px solid ${on ? C.green : C.border}`, color: C.text }}>
                                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: on ? C.green : C.card, border: `2px solid ${C.green}` }}>
                                                        {on && <Check className="h-6 w-6 text-white" strokeWidth={3} aria-hidden="true" />}
                                                    </span>
                                                    {t(`extras.${x}`)}
                                                </button>
                                            );
                                        })}
                                        <button type="button" disabled={busy} onClick={() => void setLevel('recovery', recovery)} className={cn(bigButton, 'justify-center text-white')} style={{ ...fs(22), backgroundColor: C.green }}>
                                            {t('kiosk.recoveryStart')}
                                        </button>
                                    </div>
                                )}

                                <div className="rounded-2xl p-5" style={{ backgroundColor: C.card, border: `2px solid ${C.border}` }}>
                                    <p className="font-bold" style={fs(22)}>{t('kiosk.delegateTitle')}</p>
                                    <p className="mb-3" style={{ ...fs(17), color: C.muted }}>{t('kiosk.delegateHint')}</p>
                                    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('kiosk.delegateTitle')}>
                                        {[{ id: null as string | null, name: t('kiosk.delegateNone') }, ...candidates].map((c) => {
                                            const on = (policy.delegate_member_id ?? null) === c.id;
                                            return (
                                                <button key={c.id ?? 'none'} type="button" role="radio" aria-checked={on} disabled={busy}
                                                    onClick={() => void run(() => api.put('/api/hearth/delegate', { member_id: c.id }))}
                                                    className="min-h-[60px] rounded-2xl px-4 text-left font-bold" style={{ ...fs(19), backgroundColor: on ? C.greenSoft : C.bg, border: `2px solid ${on ? C.green : C.border}` }}>
                                                    {on ? '✓ ' : ''}{c.name}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {data.ledger.length > 0 && (
                                    <div className="rounded-2xl p-5" style={{ backgroundColor: C.card, border: `2px solid ${C.border}` }}>
                                        <p className="mb-2 font-bold" style={fs(22)}>{t('kiosk.whoLooked')}</p>
                                        <ul className="space-y-2">
                                            {data.ledger.map((row) => {
                                                const s = sentence(row, name);
                                                return <li key={row.id} style={fs(17)}><span className="font-bold">{s.who}</span> {s.what} <span style={{ color: C.muted }}>· {formatWhen(row.created_at, intlLocale())}</span></li>;
                                            })}
                                        </ul>
                                    </div>
                                )}
                            </section>
                        )}

                        {tab === 'away' && policy && (
                            <section role="tabpanel" aria-label={t('kiosk.tabAway')} className="space-y-4">
                                <p className="font-bold" style={fs(24)}>{t('kiosk.awayTitle')}</p>
                                <p style={{ ...fs(19), color: C.muted }}>{t('kiosk.awayHint')}</p>
                                {policy.away_until && new Date(policy.away_until) > new Date() ? (
                                    <>
                                        <p className="rounded-2xl p-5 font-bold" style={{ ...fs(22), backgroundColor: C.greenSoft }}>{t('kiosk.awayNow', { date: formatWhen(policy.away_until, intlLocale()) })}</p>
                                        <button type="button" disabled={busy} onClick={() => void setAway(null)} className={cn(bigButton, 'justify-center text-white')} style={{ ...fs(24), backgroundColor: C.green }}>
                                            {t('kiosk.back')}
                                        </button>
                                    </>
                                ) : (
                                    <div className="grid gap-3">
                                        {[0, 2, 7].map((d) => (
                                            <button key={d} type="button" disabled={busy} onClick={() => void setAway(d)} className={bigButton} style={{ ...fs(22), backgroundColor: C.card, border: `2px solid ${C.border}`, color: C.text }}>
                                                <Plane className="h-8 w-8 shrink-0" style={{ color: C.green }} aria-hidden="true" />
                                                {d === 0 ? t('kiosk.awayToday') : t('kiosk.awayDays', { count: d })}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </section>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default KioskHearth;
