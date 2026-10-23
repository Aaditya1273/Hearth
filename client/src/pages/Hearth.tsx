import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import {
    Phone, Heart, ShieldCheck, Sparkles, CalendarHeart, ListChecks, Info, Video, FlaskConical,
    ChevronRight, Plus, Activity, Sunrise, DoorOpen, Sprout, Leaf, Clock,
} from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useCircle } from '../contexts/CircleContext';
import { useAuth } from '../contexts/AuthContext';
import { useWebSocketUpdates } from '../hooks/useWebSocketUpdates';
import { useToast } from '../components/ui/Toast';
import { Button, Dialog, Input, Textarea, Select } from '../components/ui';
import { intlLocale } from '../i18n/format';
import {
    HearthOverview, Proposal, STATE_STYLE, WhyCard, clockOf, formatWhen, localInputValue, readAsDataUrl, MAX_VIDEO_BYTES,
} from '../lib/hearth';

interface Member { id: string; user_id: string; name: string; role: string }

// ─── Building blocks ─────────────────────────────────────────────────────────

const Section: React.FC<{ icon: React.ComponentType<{ className?: string }>; title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ icon: Icon, title, action, children, className }) => (
    <section className={cn('rounded-[22px] border border-border bg-card p-5 shadow-surface sm:p-6', className)} aria-label={title}>
        <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="flex min-w-0 items-center gap-2 text-h2 text-foreground">
                <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                {title}
            </h2>
            {action && <div className="shrink-0 whitespace-nowrap">{action}</div>}
        </div>
        {children}
    </section>
);

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <p className="rounded-input border border-dashed border-border px-4 py-5 text-center text-caption text-muted-foreground">{children}</p>
);

const Pill: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
    <span className={cn('inline-flex items-center gap-1 rounded-pill border border-border bg-surface-2 px-2.5 py-0.5 text-micro font-medium text-muted-foreground', className)}>{children}</span>
);

const WhyCardView: React.FC<{ card: WhyCard }> = ({ card }) => {
    const { t } = useTranslation('hearth');
    return (
        <article className="rounded-card border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-body font-semibold text-foreground">{card.title}</h3>
                <div className="flex flex-wrap gap-1.5">
                    <Pill className={card.provenance === 'simulated' ? 'border-info/30 text-info' : undefined}>{t(`provenance.${card.provenance}`)}</Pill>
                    <Pill>{t(`confidence.${card.confidence}`)}</Pill>
                </div>
            </div>
            <dl className="mt-3 space-y-2 text-caption">
                <div><dt className="font-medium text-foreground">{t('dashboard.observed')}</dt><dd className="text-muted-foreground">{card.observed}</dd></div>
                {card.difference && <div><dt className="font-medium text-foreground">{t('dashboard.difference')}</dt><dd className="text-muted-foreground">{card.difference}</dd></div>}
                {card.evidence.length > 0 && (
                    <div>
                        <dt className="font-medium text-foreground">{t('dashboard.evidence')}</dt>
                        <dd>
                            <ul className="mt-0.5 list-disc space-y-0.5 pl-5 text-muted-foreground">
                                {card.evidence.map((e) => <li key={e.text}>{e.text}</li>)}
                            </ul>
                        </dd>
                    </div>
                )}
            </dl>
            <p className="mt-3 rounded-input bg-primary-soft px-3 py-2 text-caption text-foreground">
                <span className="font-semibold text-primary">{t('dashboard.nextStep')}: </span>{card.next_step}
            </p>
        </article>
    );
};

// ─── Page ────────────────────────────────────────────────────────────────────

