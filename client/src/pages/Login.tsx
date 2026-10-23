import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { HeartHandshake, AlertCircle, Sparkles } from 'lucide-react';
import { cn } from '../lib/utils';
import './landing.css';

const BASE = import.meta.env.BASE_URL;
// "email · password" of the public demo account, set only on the demo deployment.
const DEMO = (import.meta.env.VITE_DEMO_LOGIN as string | undefined)?.split(' · ');

// Each clip carries an example status of the kind Hearth gives (illustrative, not real data).
const CLIPS = [
    { src: 'login/v1.mp4', poster: 'login/v1.jpg', v: 'A normal day', k: 'bg-[#7fd39b] text-[#14231b]', line: 'Day started at 7:42 · front door at 9:12', why: 'Compared with 12 days of her usual mornings' },
    { src: 'login/v2.mp4', poster: 'login/v2.jpg', v: 'Worth a look', k: 'bg-[#e8806b] text-[#14231b]', line: 'No activity yet. She is usually up by 9:02.', why: 'Suggested next step: give Margaret a call' },
    { src: 'login/v3.mp4', poster: 'login/v3.jpg', v: 'Not enough data', k: 'bg-black/40 text-white ring-1 ring-inset ring-white/60 backdrop-blur', line: '4 of 7 active days so far', why: 'Hearth will not call anything normal until it knows her routine' },
];
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Public preview of an invite, used for the "you will join X's circle" banner.
interface InviteInfo {
    role: string;
    circle_name: string;
    recipient_first_name: string | null;
    inviter_name: string | null;
}

