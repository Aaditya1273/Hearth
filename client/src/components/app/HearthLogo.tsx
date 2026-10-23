import React from 'react';
import { cn } from '../../lib/utils';

/** Hearth mark: a house outline with a warm heart inside. */
export const HearthMark: React.FC<{ className?: string; stroke?: string; heart?: string }> = ({ className, stroke = '#234a36', heart = '#c0673f' }) => (
    <svg viewBox="0 0 48 48" className={cn('h-9 w-9', className)} aria-hidden="true" fill="none">
        <path d="M6 22.5 24 7l18 15.5" stroke={stroke} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M11 19v19.5a2.5 2.5 0 0 0 2.5 2.5h21a2.5 2.5 0 0 0 2.5-2.5V19" stroke={stroke} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M24 35.5s-8-4.7-8-10.2a4.4 4.4 0 0 1 8-2.6 4.4 4.4 0 0 1 8 2.6c0 5.5-8 10.2-8 10.2Z" fill={heart} />
    </svg>
);

/** Mark + wordmark, as in the site header. */
const HearthLogo: React.FC<{ className?: string; light?: boolean }> = ({ className, light = false }) => (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
        <HearthMark stroke={light ? '#ffffff' : '#234a36'} heart={light ? '#e8a07a' : '#c0673f'} />
        <span className={cn('font-display text-[26px] font-semibold leading-none tracking-[-0.01em]', light ? 'text-white' : 'text-[#1f2a24]')} style={{ fontVariationSettings: '"opsz" 72' }}>
            Hearth
        </span>
    </span>
);

export default HearthLogo;