const Hearth: React.FC = () => {
    const { t } = useTranslation(['hearth', 'common']);
    const { activeCircle, canWriteContent } = useCircle();
    const { user } = useAuth();
    const { showToast } = useToast();
    const [data, setData] = useState<HearthOverview | null>(null);
    const [error, setError] = useState(false);
    const [members, setMembers] = useState<Member[]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    const [visitOpen, setVisitOpen] = useState(false);
    const [askTask, setAskTask] = useState<{ id: string; title: string } | null>(null);
    const [momentOpen, setMomentOpen] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await api.get<{ success: boolean; data: HearthOverview }>('/api/hearth/overview');
            if (res.success && res.data) { setData(res.data); setError(false); }
        } catch {
            setError(true);
        }
    }, []);

    useEffect(() => {
        if (!activeCircle?.id) return;
        setData(null);
        void load();
        void api.get<{ success: boolean; data: { members: Member[] } }>(`/api/circles/${activeCircle.id}`)
            .then((r) => setMembers(r.data?.members ?? []))
            .catch(() => setMembers([]));
    }, [activeCircle?.id, load]);

    useWebSocketUpdates('hearth', () => void load());
    useWebSocketUpdates('presence', () => void load());
    useWebSocketUpdates('tasks', () => void load());
    useWebSocketUpdates('events', () => void load());

    const name = data?.recipient?.first_name || activeCircle?.recipient_first_name || '';
    const who = name || t('hearth:dashboard.titleFallback');
    const me = members.find((m) => m.user_id === user?.id);
    const familyMembers = members.filter((m) => m.role === 'admin' || m.role === 'family');

    const decide = async (p: Proposal, decision: 'approve' | 'reject') => {
        setBusy(p.id);
        try {
            const res = await api.post<{ success: boolean; data: { status: string } }>(`/api/hearth/proposals/${p.id}/decision`, { decision });
            if (res.success) {
                showToast({ title: decision === 'approve' ? t('hearth:proposals.approved', { name: p.target_name ?? me?.name ?? '' }) : t('hearth:proposals.rejected') });
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : '';
            showToast({ title: msg.includes('EXPIRED') ? t('hearth:proposals.expired') : msg.includes('NOT_ALLOWED') || msg.includes('role') ? t('hearth:proposals.notAllowed') : t('hearth:dashboard.loadError') });
        } finally {
            setBusy(null);
            void load();
        }
    };

    const suggest = async () => {
        setBusy('suggest');
        try {
            const res = await api.post<{ success: boolean; data: unknown[] }>('/api/hearth/proposals/suggest', {});
            const n = res.data?.length ?? 0;
            showToast({ title: n ? t('hearth:proposals.suggested', { count: n }) : t('hearth:proposals.suggestedNone') });
        } catch {
            showToast({ title: t('hearth:dashboard.loadError') });
        } finally {
            setBusy(null);
            void load();
        }
    };

    if (error && !data) {
        return (
            <div className="mx-auto max-w-xl py-16 text-center">
                <p className="text-body text-foreground">{t('hearth:dashboard.loadError')}</p>
                <Button className="mt-4" variant="secondary" onClick={() => void load()}>{t('hearth:dashboard.retry')}</Button>
            </div>
        );
    }
    if (!data) {
        return (
            <div className="flex min-h-[50vh] items-center justify-center">
                <div className="spinner-brand" aria-label={t('common:states.loading')} />
            </div>
        );
    }

    const p = data.presence;
    const style = STATE_STYLE[p.state];
    const StateIcon = style.icon;
    const levelName = t(`hearth:levels.${p.level}.name`);
    const hidden = [!p.timing && t('hearth:dashboard.notSharedTimes'), !p.events && t('hearth:dashboard.notSharedEvents')].filter(Boolean).join(', ');
    const meds = p.extras?.medication_confirmations;

    const today = new Intl.DateTimeFormat(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    // "21:48" today, "Wed 21:48" otherwise: fits a stat tile on one line.
    const shortWhen = (iso: string): string => {
        const d = new Date(iso);
        const time = new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit' }).format(d);
        return d.toDateString() === new Date().toDateString() ? time : `${new Intl.DateTimeFormat(intlLocale(), { weekday: 'short' }).format(d)} ${time}`;
    };

    const hour = new Date().getHours();
    const greeting = t(`hearth:home.greeting.${hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}`, { name: (user?.name ?? '').split(' ')[0] });
    const door = p.events?.find((e) => /door|ring/i.test(e.description));
    const initials = (n: string) => n.split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();
    const tiles: Array<{ icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub: string }> = [
        { icon: Activity, label: t('hearth:home.tiles.activity'), value: p.timing ? t('hearth:home.tiles.signals', { count: p.timing.signals_today }) : t('hearth:home.tiles.hidden'), sub: p.timing?.last_signal_at ? t('hearth:home.tiles.lastSeen', { time: shortWhen(p.timing.last_signal_at) }) : t('hearth:home.tiles.notShared', { level: levelName }) },
        { icon: Sunrise, label: t('hearth:home.tiles.started'), value: p.timing ? (clockOf(p.timing.first_activity_at) || t('hearth:dashboard.none')) : t('hearth:home.tiles.hidden'), sub: p.timing?.usual_first_activity ? t('hearth:home.tiles.usually', { time: p.timing.usual_first_activity }) : t('hearth:home.tiles.notShared', { level: levelName }) },
        { icon: DoorOpen, label: t('hearth:home.tiles.door'), value: door ? clockOf(door.at) : p.events ? t('hearth:home.tiles.quiet') : t('hearth:home.tiles.hidden'), sub: door ? door.description : p.events ? t('hearth:home.tiles.noDoor') : t('hearth:home.tiles.sharedAtGlimpse') },
        { icon: Sprout, label: t('hearth:home.tiles.routine'), value: p.data_quality.baseline === 'ready' ? t('hearth:home.tiles.learned') : t('hearth:home.tiles.learning'), sub: t('hearth:home.tiles.days', { days: p.data_quality.baseline_days_observed, needed: p.data_quality.baseline_days_needed }) },
    ];

    return (
        <div className="space-y-5">
            {/* Greeting: serif, like the photo banner it replaces */}
            <div data-hero className="relative flex flex-wrap items-end justify-between gap-4 pb-1">
                <div>
                    <h1 className="font-display text-[34px] font-medium leading-[1.1] tracking-[-0.015em] text-foreground sm:text-[44px]" style={{ fontVariationSettings: '"opsz" 96' }}>{greeting}</h1>
                    <p className="mt-1.5 text-body text-muted-foreground">{t('hearth:home.subtitle')}</p>
                </div>
                <p aria-hidden="true" className="hidden rotate-[-5deg] text-right font-display text-[19px] italic leading-snug text-[#6b7a70] xl:block" style={{ fontVariationSettings: '"opsz" 96' }}>
                    {t('hearth:home.script').split('|').map((l) => <span key={l} className="block">{l}</span>)}
                </p>
            </div>

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="min-w-0 space-y-5">
                    {/* ── Today: the parent's day ── */}
                    <section aria-labelledby="day-title" className="relative overflow-hidden rounded-[26px] border border-[#dfe8df] bg-[linear-gradient(135deg,#eef4ec_0%,#f6f5ef_60%,#f3efe6_100%)] p-5 dark:border-border dark:bg-none dark:bg-card sm:p-7">
                        <Leaf aria-hidden="true" className="pointer-events-none absolute -right-6 -top-6 h-40 w-40 rotate-12 text-[#2e5e45]/[0.06]" />
                        <div className="relative grid gap-6 md:grid-cols-[auto_minmax(0,1fr)] xl:grid-cols-[auto_minmax(0,1fr)_230px] xl:items-center">
                            <div className="relative h-28 w-28 shrink-0 sm:h-32 sm:w-32">
                                {p.simulated
                                    ? <img src={`${import.meta.env.BASE_URL}hearth/parent-demo.webp`} alt="" className="h-full w-full rounded-full object-cover shadow-[0_12px_30px_-12px_rgba(31,42,36,0.5)] ring-4 ring-white dark:ring-card" />
                                    : <span className="flex h-full w-full items-center justify-center rounded-full bg-primary-soft font-display text-[40px] text-primary ring-4 ring-white dark:ring-card">{initials(who)}</span>}
                                <span className={cn('absolute bottom-2 right-2 h-5 w-5 rounded-full ring-4 ring-white dark:ring-card', style.dot)} aria-hidden="true" />
                            </div>

                            <div className="min-w-0">
                                <a href="#why" id="day-title" className="group inline-flex items-center gap-1 text-[20px] font-semibold text-foreground">
                                    {t('hearth:home.day', { name: who })}<ChevronRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                                </a>
                                <div className="mt-3 flex items-start gap-3" role="status" aria-live="polite">
                                    <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full border', style.tone)}><StateIcon className="h-5 w-5" aria-hidden="true" /></span>
                                    <div className="min-w-0">
                                        <p className="text-[22px] font-semibold leading-tight text-foreground">{p.headline}</p>
                                        <p className="mt-1 text-caption text-muted-foreground">{p.summary}</p>
                                    </div>
                                </div>
                                <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
                                    <span className="first-letter:uppercase">{today}</span>
                                    {p.timing?.last_signal_at && <><span aria-hidden="true">·</span><span>{t('hearth:home.tiles.lastSeen', { time: shortWhen(p.timing.last_signal_at) })}</span></>}
                                    {p.simulated && <Pill className="border-info/30 text-info"><FlaskConical className="h-3 w-3" aria-hidden="true" />{t('hearth:provenance.simulated')}</Pill>}
                                </p>
                                <div className="mt-5 flex flex-wrap gap-2.5">
                                    {data.recipient?.phone && (
                                        <a href={`tel:${data.recipient.phone.replace(/\s+/g, '')}`} className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-caption font-semibold text-primary-foreground shadow-surface transition-transform duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] hover:scale-[1.03]">
                                            <Phone className="h-4 w-4" aria-hidden="true" />{t('hearth:home.checkIn', { name: who })}
                                        </a>
                                    )}
                                    {canWriteContent && (
                                        <button type="button" onClick={() => setMomentOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-full border border-border-strong bg-card px-5 text-caption font-semibold text-foreground transition-colors hover:bg-surface-2">
                                            <Video className="h-4 w-4" aria-hidden="true" />{t('hearth:contact.moment')}
                                        </button>
                                    )}
                                </div>
                            </div>

                            <Link to="/hearth/trust" className="group flex items-start gap-3 rounded-[18px] border border-border bg-card/90 p-4 shadow-surface backdrop-blur transition-shadow hover:shadow-surface-hover md:col-span-2 xl:col-span-1">
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-micro text-muted-foreground">{t('hearth:home.sharingLevel')}</span>
                                    <span className="block text-[18px] font-semibold text-foreground">{levelName}</span>
                                    <span className="mt-0.5 block text-micro text-muted-foreground">{t('hearth:home.chooses', { name: who })}</span>
                                </span>
                                <ChevronRight className="mt-1 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                            </Link>
                        </div>
                    </section>

                    {/* ── Signal tiles, all from the shared view ── */}
                    <ul className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                        {tiles.map((tile) => (
                            <li key={tile.label} className="flex items-start gap-3 rounded-[18px] border border-border bg-card p-4 shadow-surface">
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"><tile.icon className="h-5 w-5" aria-hidden="true" /></span>
                                <span className="min-w-0">
                                    <span className="block text-caption font-semibold text-foreground">{tile.label}</span>
                                    <span className="block truncate text-caption text-foreground">{tile.value}</span>
                                    <span className="block truncate text-micro text-muted-foreground">{tile.sub}</span>
                                </span>
                            </li>
                        ))}
                    </ul>

                    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
                        {/* ── Why this status ── */}
                        <section id="why" className="scroll-mt-24 rounded-[22px] border border-border bg-card p-5 shadow-surface sm:p-6" aria-labelledby="why-title">
                            <h2 id="why-title" className="flex items-center gap-2 text-h2 text-foreground"><Info className="h-5 w-5 text-primary" aria-hidden="true" />{t('hearth:home.why')}</h2>
                            <p className="mt-1.5 text-caption text-muted-foreground">
                                {p.data_quality.baseline === 'ready'
                                    ? t('hearth:dashboard.baselineReady', { days: p.data_quality.baseline_days_observed, name: who })
                                    : p.data_quality.baseline === 'building'
                                        ? t('hearth:dashboard.baselineBuilding', { days: p.data_quality.baseline_days_observed, needed: p.data_quality.baseline_days_needed })
                                        : t('hearth:dashboard.baselineNone')}
                            </p>
                            {p.events ? (
                                p.events.length === 0 ? <div className="mt-4"><Empty>{t('hearth:dashboard.noEventsToday')}</Empty></div> : (
                                    <ol className="relative mt-4 space-y-3 border-l border-border pl-5">
                                        {p.events.slice(0, 6).map((e) => (
                                            <li key={`${e.at}-${e.description}`} className="relative">
                                                <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-card" aria-hidden="true" />
                                                <p className="text-caption font-semibold tabular-nums text-foreground">{clockOf(e.at)}</p>
                                                <p className="text-caption text-muted-foreground">{e.description}{e.simulated ? ` · ${t('hearth:provenance.simulated')}` : ''}</p>
                                            </li>
                                        ))}
                                    </ol>
                                )
                            ) : (
                                <p className="mt-4 rounded-[14px] border border-dashed border-border px-4 py-4 text-caption text-muted-foreground">
                                    <Clock className="mb-1 h-4 w-4 text-primary" aria-hidden="true" />
                                    {t('hearth:dashboard.notShared', { name: who, level: levelName, what: hidden || t('hearth:dashboard.notSharedEvents') })}
                                </p>
                            )}
                            {p.why_cards[0] && (
                                <p className="mt-4 flex items-start gap-2 rounded-[14px] bg-[#f6efe2] px-4 py-3 text-caption text-[#5b4a33] dark:bg-surface-2 dark:text-foreground">
                                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#b5643d]" aria-hidden="true" />
                                    <span><span className="font-semibold">{t('hearth:dashboard.nextStep')}: </span>{p.why_cards[0].next_step}</span>
                                </p>
                            )}
                            <p className="mt-4 border-t border-border pt-3 text-micro text-muted-foreground">{p.disclaimer}</p>
                        </section>

                        {/* ── Family responsibilities ── */}
                        <Section icon={ListChecks} title={t('hearth:tasks.title')} action={<Link to="/tasks" className="text-caption font-medium text-primary underline-offset-4 hover:underline">{t('hearth:tasks.seeAll')}</Link>}>
                            {data.responsibilities.length === 0 ? <Empty>{t('hearth:tasks.empty')}</Empty> : (
                                <ul className="divide-y divide-border">
                                    {data.responsibilities.slice(0, 5).map((task) => (
                                        <li key={task.id} className="flex items-center gap-3 py-3">
                                            <span className="h-5 w-5 shrink-0 rounded-[6px] border-2 border-border-strong" aria-hidden="true" />
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-caption font-medium text-foreground">{task.title}</p>
                                                <p className="text-micro text-muted-foreground">
                                                    {task.assignees.length ? task.assignees.join(', ') : t('hearth:tasks.nobody')}
                                                    {task.due_date ? ` · ${t('hearth:tasks.due', { date: formatWhen(task.due_date, intlLocale()) })}` : ''}
                                                </p>
                                            </div>
                                            {task.assignees[0]
                                                ? <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-micro font-semibold text-primary" title={task.assignees.join(', ')}>{initials(task.assignees[0])}</span>
                                                : canWriteContent && <Button size="sm" variant="ghost" className="shrink-0 whitespace-nowrap px-3" onClick={() => setAskTask({ id: task.id, title: task.title })}>{t('hearth:tasks.ask')}</Button>}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <Link to="/tasks" className="mt-2 inline-flex items-center gap-2 text-caption font-semibold text-primary"><Plus className="h-4 w-4" aria-hidden="true" />{t('hearth:home.addTask')}</Link>
                        </Section>
                    </div>

                    <AskHearthCard name={who} />

                    {p.why_cards.length > 0 && (
                        <Section icon={Sparkles} title={t('hearth:dashboard.whyTitle')}>
                            <div className="space-y-3">{p.why_cards.map((c) => <WhyCardView key={c.id} card={c} />)}</div>
                        </Section>
                    )}

                    {p.extras && (
                        <Section icon={Heart} title={t('hearth:dashboard.recoveryTitle')} action={data.policy.recovery_until ? <Pill>{t('hearth:dashboard.recoveryUntil', { date: formatWhen(data.policy.recovery_until, intlLocale()) })}</Pill> : undefined}>
                            <ul className="space-y-2 text-body">
                                {p.extras.night_rest && (
                                    <li>{p.extras.night_rest.quiet_from && p.extras.night_rest.quiet_until
                                        ? t('hearth:dashboard.nightRest', { from: clockOf(p.extras.night_rest.quiet_from), until: clockOf(p.extras.night_rest.quiet_until) })
                                        : t('hearth:dashboard.nightRestUnknown')}</li>
                                )}
                                {meds && (
                                    <li>{meds.length ? t('hearth:dashboard.medsTaken', { taken: meds.filter((m) => m.status === 'taken').length, total: meds.length }) : t('hearth:dashboard.medsNone')}</li>
                                )}
                            </ul>
                        </Section>
                    )}

                    <Section
                        icon={ListChecks}
                        title={t('hearth:proposals.title')}
                        action={canWriteContent ? (
                            <Button size="sm" variant="secondary" onClick={() => void suggest()} disabled={busy === 'suggest'}>
                                {busy === 'suggest' ? t('hearth:proposals.suggesting') : t('hearth:proposals.suggest')}
                            </Button>
                        ) : undefined}
                    >
                        {data.proposals.length === 0 ? <Empty>{t('hearth:proposals.empty')}</Empty> : (
                            <ul className="space-y-3">
                                {data.proposals.map((prop) => {
                                    const mine = !prop.target_member_id || prop.target_member_id === me?.id || me?.role === 'admin';
                                    return (
                                        <li key={prop.id} className="rounded-[18px] border border-border bg-surface p-4">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Pill>{t(`hearth:proposals.kinds.${prop.kind}`)}</Pill>
                                                <span className="text-micro text-muted-foreground">{prop.target_name ? t('hearth:proposals.for', { name: prop.target_name }) : t('hearth:proposals.forAnyone')}</span>
                                            </div>
                                            <p className="mt-2 text-body font-semibold text-foreground">{prop.title}</p>
                                            {prop.rationale && <p className="mt-1 text-caption text-muted-foreground">{prop.rationale}</p>}
                                            <p className="mt-1 text-micro text-muted-foreground">
                                                {t('hearth:proposals.by', { name: prop.proposed_by_label })} · {t('hearth:proposals.expires', { date: formatWhen(prop.expires_at, intlLocale()) })}
                                            </p>
                                            {canWriteContent && (
                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    <Button size="sm" onClick={() => void decide(prop, 'approve')} disabled={busy === prop.id || !mine}>
                                                        {prop.target_member_id ? t('hearth:proposals.approve') : t('hearth:proposals.takeIt')}
                                                    </Button>
                                                    <Button size="sm" variant="ghost" onClick={() => void decide(prop, 'reject')} disabled={busy === prop.id || !mine}>
                                                        {t('hearth:proposals.reject')}
                                                    </Button>
                                                    {!mine && <span className="self-center text-micro text-muted-foreground">{t('hearth:proposals.notAllowed')}</span>}
                                                </div>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                        {data.recent_decisions.length > 0 && (
                            <div className="mt-5">
                                <h3 className="mb-2 text-caption font-semibold text-foreground">{t('hearth:proposals.recent')}</h3>
                                <ul className="space-y-1.5 text-caption">
                                    {data.recent_decisions.map((d) => (
                                        <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2">
                                            <span className="min-w-0 text-foreground">{d.title}</span>
                                            <span className="text-muted-foreground">{t(`hearth:proposals.status.${d.status}`)}{d.decided_by_name ? ` · ${d.decided_by_name}` : ''}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </Section>
                </div>

                <aside className="space-y-5">
                    <Section icon={CalendarHeart} title={t('hearth:visits.title')}>
                        <ul className="-mx-2 space-y-1">
                            {data.upcoming_visits.map((v) => (
                                <li key={`${v.id}-${v.start_time}`} className="flex items-center gap-3 rounded-[14px] px-2 py-2.5 hover:bg-surface-2">
                                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-micro font-semibold text-primary">{initials(v.members[0] ?? v.title)}</span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-caption font-semibold text-foreground">{v.title}</span>
                                        <span className="block text-micro text-muted-foreground">{formatWhen(v.start_time, intlLocale())}</span>
                                    </span>
                                    <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                </li>
                            ))}
                            {data.upcoming_visits.length === 0 && <li className="px-2 text-caption text-muted-foreground">{t('hearth:visits.empty')}</li>}
                            {canWriteContent && (
                                <li>
                                    <button type="button" onClick={() => setVisitOpen(true)} className="flex w-full items-center gap-3 rounded-[14px] px-2 py-2.5 text-left hover:bg-surface-2">
                                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-muted-foreground"><Plus className="h-4 w-4" aria-hidden="true" /></span>
                                        <span>
                                            <span className="block text-caption font-semibold text-foreground">{t('hearth:visits.propose')}</span>
                                            <span className="block text-micro text-muted-foreground">{t('hearth:home.planHint')}</span>
                                        </span>
                                    </button>
                                </li>
                            )}
                        </ul>
                    </Section>

                    <Section icon={Heart} title={t('hearth:moments.title')}>
                        {data.moments.length === 0 ? <Empty>{t('hearth:moments.empty')}</Empty> : (
                            <ul className="space-y-3">
                                {data.moments.slice(0, 3).map((m, i) => (
                                    <li key={m.id}>
                                        {i === 0 && m.kind === 'video' && (
                                            <div className="mb-2 flex aspect-video items-center justify-center rounded-[16px] bg-[linear-gradient(135deg,#2e5e45,#14231b)] text-white">
                                                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20 backdrop-blur"><Video className="h-5 w-5" aria-label={t('hearth:moments.video_label')} /></span>
                                            </div>
                                        )}
                                        <p className="text-caption font-semibold text-foreground">{m.message || (m.kind === 'video' ? t('hearth:moments.video_label') : '')}</p>
                                        <p className="text-micro text-muted-foreground">{m.author_name ?? ''} · {formatWhen(m.created_at, intlLocale())} · {m.seen_at ? t('hearth:moments.seen') : t('hearth:moments.notSeen')}</p>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <p className="mt-3 text-micro text-muted-foreground">{t('hearth:moments.tvUnavailable')}</p>
                    </Section>
                </aside>
            </div>

            {/* ── The parent is in control ── */}
            <section className="flex flex-wrap items-center justify-between gap-4 rounded-[22px] border border-border bg-[#f1f5ef] px-5 py-4 dark:bg-card sm:px-6">
                <div className="flex items-start gap-3">
                    <Sprout className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
                    <div>
                        <p className="text-body font-semibold text-foreground">{t('hearth:home.control', { name: who })}</p>
                        <p className="text-caption text-muted-foreground">{t('hearth:home.controlBody')}</p>
                    </div>
                </div>
                <Link to="/hearth/trust" className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border-strong bg-card px-4 text-caption font-semibold text-foreground hover:bg-surface-2">
                    {t('hearth:home.manage')}<ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Link>
            </section>

            <VisitDialog open={visitOpen} onOpenChange={setVisitOpen} name={who} members={familyMembers} defaultMember={me?.id ?? ''} onDone={() => void load()} />
            <AskDialog task={askTask} onClose={() => setAskTask(null)} members={familyMembers} onDone={() => void load()} />
            <MomentDialog open={momentOpen} onOpenChange={setMomentOpen} name={who} onDone={() => void load()} />
        </div>
    );
};

// ─── Ask Hearth (Amazon Bedrock) ─────────────────────────────────────────────

interface AskAnswer { answer: string; mode: 'bedrock' | 'fallback'; model: string | null; tools_used: string[]; note: string | null }

const AskHearthCard: React.FC<{ name: string }> = ({ name }) => {
    const { t } = useTranslation('hearth');
    const [question, setQuestion] = useState('');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<AskAnswer | null>(null);
    const [error, setError] = useState('');
    const suggestions = (t('ask.suggestions', { returnObjects: true, name }) as unknown as string[]) ?? [];
    const [params, setParams] = useSearchParams();

    const ask = async (q: string) => {
        const text = q.trim();
        if (!text) return;
        setQuestion(text);
        setBusy(true);
        setError('');
        try {
            const res = await api.post<{ success: boolean; data: AskAnswer }>('/api/hearth/ask', { question: text });
            setResult(res.data ?? null);
        } catch {
            setError(t('ask.error'));
        } finally {
            setBusy(false);
        }
    };

    // A question typed in the top bar's "Ask or search" box arrives as ?ask=.
    useEffect(() => {
        const q = params.get('ask');
        if (!q) return;
        setParams((prev) => { prev.delete('ask'); return prev; }, { replace: true });
        document.getElementById('ask-hearth')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        void ask(q);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params]);

    return (
        <Section icon={Sparkles} title={t('ask.title')}>
            <form onSubmit={(e) => { e.preventDefault(); void ask(question); }} className="flex gap-2">
                <label htmlFor="ask-hearth" className="sr-only">{t('ask.title')}</label>
                <input id="ask-hearth" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={500}
                    placeholder={t('ask.placeholder', { name })} className="input-nexus min-w-0 flex-1" />
                <Button type="submit" disabled={busy || !question.trim()}>{busy ? t('ask.thinking') : t('ask.submit')}</Button>
            </form>
            <div className="mt-3 flex flex-wrap gap-2">
                {suggestions.map((s) => (
                    <button key={s} type="button" onClick={() => void ask(s)} disabled={busy}
                        className="min-h-[36px] rounded-pill border border-border bg-surface px-3 text-caption text-foreground transition-colors hover:border-primary/40 hover:bg-primary-soft">
                        {s}
                    </button>
                ))}
            </div>
            {error && <p className="mt-4 text-caption text-danger" role="alert">{error}</p>}
            {result && (
                <div className="mt-4 rounded-card border border-border bg-surface p-4" aria-live="polite">
                    <p className="text-body text-foreground">{result.answer}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-micro text-muted-foreground">
                        <Pill className={result.mode === 'bedrock' ? 'border-primary/30 text-primary' : undefined}>
                            {result.mode === 'bedrock' ? t('ask.bedrock', { model: result.model }) : t('ask.fallback')}
                        </Pill>
                        {result.tools_used.length > 0 && (
                            <span>{t('ask.used', { tools: result.tools_used.map((x) => t(`ask.tools.${x}`, { defaultValue: x })).join(', ') })}</span>
                        )}
                    </div>
                    {result.note && <p className="mt-2 text-micro text-muted-foreground">{result.note}</p>}
                </div>
            )}
            <p className="mt-4 text-micro text-muted-foreground">{t('ask.privacy', { name })}</p>
        </Section>
    );
};

// ─── Dialogs ─────────────────────────────────────────────────────────────────

const VisitDialog: React.FC<{ open: boolean; onOpenChange: (o: boolean) => void; name: string; members: Member[]; defaultMember: string; onDone: () => void }> = ({ open, onOpenChange, name, members, defaultMember, onDone }) => {
    const { t } = useTranslation('hearth');
    const { showToast } = useToast();
    const [title, setTitle] = useState('');
    const [when, setWhen] = useState(localInputValue(24));
    const [who, setWho] = useState(defaultMember);
    const [error, setError] = useState('');
    useEffect(() => { if (open) { setWho(defaultMember); setError(''); } }, [open, defaultMember]);
    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.post('/api/hearth/proposals', { kind: 'visit', title: title.trim() || t('visits.fieldTitlePlaceholder'), start_time: when, target_member_id: who });
            showToast({ title: t('visits.created') });
            onOpenChange(false);
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange} title={t('visits.dialogTitle')} description={t('visits.dialogHelp', { name })}>
            <form onSubmit={(e) => void submit(e)} className="space-y-4">
                <Input label={t('visits.fieldTitle')} placeholder={t('visits.fieldTitlePlaceholder')} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
                <Input label={t('visits.fieldWhen')} type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} />
                <div>
                    <p className="mb-1.5 text-caption font-medium text-foreground">{t('visits.fieldWho')}</p>
                    <Select value={who} onValueChange={setWho} options={members.map((m) => ({ value: m.id, label: m.name }))} />
                </div>
                {error && <p className="text-caption text-danger" role="alert">{error}</p>}
                <Button type="submit" className="w-full" disabled={!who || !when}>{t('visits.submit')}</Button>
            </form>
        </Dialog>
    );
};

const AskDialog: React.FC<{ task: { id: string; title: string } | null; onClose: () => void; members: Member[]; onDone: () => void }> = ({ task, onClose, members, onDone }) => {
    const { t } = useTranslation('hearth');
    const { showToast } = useToast();
    const [who, setWho] = useState('');
    const [error, setError] = useState('');
    useEffect(() => { setWho(''); setError(''); }, [task?.id]);
    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!task) return;
        try {
            await api.post('/api/hearth/proposals', { kind: 'assign_task', task_id: task.id, target_member_id: who });
            showToast({ title: t('tasks.asked') });
            onClose();
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };
    return (
        <Dialog open={task !== null} onOpenChange={(o) => !o && onClose()} title={t('tasks.askTitle')} description={t('tasks.askHelp')}>
            <form onSubmit={(e) => void submit(e)} className="space-y-4">
                <p className="text-body font-medium text-foreground">{task?.title}</p>
                <Select value={who} onValueChange={setWho} placeholder={t('visits.fieldWho')} options={members.map((m) => ({ value: m.id, label: m.name }))} />
                {error && <p className="text-caption text-danger" role="alert">{error}</p>}
                <Button type="submit" className="w-full" disabled={!who}>{t('tasks.askSubmit')}</Button>
            </form>
        </Dialog>
    );
};

const MomentDialog: React.FC<{ open: boolean; onOpenChange: (o: boolean) => void; name: string; onDone: () => void }> = ({ open, onOpenChange, name, onDone }) => {
    const { t } = useTranslation('hearth');
    const { showToast } = useToast();
    const [kind, setKind] = useState<'message' | 'video'>('message');
    const [message, setMessage] = useState('');
    const [video, setVideo] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [sending, setSending] = useState(false);
    useEffect(() => { if (open) { setKind('message'); setMessage(''); setVideo(null); setError(''); } }, [open]);
    const pick = async (file: File | undefined) => {
        setError('');
        setVideo(null);
        if (!file) return;
        if (!/^video\/(mp4|webm)$/.test(file.type)) return setError(t('moments.videoType'));
        if (file.size > MAX_VIDEO_BYTES) return setError(t('moments.videoTooBig'));
        setVideo(await readAsDataUrl(file));
    };
    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSending(true);
        try {
            await api.post('/api/hearth/moments', { kind, message: message.trim(), media_data_url: kind === 'video' ? video : undefined });
            showToast({ title: t('moments.sent', { name }) });
            onOpenChange(false);
            onDone();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSending(false);
        }
    };
    return (
        <Dialog open={open} onOpenChange={onOpenChange} title={t('moments.composeTitle', { name })} description={t('moments.tvUnavailable')}>
            <form onSubmit={(e) => void submit(e)} className="space-y-4">
                <div className="inline-flex rounded-pill border border-border bg-card p-1" role="radiogroup">
                    {(['message', 'video'] as const).map((k) => (
                        <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
                            className={cn('min-h-[40px] rounded-pill px-4 text-caption font-medium', kind === k ? 'bg-primary-soft text-primary' : 'text-muted-foreground')}>
                            {k === 'message' ? t('moments.kindMessage') : t('moments.kindVideo')}
                        </button>
                    ))}
                </div>
                <div>
                    <label htmlFor="moment-message" className="mb-1.5 block text-caption font-medium text-foreground">{t('moments.message')}</label>
                    <Textarea id="moment-message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('moments.messagePlaceholder')} maxLength={500} rows={3} />
                </div>
                {kind === 'video' && (
                    <div>
                        <label htmlFor="moment-video" className="mb-1.5 block text-caption font-medium text-foreground">{t('moments.video')}</label>
                        <input id="moment-video" type="file" accept="video/mp4,video/webm" onChange={(e) => void pick(e.target.files?.[0])} className="block w-full text-caption" />
                    </div>
                )}
                {error && <p className="text-caption text-danger" role="alert">{error}</p>}
                <Button type="submit" className="w-full" disabled={sending || (kind === 'message' ? !message.trim() : !video)}>{t('moments.send')}</Button>
            </form>
        </Dialog>
    );
};

export default Hearth;