const Login: React.FC = () => {
    const { t } = useTranslation(['auth', 'common', 'nav']);
    const { login, register } = useAuth();
    const navigate = useNavigate();
    const registrationEnabled = import.meta.env.VITE_REGISTRATION_ENABLED !== 'false';
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [inviteToken, setInviteToken] = useState<string | null>(null);
    const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null);
    const [inviteInvalid, setInviteInvalid] = useState(false);
    const [clip, setClip] = useState(0);
    const [leaving, setLeaving] = useState(false);
    const [paused, setPaused] = useState(false);
    const vids = useRef<(HTMLVideoElement | null)[]>([]);
    const still = reducedMotion();

    // Play only the clip on screen; the next one is already loaded underneath.
    useEffect(() => {
        if (still) return;
        vids.current.forEach((v, j) => {
            if (!v) return;
            if (j === clip && !paused) v.play().catch(() => {}); else v.pause();
        });
    }, [clip, paused, still]);
    const nextClip = () => {
        setLeaving(false);
        setClip((c) => (c + 1) % CLIPS.length);
        const v = vids.current[(clip + 1) % CLIPS.length];
        if (v) v.currentTime = 0;
    };
    const c = CLIPS[clip];

    // Detect an invite token in the URL (?invite=... or ?token=..., the latter
    // being the /join link format) and auto-switch to registration mode.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const invite = params.get('invite') ?? params.get('token');
        // "Get Started" on the landing page opens the sign-up form.
        if (params.get('mode') === 'register' && registrationEnabled) setIsLogin(false);
        if (invite) {
            setInviteToken(invite);
            setIsLogin(false);
        }
    }, []);

    // Public invite preview: show whose circle will be joined.
    useEffect(() => {
        if (!inviteToken) return;
        let mounted = true;
        api.get<{ success: boolean; data: InviteInfo }>(`/api/invites/info/${inviteToken}`)
            .then((res) => {
                if (!mounted) return;
                if (res.success && res.data) {
                    setInviteInfo(res.data);
                } else {
                    setInviteInvalid(true);
                }
            })
            .catch(() => {
                if (mounted) setInviteInvalid(true);
            });
        return () => {
            mounted = false;
        };
    }, [inviteToken]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (isLogin) {
                await login(email, password);
                // An existing account accepts the invitation on the /join page.
                if (inviteToken) {
                    navigate(`/join?token=${inviteToken}`, { replace: true });
                }
            } else {
                // The circle role is decided server-side: it comes from the invite.
                // Without an invite the account starts without a circle (onboarding).
                await register(email, password, name, inviteToken ?? undefined);
                if (inviteToken) {
                    // The invite is consumed during registration: land on the dashboard.
                    navigate('/', { replace: true });
                }
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : t('common:states.error'));
        } finally {
            setLoading(false);
        }
    };

    const circleName = inviteInfo?.recipient_first_name || inviteInfo?.circle_name || '';

    const field = 'mt-1.5 h-12 w-full rounded-[12px] border border-white/10 bg-white/[0.06] px-4 text-[15px] text-[#f2ede4] placeholder:text-white/35 transition-colors focus:border-[#f0b796] focus:outline-none focus:ring-2 focus:ring-[#f0b796]/30';
    const label = 'block text-[13px] font-semibold text-white/75';

    return (
        <main className="hl grid min-h-screen gap-4 bg-[#14231b] p-3 text-[#f2ede4] sm:p-5 lg:grid-cols-2 lg:gap-8 lg:p-8">
            {/* Left: the way in */}
            <section className="relative flex flex-col items-center justify-center px-2 pb-10 pt-20 sm:px-4">
                <Link to="/" className="absolute left-2 top-1 flex items-center gap-2.5 text-[21px] font-extrabold tracking-[-0.04em] sm:left-4">
                    <img src={`${BASE}hearth-mark.svg`} alt="" className="h-8 w-8" />Hearth
                </Link>

                <h1 className="hl-serif max-w-[13ch] text-center text-[44px] leading-[1.04] sm:text-[56px] lg:text-[64px]">
                    {isLogin ? 'Welcome home.' : 'Start with one normal day.'}
                </h1>
                <p className="mt-3 max-w-[36ch] text-center text-[17px] leading-7 text-[#b8c2ba]">{t('auth:tagline')}</p>

                <div className="mt-9 w-full max-w-[440px] rounded-[26px] border border-white/10 bg-white/[0.03] p-6 sm:p-7">
                    {inviteToken && inviteInfo && (
                        <div className="mb-5 flex items-start gap-3 rounded-[12px] border border-white/10 bg-white/[0.06] p-3">
                            <HeartHandshake className="mt-0.5 h-5 w-5 shrink-0 text-[#f0b796]" />
                            <div>
                                <p className="text-[14px] font-semibold">{t('auth:invite.joinCircle', { name: circleName })}</p>
                                <p className="mt-0.5 text-[12.5px] text-white/65">
                                    {t('auth:invite.invitedBy', {
                                        name: inviteInfo.inviter_name || t('auth:invite.someone'),
                                        role: t(`nav:roles.${inviteInfo.role}`, { defaultValue: inviteInfo.role }),
                                    })}
                                </p>
                            </div>
                        </div>
                    )}
                    {inviteToken && inviteInvalid && (
                        <div className="mb-5 flex items-start gap-3 rounded-[12px] border border-[#e8806b]/40 bg-[#e8806b]/10 p-3">
                            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#f0a08f]" />
                            <p className="text-[14px] text-[#f6c3b8]">{t('auth:invite.invalid')}</p>
                        </div>
                    )}

                    {DEMO && isLogin && (
                        <button type="button" onClick={() => { setEmail(DEMO[0]); setPassword(DEMO[1] ?? ''); }}
                            className="mb-5 flex w-full items-center justify-center gap-2 rounded-[12px] border border-white/10 bg-white/[0.08] px-4 py-3 text-[14px] font-semibold transition-colors hover:bg-white/[0.14] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f0b796]">
                            <Sparkles className="h-4 w-4 text-[#f0b796]" aria-hidden="true" />Use the demo family ({DEMO[0]})
                        </button>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {!isLogin && (
                            <label className={label}>{t('auth:fields.fullName')}
                                <input type="text" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" placeholder={t('auth:fields.fullNamePlaceholder')} className={field} />
                            </label>
                        )}
                        <label className={label}>{t('auth:fields.email')}
                            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder={t('auth:fields.emailPlaceholder')} className={field} />
                        </label>
                        <label className={label}>{t('auth:fields.password')}
                            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={isLogin ? 'current-password' : 'new-password'} placeholder="••••••••" className={field} />
                        </label>
                        {isLogin && (
                            <div className="text-right">
                                <button type="button" onClick={() => navigate('/forgot-password')} className="text-[13px] font-medium text-[#f0b796] underline-offset-4 hover:underline">{t('auth:login.forgot')}</button>
                            </div>
                        )}
                        {error && <p role="alert" className="rounded-[12px] border border-[#e8806b]/40 bg-[#e8806b]/10 p-3 text-center text-[14px] text-[#f6c3b8]">{error}</p>}
                        <button type="submit" disabled={loading}
                            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#f2ede4] text-[15px] font-bold text-[#14231b] transition-transform duration-300 [transition-timing-function:cubic-bezier(0.34,1.56,0.64,1)] hover:scale-[1.02] disabled:opacity-70 focus:outline-none focus-visible:ring-4 focus-visible:ring-[#f0b796]/40">
                            {loading ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-[#14231b]/30 border-t-[#14231b]" />{t('common:states.loading')}</>
                                : isLogin ? t('auth:login.submit') : t('auth:register.submit')}
                        </button>
                    </form>

                    {registrationEnabled && (
                        <button type="button" onClick={() => { setIsLogin(!isLogin); setError(''); }}
                            className="mt-6 block w-full border-t border-white/10 pt-5 text-center text-[14px] font-medium text-[#f0b796] underline-offset-4 hover:underline">
                            {isLogin ? t('auth:login.noAccount') : t('auth:login.haveAccount')}
                        </button>
                    )}
                </div>

                <p className="mt-8 max-w-[440px] text-center text-[12.5px] leading-6 text-white/50">
                    Hearth · built on <a href="https://github.com/NexaFlowFrance/OpenCare" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-white">OpenCare</a> by NexaFlow (AGPL-3.0) · {t('auth:footer')}
                </p>
            </section>

            {/* Right: calm clips, each with an example status */}
            <section aria-label="Example statuses of the kind Hearth gives" className="relative min-h-[420px] overflow-hidden rounded-[22px] bg-[#0c140f] max-lg:aspect-[4/5] max-lg:max-h-[70vh] lg:min-h-0">
                {CLIPS.map((cl, j) => still ? (
                    j === 0 && <img key={cl.src} src={`${BASE}${cl.poster}`} alt="" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                    <video key={cl.src} ref={(el) => { vids.current[j] = el; }} src={`${BASE}${cl.src}`} poster={`${BASE}${cl.poster}`}
                        muted playsInline preload={j === clip || j === (clip + 1) % CLIPS.length ? 'auto' : 'metadata'}
                        onEnded={j === clip ? nextClip : undefined}
                        onTimeUpdate={j === clip ? (e) => { const v = e.currentTarget; if (v.duration && v.duration - v.currentTime < 0.9) setLeaving(true); } : undefined}
                        className="absolute inset-0 h-full w-full object-cover transition-opacity duration-1000" style={{ opacity: j === clip ? 1 : 0 }} aria-hidden="true" />
                ))}
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(12,20,15,0.35)_0%,transparent_22%,transparent_50%,rgba(12,20,15,0.85)_100%)]" />
                <div key={clip} className={cn('hl-rise absolute inset-x-6 bottom-6 z-10', leaving && 'hl-leaving')}>
                    <span className={cn('inline-block rounded-full px-3 py-1.5 text-[13px] font-extrabold', c.k)}>{c.v}</span>
                    <p className="mt-3 text-[20px] font-bold leading-snug [text-shadow:0_1px_12px_rgba(0,0,0,0.5)] sm:text-[24px]">{c.line}</p>
                    <p className="mt-1 text-[14px] text-white/80 [text-shadow:0_1px_10px_rgba(0,0,0,0.5)]">{c.why}</p>
                    <p className="mt-3 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-white/55">Example</p>
                </div>
                {!still && (
                    <button type="button" onClick={() => setPaused((p) => !p)} aria-pressed={paused}
                        className="absolute right-4 top-4 z-10 rounded-full border border-white/30 bg-black/40 px-3.5 py-1.5 text-[13px] font-medium backdrop-blur hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f0b796]">
                        {paused ? 'Play clips' : 'Pause clips'}
                    </button>
                )}
            </section>
        </main>
    );
};

export default Login;
