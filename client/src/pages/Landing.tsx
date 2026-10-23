import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
    ArrowRight, ShieldCheck, Menu, X, PlugZap, Sprout, BellRing, Sparkles, Route, MessageSquareHeart, Mic,
    SlidersHorizontal, ScrollText, Plane, MonitorSmartphone, Check, Play, ChevronRight, Heart, Sun, DoorOpen, Leaf, Lock, Users, Home, CalendarCheck,
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
    <Link to="/login" className={cn('inline-flex h-12 items-center justify-center gap-2 rounded-[10px] bg-[#234a36] px-6 text-[15px] font-semibold text-white shadow-[0_6px_18px_-8px_rgba(35,74,54,0.7)] transition-colors hover:bg-[#1c3c2c] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#234a36]/30', className)}>
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
    const pointIcons = [Leaf, Lock, Users];
    const cardIcons = [Sun, DoorOpen, Mic];
    const benefitIcons = [Home, CalendarCheck, Users, ShieldCheck];

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
                {/* ── Hero: full-bleed photograph, cream fade on the reading side ── */}
                <section className="relative isolate overflow-hidden bg-[#f7f4ee]">
                    <div className="absolute inset-0 hidden lg:block">
                        <HeroPicture position="78% 50%" />
                        <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(90deg,#f7f4ee_0%,#f7f4ee_24%,rgba(247,244,238,0.82)_34%,rgba(247,244,238,0.2)_46%,rgba(247,244,238,0)_54%)]" />
                    </div>
                    <span className="sr-only">{t('hero.imageAlt')}</span>

                    <div className="relative mx-auto max-w-[1280px] px-4 pb-12 pt-10 sm:px-6 lg:flex lg:min-h-[700px] lg:items-center lg:pb-36 lg:pt-16">
                        <div className="max-w-[560px]">
                            <p className="flex flex-wrap items-center gap-x-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#5d6b62] sm:tracking-[0.22em]">
                                {list<string>('hero.eyebrow').map((w, i) => (
                                    <React.Fragment key={w}>{i > 0 && <span aria-hidden="true">•</span>}<span>{w}</span></React.Fragment>
                                ))}
                            </p>
                            <h1 className="mt-5 max-w-[450px] font-display text-[44px] font-medium leading-[1.04] tracking-[-0.02em] sm:text-[56px] lg:text-[62px]" style={display}>
                                {t('hero.titleA').split(' ').slice(0, -1).join(' ')}{' '}
                                <span className="whitespace-nowrap">{t('hero.titleA').split(' ').slice(-1)[0]}{' '}<span className="italic text-[#2e5e45]">{t('hero.titleB')}</span></span>
                            </h1>
                            <p className={cn('mt-6 max-w-[500px] text-[18px] leading-8', MUTED)}>{t('hero.lead')}</p>
                            <div className="mt-8 flex flex-wrap items-center gap-3">
                                <GetStarted label={t('hero.primary')} className="h-[52px] rounded-full px-7 text-[16px]" />
                                <a href="#how" className="inline-flex h-[52px] items-center gap-2 rounded-full border border-[#cfc6b6] bg-white/70 px-6 text-[16px] font-semibold text-[#1f2a24] backdrop-blur transition-colors hover:border-[#9f9584]">
                                    {t('hero.secondary')}<Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                                </a>
                            </div>
                            <ul className="mt-10 flex flex-wrap gap-x-5 gap-y-3">
                                {list<string>('hero.points').map((p, i) => {
                                    const Icon = pointIcons[i] ?? Check;
                                    return (
                                        <li key={p} className="flex items-center gap-2.5 whitespace-nowrap text-[14px] font-medium leading-5 text-[#3a453f]">
                                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/80 text-[#234a36] shadow-[0_1px_2px_rgba(28,25,20,0.08)]"><Icon className="h-4 w-4" aria-hidden="true" /></span>
                                            {p}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    </div>

                    {/* Product previews over the photo (wide screens), labelled as examples */}
                    <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden xl:block">
                        <div className="absolute left-[44%] top-[5%] w-[250px] space-y-2">
                            <span className="ml-1 inline-block rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#6b6358]">{t('hero.cardExample')}</span>
                            {list<{ title: string; body: string; time: string }>('hero.cards').map((c, i) => {
                                const Icon = cardIcons[i];
                                return (
                                    <div key={c.title} className="flex items-center gap-3 rounded-[14px] border border-white/60 bg-white/70 px-3.5 py-2 shadow-[0_12px_30px_-14px_rgba(31,42,36,0.45)] backdrop-blur-md">
                                        <Icon className="h-5 w-5 shrink-0 text-[#234a36]" aria-hidden="true" />
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-[13px] font-semibold text-[#1f2a24]">{c.title}</span>
                                            <span className="block truncate text-[11.5px] text-[#55605a]">{c.body}</span>
                                            <span className="block text-[11px] text-[#7a847e]">{c.time}</span>
                                        </span>
                                        <ChevronRight className="h-4 w-4 text-[#9aa39d]" />
                                    </div>
                                );
                            })}
                        </div>
                        <div className="absolute right-[5%] top-[8%] flex w-[250px] items-center gap-3 rounded-[16px] border border-white/50 bg-white/65 px-3.5 py-3 shadow-[0_16px_36px_-16px_rgba(31,42,36,0.5)] backdrop-blur-md">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f6e9e1] text-[#b5643d]"><MessageSquareHeart className="h-5 w-5" /></span>
                            <span className="min-w-0 flex-1 text-[#1f2a24]">
                                <span className="block text-[13px] font-semibold">{t('hero.message.from')}</span>
                                <span className="block text-[12px] text-[#55605a]">{t('hero.message.body')}</span>
                                <span className="flex items-center gap-1 text-[12px] font-medium">{t('hero.message.note')}<Heart className="h-3 w-3 fill-[#d0574a] text-[#d0574a]" /></span>
                                <span className="block text-[11px] text-[#7a847e]">{t('hero.message.time')}</span>
                            </span>
                        </div>
                        <p className="absolute bottom-[24%] right-[4%] rotate-[-6deg] text-right font-display text-[22px] italic leading-snug text-white [text-shadow:0_2px_12px_rgba(0,0,0,0.45)]" style={display}>
                            {list<string>('hero.script').map((l) => <span key={l} className="block">{l}</span>)}
                        </p>
                    </div>

                    {/* Phones and tablets: the photograph below the text */}
                    <div className="relative mx-4 mb-10 aspect-[4/3] overflow-hidden rounded-[24px] shadow-[0_24px_48px_-28px_rgba(31,42,36,0.6)] sm:mx-6 lg:hidden">
                        <HeroPicture position="80% 50%" />
                    </div>

                    {/* Curved lower edge */}
                    <svg aria-hidden="true" viewBox="0 0 1440 90" preserveAspectRatio="none" className="absolute bottom-0 left-0 hidden h-[90px] w-full lg:block">
                        <path d="M0 52 C 360 96, 900 8, 1440 46 L1440 90 L0 90 Z" fill="#f7f4ee" />
                    </svg>
                </section>

                {/* ── Benefits ── */}
                <section aria-label={t('nav.families')} className="bg-[#f7f4ee] pb-16 lg:pb-20">
                    <ul className="mx-auto grid max-w-[1280px] gap-8 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
                        {list<Item>('benefits').map((b, i) => {
                            const Icon = benefitIcons[i];
                            return (
                                <li key={b.title} className="flex gap-4">
                                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#e7efe9] text-[#234a36]"><Icon className="h-5 w-5" aria-hidden="true" /></span>
                                    <span>
                                        <span className="block text-[16px] font-semibold">{b.title}</span>
                                        <span className={cn('mt-1 block text-[14px] leading-6', MUTED)}>{b.body}</span>
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
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
                            <Link to="/login" className="mt-8 inline-flex h-[52px] items-center gap-2 rounded-[10px] bg-white px-7 text-[16px] font-semibold text-[#1f3a2c] transition-colors hover:bg-[#f1efe7]">
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
