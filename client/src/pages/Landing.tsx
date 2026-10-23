import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
    ArrowRight, CameraOff, ShieldCheck, Github, Menu, X, PlugZap, Sprout, BellRing, Sparkles, Route, MessageSquareHeart, Mic,
    SlidersHorizontal, ScrollText, Plane, MonitorSmartphone, Check, CheckCircle2,
} from 'lucide-react';
import { cn } from '../lib/utils';
import HearthLogo from '../components/app/HearthLogo';
import { HeroPicture } from '../components/app/HearthHero';

/**
 * Public landing page, shown at "/" to visitors who are not signed in.
 * Honest by construction: no invented figures, testimonials or prices; the
 * one product preview on the photo is labelled "Example".
 */

const INK = 'text-[#1f2a24]';
const MUTED = 'text-[#55605a]';
const display = { fontVariationSettings: '"opsz" 120' } as const;

const NAV = [
    { key: 'home', href: '#top' },
    { key: 'how', href: '#how' },
    { key: 'families', href: '#families' },
    { key: 'parents', href: '#parents' },
    { key: 'privacy', href: '#privacy' },
    { key: 'pricing', href: '#pricing' },
] as const;

type Item = { title: string; body: string };

const SectionHead: React.FC<{ eyebrow: string; title: string; lead?: string; center?: boolean }> = ({ eyebrow, title, lead, center }) => (
    <div className={cn('max-w-2xl', center && 'mx-auto text-center')}>
        <p className="text-caption font-semibold uppercase tracking-[0.14em] text-[#b5643d]">{eyebrow}</p>
        <h2 className={cn('mt-3 font-display text-[32px] font-medium leading-[1.1] sm:text-[42px]', INK)} style={display}>{title}</h2>
        {lead && <p className={cn('mt-4 text-[17px] leading-7', MUTED)}>{lead}</p>}
    </div>
);

const GetStarted: React.FC<{ label: string; className?: string }> = ({ label, className }) => (
    <Link to="/login?mode=register" className={cn('inline-flex h-12 items-center justify-center gap-2 rounded-[10px] bg-[#234a36] px-6 text-[15px] font-semibold text-white shadow-[0_6px_18px_-8px_rgba(35,74,54,0.7)] transition-colors hover:bg-[#1c3c2c] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#234a36]/30', className)}>
        {label}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
);

