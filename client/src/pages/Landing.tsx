import React, { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { InertiaPlugin } from 'gsap/InertiaPlugin';
import Lenis from 'lenis';
import { ArrowRight, ArrowUpRight, Menu, X, Check, Plus, Eye } from 'lucide-react';
import { cn } from '../lib/utils';
import { HeroPicture } from '../components/app/HearthHero';
import { HeartSticker, DoorSticker, CupSticker, Sparkle, LoopArrow, Blob, Scribble } from '../components/landing/Stickers';
import './landing.css';

gsap.registerPlugin(ScrollTrigger, InertiaPlugin);

/**
 * Public landing page ("/" for visitors who are not signed in).
 * One orchestrated hero entrance, scroll-driven type, throwable cards, and
 * the interactive Glimpse Dial. Every animation is skipped when the visitor
 * prefers reduced motion. Previews over photos are labelled "Example".
 */

const BASE = import.meta.env.BASE_URL;
const DEMO_LOGIN = import.meta.env.VITE_DEMO_LOGIN as string | undefined;
const NAV = [
    { key: 'how', href: '#how' },
    { key: 'parents', href: '#parents' },
    { key: 'privacy', href: '#privacy' },
    { key: 'faq', href: '#faq' },
] as const;
const prefersReduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Item = { title: string; body: string };

/** The Glimpse Dial as a half-circle gauge; the buttons below it are the real control. */
const DialArc: React.FC<{ level: number }> = ({ level }) => {
    const cx = 160, cy = 150, r = 120;
    const pt = (deg: number) => [cx + r * Math.cos((deg * Math.PI) / 180), cy - r * Math.sin((deg * Math.PI) / 180)];
    const arc = (i: number) => {
        const [x1, y1] = pt(180 - 45 * i - 3); const [x2, y2] = pt(180 - 45 * (i + 1) + 3);
        return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
    };
    const a = ((180 - 45 * level - 22.5) * Math.PI) / 180;
    return (
        <svg viewBox="0 0 320 170" className="w-full max-w-[340px]" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
                <path key={i} d={arc(i)} fill="none" strokeWidth={22} strokeLinecap="round"
                    stroke={i <= level ? `rgba(240,183,150,${0.45 + i * 0.18})` : 'rgba(255,255,255,0.10)'} className="transition-[stroke] duration-300" />
            ))}
            <line x1={cx} y1={cy} x2={cx + 92 * Math.cos(a)} y2={cy - 92 * Math.sin(a)} stroke="#fff" strokeWidth={4} strokeLinecap="round" className="transition-all duration-500 motion-reduce:transition-none" />
            <circle cx={cx} cy={cy} r={10} fill="#fff" />
        </svg>
    );
};

