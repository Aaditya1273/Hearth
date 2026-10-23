import React from 'react';

/**
 * Hand-drawn stickers for the landing page. Each is an ink line drawing on a
 * soft fill, with a thick paper-coloured outline so it reads as a sticker
 * when it overlaps type or photos. Decorative: aria-hidden.
 */

type P = { className?: string; style?: React.CSSProperties };
const INK = '#1f2a24';
const sticker = { stroke: '#fffaf2', strokeWidth: 14, strokeLinejoin: 'round' as const, paintOrder: 'stroke' as const };

export const HeartSticker: React.FC<P> = ({ className, style }) => (
    <svg viewBox="0 0 120 120" className={className} style={style} aria-hidden="true">
        <path d="M60 100 C 20 74, 10 52, 22 34 C 33 18, 52 22, 60 38 C 68 22, 88 18, 98 34 C 110 52, 100 74, 60 100 Z" fill="#e8806b" {...sticker} />
        <path d="M60 100 C 20 74, 10 52, 22 34 C 33 18, 52 22, 60 38 C 68 22, 88 18, 98 34 C 110 52, 100 74, 60 100 Z" fill="none" stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
        <path d="M36 44 C 38 38, 43 35, 48 36" fill="none" stroke="#fffaf2" strokeWidth={4} strokeLinecap="round" />
    </svg>
);

export const DoorSticker: React.FC<P> = ({ className, style }) => (
    <svg viewBox="0 0 120 140" className={className} style={style} aria-hidden="true">
        <path d="M24 128 L24 30 C 24 18, 34 12, 60 12 C 86 12, 96 18, 96 30 L96 128 Z" fill="#f3d9b8" {...sticker} />
        <path d="M24 128 L24 30 C 24 18, 34 12, 60 12 C 86 12, 96 18, 96 30 L96 128" fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M38 128 L38 36 C 38 30, 44 27, 60 27 C 76 27, 82 30, 82 36 L82 128" fill="#fffaf2" stroke={INK} strokeWidth={3} strokeLinejoin="round" />
        <circle cx="72" cy="80" r="4" fill={INK} />
        <path d="M14 128 L106 128" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
        <path d="M60 4 L60 -2 M44 8 L40 2 M76 8 L80 2" stroke="#e8806b" strokeWidth={3.5} strokeLinecap="round" />
    </svg>
);

export const CupSticker: React.FC<P> = ({ className, style }) => (
    <svg viewBox="0 0 140 130" className={className} style={style} aria-hidden="true">
        <path d="M22 50 L104 50 L98 104 C 96 116, 86 120, 63 120 C 40 120, 30 116, 28 104 Z" fill="#cfe0d4" {...sticker} />
        <path d="M22 50 L104 50 L98 104 C 96 116, 86 120, 63 120 C 40 120, 30 116, 28 104 Z" fill="none" stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
        <path d="M103 62 C 122 60, 124 86, 99 88" fill="none" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />
        <path d="M48 38 C 40 28, 56 22, 48 10 M66 38 C 58 28, 74 22, 66 10 M84 38 C 76 28, 92 22, 84 10" fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
        <path d="M44 74 C 52 84, 74 84, 82 74" fill="none" stroke="#2e5e45" strokeWidth={3.5} strokeLinecap="round" />
    </svg>
);

export const Sparkle: React.FC<P> = ({ className, style }) => (
    <svg viewBox="0 0 60 60" className={className} style={style} aria-hidden="true">
        <path d="M30 2 C 32 20, 40 28, 58 30 C 40 32, 32 40, 30 58 C 28 40, 20 32, 2 30 C 20 28, 28 20, 30 2 Z" fill="#f0b796" />
    </svg>
);

/** A loose loop-and-arrow, drawn on scroll (the path has pathLength=1). */
export const LoopArrow: React.FC<P & { pathClassName?: string }> = ({ className, style, pathClassName }) => (
    <svg viewBox="0 0 360 140" fill="none" className={className} style={style} aria-hidden="true">
        <path className={pathClassName} pathLength={1} d="M4 110 C 60 40, 150 30, 170 70 C 190 110, 130 130, 120 96 C 110 60, 190 30, 250 60 C 290 80, 320 90, 348 56" stroke={INK} strokeWidth={3} strokeLinecap="round" />
        <path className={pathClassName} pathLength={1} d="M326 52 L350 54 L344 78" stroke={INK} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
);

/** Organic blob behind the photo cards. */
export const Blob: React.FC<P & { fill?: string }> = ({ className, style, fill = '#2e5e45' }) => (
    <svg viewBox="0 0 400 400" className={className} style={style} aria-hidden="true">
        <path fill={fill} d="M312 66 C 362 104, 392 170, 372 232 C 352 294, 300 352, 230 370 C 160 388, 86 360, 50 300 C 14 240, 20 160, 60 104 C 100 48, 168 18, 226 24 C 262 28, 286 46, 312 66 Z" />
    </svg>
);

/** Hand-drawn underline. */
export const Scribble: React.FC<P & { pathClassName?: string }> = ({ className, style, pathClassName }) => (
    <svg viewBox="0 0 300 24" fill="none" preserveAspectRatio="none" className={className} style={style} aria-hidden="true">
        <path className={pathClassName} pathLength={1} d="M4 16 C 70 6, 150 4, 296 10 M30 21 C 110 14, 190 14, 260 17" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
    </svg>
);