const Landing: React.FC = () => {
    const { t } = useTranslation('landing');
    const [menuOpen, setMenuOpen] = useState(false);
    const list = <T,>(key: string) => t(key, { returnObjects: true }) as unknown as T[];
    const familyIcons = [Sparkles, Route, MessageSquareHeart, Mic];
    const parentIcons = [SlidersHorizontal, ScrollText, Plane, MonitorSmartphone];
    const stepIcons = [PlugZap, Sprout, BellRing];
    const pointIcons = [CameraOff, ShieldCheck, Github];

    return (
        <div id="top" className={cn('min-h-screen bg-[#f7f4ee] font-sans antialiased', INK)}>
            {/* ── Header ── */}
            <header className="sticky top-0 z-40 border-b border-[#e6e0d4]/70 bg-[#f7f4ee]/90 backdrop-blur-md">
                <div className="mx-auto flex h-[72px] max-w-[1200px] items-center justify-between gap-6 px-4 sm:px-6">
                    <a href="#top" aria-label="Hearth"><HearthLogo /></a>
                    <nav aria-label={t('nav.menu')} className="hidden items-center gap-8 lg:flex">
                        {NAV.map((n, i) => (
                            <a key={n.key} href={n.href} className={cn('text-[15px] transition-colors hover:text-[#234a36]', i === 0 ? 'font-semibold text-[#234a36]' : 'text-[#3a453f]')}>
                                {t(`nav.${n.key}`)}
                            </a>
                        ))}
                    </nav>
                    <div className="flex items-center gap-2">
                        <Link to="/login" className="hidden h-11 items-center px-3 text-[15px] font-medium text-[#3a453f] hover:text-[#234a36] sm:inline-flex">{t('nav.signIn')}</Link>
                        <GetStarted label={t('nav.getStarted')} className="hidden h-11 sm:inline-flex" />
                        <button type="button" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-label={menuOpen ? t('nav.close') : t('nav.menu')}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-[10px] border border-[#e0d9cc] bg-white lg:hidden">
                            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                        </button>
                    </div>
                </div>
                {menuOpen && (
                    <nav className="border-t border-[#e6e0d4] bg-[#f7f4ee] px-4 pb-5 pt-2 lg:hidden" aria-label={t('nav.menu')}>
                        {NAV.map((n) => (
                            <a key={n.key} href={n.href} onClick={() => setMenuOpen(false)} className="block border-b border-[#ece6da] py-3.5 text-[16px] font-medium">{t(`nav.${n.key}`)}</a>
                        ))}
                        <div className="mt-4 grid grid-cols-2 gap-3">
                            <Link to="/login" className="inline-flex h-12 items-center justify-center rounded-[10px] border border-[#d9d2c4] bg-white font-semibold">{t('nav.signIn')}</Link>
                            <GetStarted label={t('nav.getStarted')} />
                        </div>
                    </nav>
                )}
            </header>

            <main>
                {/* ── Hero ── */}
                <section className="mx-auto grid max-w-[1200px] items-center gap-10 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-[1fr_1.08fr] lg:gap-14 lg:pb-24 lg:pt-16">
                    <div>
                        <p className="inline-flex items-center gap-2 rounded-full border border-[#e3d9c8] bg-white/70 px-3.5 py-1.5 text-[13px] font-medium text-[#6b5a45]">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#c0673f]" aria-hidden="true" />{t('hero.eyebrow')}
                        </p>
                        <h1 className="mt-6 font-display text-[42px] font-medium leading-[1.04] tracking-[-0.015em] sm:text-[56px] lg:text-[64px]" style={display}>
                            {t('hero.titleA')}{' '}
                            <span className="italic text-[#2e5e45]">{t('hero.titleB')}</span>
                        </h1>
                        <p className={cn('mt-6 max-w-xl text-[18px] leading-8', MUTED)}>{t('hero.lead')}</p>
                        <div className="mt-8 flex flex-wrap items-center gap-3">
                            <GetStarted label={t('hero.primary')} className="h-[52px] px-7 text-[16px]" />
                            <a href="#how" className="inline-flex h-[52px] items-center rounded-[10px] border border-[#d9d2c4] bg-white px-6 text-[16px] font-semibold text-[#1f2a24] transition-colors hover:border-[#b9b0a0]">{t('hero.secondary')}</a>
                        </div>
                        <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-3">
                            {list<string>('hero.points').map((p, i) => {
                                const Icon = pointIcons[i] ?? Check;
                                return (
                                    <li key={p} className="flex items-center gap-2 text-[15px] font-medium text-[#3a453f]">
                                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e7efe9] text-[#234a36]"><Icon className="h-4 w-4" aria-hidden="true" /></span>
                                        {p}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

                    <div className="relative">
                        <div className="relative aspect-[4/3.2] overflow-hidden rounded-[28px] bg-[#1d3328] shadow-[0_30px_60px_-30px_rgba(31,42,36,0.55)] sm:aspect-[16/11]">
                            <HeroPicture position="80% 45%" />
                            <span className="sr-only">{t('hero.imageAlt')}</span>
                        </div>
                        {/* Product preview, labelled as an example */}
                        <div className="absolute -bottom-8 left-4 right-4 rounded-[18px] border border-[#ebe4d7] bg-white/95 p-4 shadow-[0_20px_40px_-20px_rgba(31,42,36,0.45)] backdrop-blur sm:left-auto sm:right-[-12px] sm:w-[330px] lg:-left-10 lg:right-auto">
                            <div className="flex items-center justify-between">
                                <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#2f7a4d]">
                                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t('hero.cardStatus')}
                                </span>
                                <span className="rounded-full bg-[#f1efea] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#6b6358]">{t('hero.cardExample')}</span>
                            </div>
                            <p className="mt-2 text-[15px] font-semibold">{t('hero.cardDetail')}</p>
                            <p className={cn('text-[13px]', MUTED)}>{t('hero.cardBaseline')}</p>
                            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#e7efe9] px-2.5 py-1 text-[12px] font-semibold text-[#234a36]">
                                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />{t('hero.cardShares')}
                            </p>
                        </div>
                    </div>
                </section>

                {/* ── How it works ── */}
                <section id="how" className="scroll-mt-24 border-t border-[#e9e3d7] bg-white py-20 lg:py-28">
                    <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
                        <SectionHead eyebrow={t('how.eyebrow')} title={t('how.title')} center />
                        <ol className="mt-14 grid gap-6 md:grid-cols-3">
                            {list<Item>('how.steps').map((s, i) => {
                                const Icon = stepIcons[i];
                                return (
                                    <li key={s.title} className="rounded-[20px] border border-[#ece6da] bg-[#fbf9f5] p-7">
                                        <div className="flex items-center justify-between">
                                            <span className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-[#234a36] text-white"><Icon className="h-6 w-6" aria-hidden="true" /></span>
                                            <span className="font-display text-[40px] font-medium leading-none text-[#e0d8c9]" style={display}>{i + 1}</span>
                                        </div>
                                        <h3 className="mt-6 text-[19px] font-semibold">{s.title}</h3>
                                        <p className={cn('mt-2 text-[15px] leading-7', MUTED)}>{s.body}</p>
                                    </li>
                                );
                            })}
                        </ol>
                    </div>
                </section>

                {/* ── For families / for parents ── */}
                {([['families', familyIcons, 'bg-[#f7f4ee]'], ['parents', parentIcons, 'bg-white']] as const).map(([key, icons, bg]) => (
                    <section key={key} id={key} className={cn('scroll-mt-24 py-20 lg:py-28', bg)}>
                        <div className="mx-auto grid max-w-[1200px] gap-12 px-4 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
                            <SectionHead eyebrow={t(`${key}.eyebrow`)} title={t(`${key}.title`)} />
                            <ul className="grid gap-5 sm:grid-cols-2">
                                {list<Item>(`${key}.items`).map((it, i) => {
                                    const Icon = icons[i];
                                    return (
                                        <li key={it.title} className="rounded-[18px] border border-[#ece6da] bg-white p-6 shadow-[0_1px_2px_rgba(28,25,20,0.04)]">
                                            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f6e9e1] text-[#b5643d]"><Icon className="h-5 w-5" aria-hidden="true" /></span>
                                            <h3 className="mt-4 text-[17px] font-semibold">{it.title}</h3>
                                            <p className={cn('mt-1.5 text-[15px] leading-7', MUTED)}>{it.body}</p>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    </section>
                ))}

                {/* ── Security & privacy ── */}
                <section id="privacy" className="scroll-mt-24 bg-[#1f3a2c] py-20 text-white lg:py-28">
                    <div className="mx-auto grid max-w-[1200px] gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16">
                        <div>
                            <p className="text-caption font-semibold uppercase tracking-[0.14em] text-[#e8a07a]">{t('privacy.eyebrow')}</p>
                            <h2 className="mt-3 font-display text-[32px] font-medium leading-[1.1] sm:text-[42px]" style={display}>{t('privacy.title')}</h2>
                            <p className="mt-4 text-[17px] leading-7 text-white/80">{t('privacy.lead')}</p>
                            <ul className="mt-8 space-y-3.5">
                                {list<string>('privacy.facts').map((f) => (
                                    <li key={f} className="flex gap-3 text-[15px] leading-7 text-white/90">
                                        <Check className="mt-1 h-4 w-4 shrink-0 text-[#e8a07a]" aria-hidden="true" />{f}
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <ol className="space-y-3 self-center" aria-label="Glimpse Dial">
                            {list<Item & { name: string }>('privacy.levels').map((l, i) => (
                                <li key={l.name} className="flex items-center gap-4 rounded-[16px] border border-white/12 bg-white/[0.06] p-4">
                                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-display text-[18px] font-medium" style={{ background: `rgba(232,160,122,${0.18 + i * 0.18})` }}>{i + 1}</span>
                                    <span>
                                        <span className="block text-[17px] font-semibold">{l.name}</span>
                                        <span className="block text-[14px] text-white/70">{l.body}</span>
                                    </span>
                                </li>
                            ))}
                        </ol>
                    </div>
                </section>

                {/* ── Pricing ── */}
                <section id="pricing" className="scroll-mt-24 bg-[#f7f4ee] py-20 lg:py-28">
                    <div className="mx-auto max-w-[1200px] px-4 sm:px-6">
                        <SectionHead eyebrow={t('pricing.eyebrow')} title={t('pricing.title')} center />
                        <div className="mx-auto mt-14 grid max-w-4xl gap-6 md:grid-cols-2">
                            <div className="rounded-[22px] border-2 border-[#234a36] bg-white p-8">
                                <h3 className="text-[18px] font-semibold">{t('pricing.self.name')}</h3>
                                <p className="mt-3 font-display text-[44px] font-medium leading-none" style={display}>{t('pricing.self.price')}</p>
                                <p className={cn('mt-2 text-[14px]', MUTED)}>{t('pricing.self.note')}</p>
                                <ul className="mt-6 space-y-2.5">
                                    {list<string>('pricing.self.features').map((f) => (
                                        <li key={f} className="flex items-center gap-2.5 text-[15px]"><Check className="h-4 w-4 text-[#2e5e45]" aria-hidden="true" />{f}</li>
                                    ))}
                                </ul>
                                <GetStarted label={t('pricing.self.cta')} className="mt-8 w-full" />
                            </div>
                            <div className="rounded-[22px] border border-dashed border-[#d6cfc1] bg-[#fbf9f5] p-8">
                                <h3 className="text-[18px] font-semibold">{t('pricing.hosted.name')}</h3>
                                <p className="mt-3 font-display text-[30px] font-medium leading-tight text-[#6b6358]" style={display}>{t('pricing.hosted.price')}</p>
                                <p className={cn('mt-2 text-[14px]', MUTED)}>{t('pricing.hosted.note')}</p>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ── Final call to action ── */}
                <section className="px-4 pb-20 sm:px-6">
                    <div className="relative isolate mx-auto max-w-[1200px] overflow-hidden rounded-[28px] bg-[#1d3328] px-6 py-14 text-center text-white sm:px-12">
                        <HeroPicture position="60% 40%" className="opacity-35" />
                        <div aria-hidden="true" className="absolute inset-0 bg-[#14231b]/60" />
                        <div className="relative z-10 mx-auto max-w-xl">
                            <h2 className="font-display text-[32px] font-medium leading-tight sm:text-[40px]" style={display}>{t('cta.title')}</h2>
                            <p className="mt-3 text-[17px] text-white/85">{t('cta.body')}</p>
                            <Link to="/login?mode=register" className="mt-8 inline-flex h-[52px] items-center gap-2 rounded-[10px] bg-white px-7 text-[16px] font-semibold text-[#1f3a2c] transition-colors hover:bg-[#f1efe7]">
                                {t('cta.button')}<ArrowRight className="h-4 w-4" aria-hidden="true" />
                            </Link>
                        </div>
                    </div>
                </section>
            </main>

            <footer className="border-t border-[#e6e0d4] bg-[#f7f4ee]">
                <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
                    <div>
                        <HearthLogo />
                        <p className={cn('mt-3 text-[14px]', MUTED)}>{t('footer.tagline')}</p>
                    </div>
                    <div className={cn('max-w-md space-y-2 text-[13px] leading-6', MUTED)}>
                        <p>
                            <a href="https://github.com/NexaFlowFrance/OpenCare" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-[#234a36]">{t('footer.attribution')}</a>
                        </p>
                        <p>{t('footer.disclaimer')}</p>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default Landing;