const Landing: React.FC = () => {
    const { t } = useTranslation('landing');
    const list = <T,>(key: string) => t(key, { returnObjects: true }) as unknown as T[];
    const [menuOpen, setMenuOpen] = useState(false);
    const [level, setLevel] = useState(1);
    const root = useRef<HTMLDivElement>(null);

    // Smooth scrolling, driven by the GSAP ticker so ScrollTrigger stays in sync.
    useLayoutEffect(() => {
        if (prefersReduced()) return;
        const lenis = new Lenis({ duration: 1.15, easing: (x) => Math.min(1, 1.001 - Math.pow(2, -10 * x)), anchors: true });
        lenis.on('scroll', ScrollTrigger.update);
        const tick = (time: number) => lenis.raf(time * 1000);
        gsap.ticker.add(tick);
        gsap.ticker.lagSmoothing(0);
        return () => { gsap.ticker.remove(tick); lenis.destroy(); };
    }, []);

    useLayoutEffect(() => {
        if (prefersReduced() || !root.current) return;
        const el = root.current;
        const ctx = gsap.context(() => {
            // ① Hero: one orchestrated entrance.
            gsap.timeline({ defaults: { ease: 'power4.out' } })
                .from('.hl-hero-line', { yPercent: 110, duration: 1.2, stagger: 0.12 })
                .from('.hl-hero-heart', { scale: 0, rotation: -40, duration: 1.6, ease: 'elastic.out(1, 0.4)' }, 0.7)
                .from('.hl-hero-fade', { y: 24, opacity: 0, duration: 0.9, stagger: 0.08 }, 0.6);

            // ② Pinned sentence that travels sideways while each letter settles.
            const words = el.querySelector<HTMLElement>('.hl-words');
            const track = el.querySelector<HTMLElement>('.hl-track');
            if (words && track) {
                const travel = gsap.fromTo(track, { x: () => window.innerWidth * 0.85 }, {
                    x: () => -(track.scrollWidth - window.innerWidth * 0.15), ease: 'none',
                    scrollTrigger: { trigger: words, start: 'top top', end: () => `+=${track.scrollWidth}`, pin: true, scrub: 1, invalidateOnRefresh: true },
                });
                track.querySelectorAll('.hl-letter').forEach((letter) => {
                    gsap.from(letter, {
                        yPercent: (Math.random() - 0.5) * 420, rotation: (Math.random() - 0.5) * 60, ease: 'elastic.out(1.2, 1)',
                        scrollTrigger: { trigger: letter, containerAnimation: travel, start: 'left 98%', end: 'left 60%', scrub: 0.5 },
                    });
                });
                track.querySelectorAll('.hl-sticker').forEach((s) => {
                    gsap.from(s, {
                        scale: 0, rotation: (Math.random() - 0.5) * 70, ease: 'elastic.out(1.2, 1)',
                        scrollTrigger: { trigger: s, containerAnimation: travel, start: 'left 95%', end: 'left 60%', scrub: 0.5 },
                    });
                });
            }

            // ③ Lines that draw themselves as they come into view.
            gsap.utils.toArray<SVGPathElement>('.hl-draw').forEach((p) => {
                gsap.to(p, { strokeDashoffset: 0, duration: 1.4, ease: 'power2.inOut', scrollTrigger: { trigger: p, start: 'top 85%' } });
            });

            // ④ Photo cards drop in, then can be "thrown" with the mouse.
            gsap.from('.hl-card', { y: 120, rotation: (i: number) => (i % 2 ? 12 : -12), opacity: 0, duration: 1.2, stagger: 0.12, ease: 'power3.out', scrollTrigger: { trigger: '.hl-stage', start: 'top 75%' } });
            gsap.from('.hl-pill', { scale: 0, duration: 1.2, stagger: 0.1, ease: 'elastic.out(1, 0.5)', scrollTrigger: { trigger: '.hl-stage', start: 'top 60%' } });
            gsap.utils.toArray<HTMLElement>('.hl-card, .hl-pill').forEach((item) => {
                let lx = 0, ly = 0, vx = 0, vy = 0;
                item.addEventListener('mouseenter', (e) => { lx = e.clientX; ly = e.clientY; vx = vy = 0; });
                item.addEventListener('mousemove', (e) => { vx = e.clientX - lx; vy = e.clientY - ly; lx = e.clientX; ly = e.clientY; });
                item.addEventListener('mouseleave', () => {
                    gsap.to(item, { inertia: { x: { velocity: vx * 22, end: 0 }, y: { velocity: vy * 22, end: 0 }, rotation: { velocity: vx * 1.6, end: Number(item.dataset.rot ?? 0) } } });
                });
            });
        }, el);
        return () => ctx.revert();
    }, []);

    const cta = 'inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-semibold transition-transform duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] hover:scale-[1.04] focus:outline-none focus-visible:ring-4';
    const tiles = ['bg-[#234a36] text-white', 'bg-[#e8806b] text-[#1f2a24]', 'bg-[#14231b] text-white', 'bg-[#f3d9b8] text-[#1f2a24]', 'bg-[#cfe0d4] text-[#1f2a24]', 'bg-[#b5643d] text-white'];
    const sentence = t('words.text').split(' ');
    const dialTitle = t('dial.title').split(' ');

    return (
        <div ref={root} className="hl min-h-screen overflow-x-clip bg-[#f2ede4] text-[#1f2a24] antialiased">
            {/* ── Hero: the living room, framed ── */}
            <header id="top" className="h-[100svh] min-h-[640px] p-2 sm:p-3">
                <div className="relative isolate flex h-full flex-col overflow-hidden rounded-[22px] bg-[#14231b] text-white sm:rounded-[28px]">
                    <div className="hl-drift absolute inset-0 -z-10"><HeroPicture position="68% 45%" /></div>
                    <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(15,26,20,0.55)_0%,rgba(15,26,20,0.05)_30%,rgba(15,26,20,0.2)_55%,rgba(15,26,20,0.92)_100%)]" />
                    <span className="sr-only">{t('hero.imageAlt')}</span>

                    <nav aria-label={t('nav.menu')} className="flex items-center justify-between gap-4 px-5 py-5 sm:px-8">
                        <a href="#top" className="flex items-center gap-2.5 text-[22px] font-extrabold tracking-[-0.03em]">
                            <img src={`${BASE}hearth-mark.svg`} alt="" className="h-9 w-9" />Hearth
                        </a>
                        <ul className="hidden items-center gap-8 text-[15px] font-medium text-white/85 lg:flex">
                            {NAV.map((n) => <li key={n.key}><a href={n.href} className="transition-colors hover:text-white">{t(`nav.${n.key}`)}</a></li>)}
                        </ul>
                        <div className="flex items-center gap-2">
                            <Link to="/login" className="hidden h-10 items-center rounded-full border border-white/60 px-5 text-[14px] font-semibold transition-colors hover:bg-white hover:text-[#14231b] sm:inline-flex">{t('nav.signIn')}</Link>
                            <Link to="/login" className={cn(cta, 'hidden h-10 bg-white px-5 text-[14px] text-[#14231b] focus-visible:ring-white/40 sm:inline-flex')}>{t('nav.getStarted')}</Link>
                            <button type="button" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} aria-label={menuOpen ? t('nav.close') : t('nav.menu')}
                                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/40 lg:hidden">
                                {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                            </button>
                        </div>
                    </nav>
                    {menuOpen && (
                        <div className="mx-4 rounded-[20px] bg-[#fffaf2] p-4 text-[#1f2a24] shadow-2xl lg:hidden">
                            {NAV.map((n) => <a key={n.key} href={n.href} onClick={() => setMenuOpen(false)} className="block border-b border-[#ece6da] py-3 text-[17px] font-semibold last:border-0">{t(`nav.${n.key}`)}</a>)}
                            <Link to="/login" className={cn(cta, 'mt-3 w-full bg-[#234a36] text-white')}>{t('nav.signIn')}</Link>
                        </div>
                    )}

                    <div className="mt-auto px-4 pb-8 text-center sm:px-8 sm:pb-12">
                        <h1 className="hl-heavy mx-auto text-[13.5vw] sm:text-[9vw] lg:text-[6.6vw] 2xl:text-[7.2rem]">
                            <span className="block overflow-hidden pb-[0.06em]"><span className="hl-hero-line block">{t('hero2.line1')}</span></span>
                            <span className="block overflow-hidden pb-[0.12em] pt-[0.2em]">
                                <span className="hl-hero-line block">
                                    {t('hero2.line2')}{' '}
                                    <span className="relative inline-block">
                                        <span className="hl-serif text-[#f0b796]">{t('hero2.word')}</span>
                                        <HeartSticker className="hl-hero-heart absolute -right-[0.45em] -top-[0.25em] w-[0.55em] rotate-12" />
                                    </span>
                                </span>
                            </span>
                        </h1>
                        <p className="hl-hero-fade mx-auto mt-6 max-w-[560px] text-[16px] leading-7 text-white/85 sm:text-[18px]">{t('hero2.lead')}</p>
                        <div className="hl-hero-fade mt-7 flex flex-wrap items-center justify-center gap-3">
                            <Link to="/login" className={cn(cta, 'h-[52px] bg-white px-7 text-[16px] text-[#14231b] focus-visible:ring-white/40')}>{t('hero.primary')}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
                            <a href="#how" className={cn(cta, 'h-[52px] border border-white/50 px-7 text-[16px] text-white focus-visible:ring-white/30')}>{t('hero.secondary')}</a>
                        </div>
                    </div>

                    {/* Example status, bottom-left on wide screens */}
                    <div className="hl-hero-fade absolute bottom-8 left-8 hidden w-[270px] rounded-[18px] border border-white/25 bg-white/15 p-4 backdrop-blur-xl xl:block">
                        <p className="flex items-center gap-2 text-[14px] font-bold"><span className="h-2 w-2 rounded-full bg-[#7fd39b]" />{t('hero2.status')}</p>
                        <p className="mt-1 text-[12.5px] text-white/75">{t('hero2.statusSub')}</p>
                        <span className="mt-2 inline-block rounded-full bg-white/20 px-2 py-0.5 text-[10.5px] font-semibold">{t('hero2.example')}</span>
                    </div>
                </div>
            </header>

            <main>
                {/* ── The sentence that travels ── */}
                <section id="how" className="hl-words relative flex h-[100svh] flex-col justify-center overflow-hidden">
                    <LoopArrow className="absolute left-[3%] top-[12%] w-[220px] sm:w-[320px]" pathClassName="hl-draw" />
                    <div className="hl-track hl-heavy flex w-max items-center whitespace-nowrap text-[24vw] will-change-transform sm:text-[17vw] lg:text-[12.5rem]" role="img" aria-label={t('words.text')}>
                        {sentence.map((w, wi) => (
                            <React.Fragment key={`${w}-${wi}`}>
                                <span className="mr-[0.22em] inline-flex" aria-hidden="true">
                                    {[...w].map((ch, ci) => <span key={ci} className="hl-letter inline-block">{ch}</span>)}
                                </span>
                                {wi === 2 && <DoorSticker className="hl-sticker mr-[0.2em] inline-block w-[0.62em] -rotate-6" />}
                                {wi === 4 && <CupSticker className="hl-sticker mr-[0.2em] inline-block w-[0.7em] rotate-6" />}
                                {wi === sentence.length - 1 && <HeartSticker className="hl-sticker inline-block w-[0.6em] -rotate-12" />}
                            </React.Fragment>
                        ))}
                    </div>
                    <p className="mx-auto mt-10 max-w-[600px] px-6 text-center text-[17px] leading-8 sm:text-[19px]">{t('words.lead')}</p>
                </section>

                {/* ── Throwable cards: what the family sees ── */}
                <section id="privacy" className="relative overflow-hidden py-24 lg:py-32">
                    <h2 className="hl-heavy px-4 text-center text-[13vw] sm:text-[9vw] lg:text-[7.5rem]">
                        <span className="block">{t('cards.title')}</span>
                        <span className="relative inline-block pt-[0.1em]">
                            <span className="hl-serif text-[#2e5e45]">{t('cards.titleSerif')}</span>
                            <Scribble className="absolute -bottom-[0.12em] left-0 h-[0.2em] w-full text-[#e8806b]" pathClassName="hl-draw" />
                        </span>
                    </h2>

                    <div className="hl-stage relative mx-auto mt-16 h-[360px] max-w-[1120px] px-4 sm:h-[480px] lg:h-[580px]">
                        <Blob className="absolute left-[2%] top-[4%] w-[46%] opacity-95" fill="#cfe0d4" />
                        <Sparkle className="absolute right-[6%] top-0 w-12" />
                        {[
                            { src: 'hearth/shot-dashboard.webp', cls: 'left-[4%] top-[12%] w-[46%]', rot: -6 },
                            { src: 'hearth/shot-trust.webp', cls: 'left-[34%] top-[2%] w-[40%]', rot: 4 },
                            { src: 'hearth/hero-1200.jpg', cls: 'left-[62%] top-[20%] w-[34%]', rot: -3 },
                        ].map((c, i) => (
                            <div key={c.src} data-rot={c.rot} className={cn('hl-card absolute cursor-grab overflow-hidden rounded-[14px] border-[6px] border-white bg-white shadow-[0_30px_60px_-24px_rgba(20,35,27,0.55)] sm:rounded-[18px] sm:border-8', c.cls)} style={{ rotate: `${c.rot}deg` }}>
                                <img src={`${BASE}${c.src}`} alt={list<string>('cards.alts')[i]} loading="lazy" className={cn('block w-full', i === 2 && 'aspect-[4/3] object-cover object-[78%_50%]')} />
                            </div>
                        ))}
                        {list<string>('cards.labels').map((l, i) => (
                            <span key={l} data-rot={[-4, 3, -2, 5][i]} style={{ rotate: `${[-4, 3, -2, 5][i]}deg` }}
                                className={cn('hl-pill absolute z-10 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[12px] font-semibold shadow-lg sm:text-[15px]',
                                    ['left-[8%] top-[4%] bg-[#f3d9b8]', 'bottom-[14%] left-[40%] bg-[#e8806b]', 'right-[4%] top-[12%] bg-[#cfe0d4]', 'bottom-[2%] right-[10%] bg-white'][i])}>
                                {l}
                            </span>
                        ))}
                    </div>
                    <p className="mx-auto mt-14 max-w-[620px] px-6 text-center text-[17px] leading-8 sm:text-[19px]">{t('cards.lead')}</p>
                </section>

                {/* ── The Glimpse Dial, interactive ── */}
                <section id="parents" className="px-2 sm:px-3">
                    <div className="mx-auto grid max-w-[1440px] gap-14 rounded-[22px] bg-[#14231b] px-6 py-20 text-white sm:rounded-[28px] sm:px-12 lg:grid-cols-2 lg:gap-20 lg:px-20 lg:py-28">
                        <div>
                            <h2 className="hl-heavy text-[15vw] sm:text-[10vw] lg:text-[6.5rem]">
                                {dialTitle.slice(0, -2).join(' ')}{' '}
                                <span className="hl-serif text-[#f0b796]">{dialTitle.slice(-2).join(' ')}</span>
                            </h2>
                            <p className="mt-6 max-w-[460px] text-[18px] leading-8 text-white/75">{t('dial.lead')}</p>
                            <ul className="mt-10 space-y-5">
                                {list<Item>('dial.items').map((it) => (
                                    <li key={it.title} className="border-t border-white/15 pt-5">
                                        <p className="text-[18px] font-bold">{it.title}</p>
                                        <p className="mt-1 text-[15px] leading-7 text-white/70">{it.body}</p>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div className="self-center rounded-[28px] border border-white/10 bg-white/[0.05] p-6 sm:p-8">
                            <div className="flex justify-center"><DialArc level={level} /></div>
                            <div role="group" aria-label={t('dial.control')} className="mt-2 grid grid-cols-4 gap-1 rounded-full bg-black/25 p-1">
                                {list<{ name: string }>('dial.levels').map((l, i) => (
                                    <button key={l.name} type="button" aria-pressed={level === i} onClick={() => setLevel(i)}
                                        className={cn('h-11 rounded-full text-[13px] font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f0b796] sm:text-[14px]',
                                            level === i ? 'bg-white text-[#14231b]' : 'text-white/70 hover:text-white')}>
                                        {l.name}
                                    </button>
                                ))}
                            </div>
                            <p className="mt-3 text-center text-[13px] text-white/60">{list<{ short: string }>('dial.levels')[level]?.short}</p>
                            <div className="mt-6 rounded-[20px] bg-[#fffaf2] p-5 text-[#1f2a24]" aria-live="polite">
                                <div className="flex items-center justify-between">
                                    <p className="flex items-center gap-2 text-[14px] font-bold"><Eye className="h-4 w-4 text-[#2e5e45]" aria-hidden="true" />{t('dial.preview')}</p>
                                    <span className="rounded-full bg-[#efe9dd] px-2 py-0.5 text-[11px] font-semibold text-[#6b6358]">{t('dial.example')}</span>
                                </div>
                                <ul className="mt-3 space-y-2">
                                    {list<{ lines: string[] }>('dial.levels').slice(0, level + 1).flatMap((l, li) => l.lines.map((line) => (
                                        <li key={line} className="flex items-start gap-2.5 text-[15px] leading-6">
                                            {li === 0 ? <Check className="mt-1 h-4 w-4 shrink-0 text-[#2f7a4d]" aria-hidden="true" /> : <Plus className="mt-1 h-4 w-4 shrink-0 text-[#b5643d]" aria-hidden="true" />}
                                            {line}
                                        </li>
                                    )))}
                                </ul>
                            </div>
                            <div className="mt-4 rounded-[20px] border border-white/10 p-5">
                                <p className="text-[14px] font-bold">{t('dial.ledger')}</p>
                                <ul className="mt-3 space-y-2">
                                    {list<{ who: string; what: string; when: string }>('dial.rows').map((r) => (
                                        <li key={r.who} className="flex items-baseline justify-between gap-4 text-[14px]">
                                            <span><span className="font-bold">{r.who}</span> <span className="text-white/70">{r.what}</span></span>
                                            <span className="shrink-0 tabular-nums text-white/55">{r.when}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ── What's inside ── */}
                <section className="mx-auto max-w-[1440px] px-4 py-24 sm:px-8 lg:py-32">
                    <h2 className="hl-heavy text-[15vw] sm:text-[10vw] lg:text-[7.5rem]">{t('inside.title')}</h2>
                    <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {list<{ name: string; body: string }>('inside.items').map((it, i) => (
                            <li key={it.name} className={cn('flex min-h-[240px] flex-col justify-end rounded-[22px] p-7 transition-transform duration-500 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] hover:-rotate-[1.5deg] hover:scale-[1.02]', tiles[i])}>
                                <span className="block text-[30px] font-extrabold leading-tight tracking-[-0.03em]">{it.name}</span>
                                <span className="mt-2 block max-w-[340px] text-[15px] leading-7 opacity-85">{it.body}</span>
                            </li>
                        ))}
                    </ul>
                </section>

                {/* ── Double marquee ── */}
                <section aria-label={t('works.title')} className="hl-marquee-wrap overflow-hidden py-10">
                    {(['a', 'b'] as const).map((row) => (
                        <div key={row} className={cn('py-4', row === 'a' ? '-rotate-2 bg-[#234a36] text-white' : 'rotate-[1.5deg] bg-[#f3d9b8] text-[#1f2a24]')}>
                            <div className={cn('hl-marquee', row === 'b' && 'hl-marquee--reverse')}>
                                {[0, 1].map((copy) => (
                                    <div key={copy} className="flex shrink-0 items-center" aria-hidden={copy === 1}>
                                        {list<string>(`marquee.${row}`).map((w) => (
                                            <span key={w} className="flex items-center whitespace-nowrap text-[34px] font-extrabold tracking-[-0.03em] sm:text-[52px]">
                                                <span className="px-6">{w}</span><Sparkle className="h-7 w-7 shrink-0 sm:h-9 sm:w-9" />
                                            </span>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </section>

                {/* ── FAQ ── */}
                <section id="faq" className="mx-auto grid max-w-[1440px] gap-12 px-4 py-24 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:py-32">
                    <h2 className="hl-heavy text-[13vw] sm:text-[8vw] lg:text-[6rem]">{t('faq.title')}</h2>
                    <div className="divide-y divide-[#ddd5c6] border-y border-[#ddd5c6]">
                        {list<{ q: string; a: string }>('faq.items').map((f) => (
                            <details key={f.q} className="group py-6">
                                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[19px] font-bold tracking-[-0.01em] focus:outline-none focus-visible:underline [&::-webkit-details-marker]:hidden">
                                    {f.q}
                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#234a36] text-white transition-transform duration-300 group-open:rotate-45 motion-reduce:transition-none"><Plus className="h-4 w-4" aria-hidden="true" /></span>
                                </summary>
                                <p className="mt-3 max-w-[620px] text-[16px] leading-7 text-[#4a554e]">{f.a}</p>
                            </details>
                        ))}
                    </div>
                </section>
            </main>

            {/* ── Footer: dark block ── */}
            <footer className="px-2 pb-2 sm:px-3 sm:pb-3">
                <div className="relative overflow-hidden rounded-[22px] bg-[#14231b] px-6 pb-6 pt-16 text-white sm:rounded-[28px] sm:px-12 lg:px-20">
                    <div className="grid gap-12 md:grid-cols-3">
                        <div>
                            <span className="inline-block rounded-full bg-white px-3.5 py-1.5 text-[14px] font-semibold text-[#14231b]">{t('foot.openLabel')}</span>
                            <a href="https://github.com/Aaditya1273/Hearth" target="_blank" rel="noopener noreferrer" className="mt-4 flex items-center gap-2 text-[28px] font-extrabold tracking-[-0.03em] hover:text-[#f0b796]">
                                {t('foot.openTitle')}<ArrowUpRight className="h-6 w-6" aria-hidden="true" />
                            </a>
                            <a href="https://github.com/NexaFlowFrance/OpenCare" target="_blank" rel="noopener noreferrer" className="mt-3 block text-[14px] text-white/60 underline-offset-2 hover:underline">{t('foot.attribution')}</a>
                        </div>
                        <div>
                            <span className="inline-block rounded-full bg-white px-3.5 py-1.5 text-[14px] font-semibold text-[#14231b]">{t('foot.tryLabel')}</span>
                            <Link to="/login" className="mt-4 flex items-center gap-2 text-[28px] font-extrabold tracking-[-0.03em] hover:text-[#f0b796]">{t('foot.tryTitle')}<ArrowRight className="h-6 w-6" aria-hidden="true" /></Link>
                            {DEMO_LOGIN && <p className="mt-3 font-mono text-[13px] text-white/75">{DEMO_LOGIN}</p>}
                            <p className="mt-2 text-[14px] text-white/60">{t('foot.tryNote')}</p>
                        </div>
                        <div>
                            <span className="inline-block rounded-full bg-white px-3.5 py-1.5 text-[14px] font-semibold text-[#14231b]">{t('foot.honestLabel')}</span>
                            <p className="mt-4 text-[28px] font-extrabold leading-tight tracking-[-0.03em]">{t('foot.honestTitle')}</p>
                            <p className="mt-3 text-[14px] text-white/60">{t('foot.honestNote')}</p>
                        </div>
                    </div>
                    {/* Wordmark: an SVG text fitted to the width, so it is one line at every size. */}
                    <svg aria-hidden="true" viewBox="0 0 1000 205" className="mt-16 block w-full select-none">
                        <text x="500" y="182" textAnchor="middle" textLength="990" lengthAdjust="spacingAndGlyphs" fill="rgba(255,255,255,0.07)"
                            style={{ fontFamily: 'Epilogue, sans-serif', fontWeight: 900, fontSize: 250 }}>hearth</text>
                    </svg>
                </div>
            </footer>
        </div>
    );
};

export default Landing;
