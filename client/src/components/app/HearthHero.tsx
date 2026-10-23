import React from 'react';
import { cn } from '../../lib/utils';

/**
 * Hearth hero: the living-room photograph (client/public/hearth, generated
 * from hero.png) with a forest-green gradient on the reading side so white
 * text keeps WCAG AA contrast over the bright window. Decorative: alt="".
 */

const base = `${import.meta.env.BASE_URL}hearth/`;

export const HeroPicture: React.FC<{ className?: string; position?: string }> = ({ className, position = '60% 45%' }) => (
    <picture>
        <source type="image/webp" srcSet={`${base}hero-1200.webp 1200w, ${base}hero-1920.webp 1920w`} sizes="(min-width: 1024px) 1200px, 100vw" />
        <img
            src={`${base}hero-1200.jpg`}
            srcSet={`${base}hero-1200.jpg 1200w, ${base}hero-1920.jpg 1920w`}
            sizes="(min-width: 1024px) 1200px, 100vw"
            alt=""
            className={cn('absolute inset-0 h-full w-full object-cover', className)}
            style={{ objectPosition: position }}
            fetchPriority="high"
            decoding="async"
        />
    </picture>
);

interface HeroProps {
    children: React.ReactNode;
    className?: string;
    position?: string;
}

/** Rounded hero band for the family dashboard. */
const HearthHero: React.FC<HeroProps> = ({ children, className, position }) => (
    <section data-hero className={cn('relative isolate overflow-hidden rounded-[20px] bg-[#1d3328] shadow-surface', className)}>
        <HeroPicture position={position} />
        {/* Reading side: dark forest on the left (wide screens), from the bottom on phones. */}
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#14231b]/95 via-[#14231b]/70 to-[#14231b]/20 md:bg-gradient-to-r md:from-[#14231b]/92 md:via-[#14231b]/60 md:to-transparent" />
        <div className="relative z-10 flex min-h-[340px] flex-col justify-end p-6 sm:p-8 md:min-h-[380px] md:max-w-[640px] md:justify-center lg:p-10">
            {children}
        </div>
    </section>
);

export default HearthHero;

/**
 * Left half of the sign-in screens: the photograph, the promise, and the
 * three commitments. A short banner on phones, full height on large screens.
 */
export const AuthHeroPanel: React.FC = () => (
    <aside className="relative isolate flex h-[240px] flex-col justify-end overflow-hidden bg-[#1d3328] p-6 text-white sm:h-[280px] lg:h-auto lg:min-h-screen lg:p-12">
        <HeroPicture position="62% 50%" />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-[#14231b]/95 via-[#14231b]/55 to-[#14231b]/10 lg:bg-gradient-to-tr lg:from-[#14231b]/95 lg:via-[#14231b]/60 lg:to-[#14231b]/5" />
        <div className="relative z-10 max-w-lg">
            <p className="flex items-center gap-2.5 text-body font-semibold">
                <img src={`${base.replace(/hearth\/$/, '')}hearth-mark.svg`} alt="" className="h-8 w-8" />
                Hearth
            </p>
            <p className="mt-4 font-display text-[26px] font-medium leading-tight sm:text-[32px] lg:mt-6 lg:text-[44px]" style={{ fontVariationSettings: '"opsz" 120' }}>
                Know that Mom had a normal day. Let Mom decide what the family gets to know.
            </p>
            <ul className="mt-8 hidden space-y-3 text-body text-white/90 lg:block">
                <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#d9a441]" aria-hidden="true" />No cameras. Home sensors only, explained in plain words.</li>
                <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#d9a441]" aria-hidden="true" />The parent chooses what is shared, and sees who looked.</li>
                <li className="flex gap-3"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#d9a441]" aria-hidden="true" />Nothing is changed for the family without someone saying yes.</li>
            </ul>
        </div>
    </aside>
);
