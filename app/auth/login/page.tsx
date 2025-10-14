'use client';

import { useEffect, useMemo, useState } from 'react';
import NextImage from 'next/image';
import { useRouter } from 'next/navigation';
import { supabase } from '@/supabase/client';

// === Types ===
type LicenseStatus = 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED';

// === Local storage key ===
const LS_KEY = 'ho_recent_emails';

// === Brand tokens (from logo)
const SPACE = {
    bgDeep: '#0B1020',
    nebula1: '#1a1240',
    nebula2: '#0d1847',
    glowViolet: '#7C3AED',
    glowBlue: '#3B82F6',
} as const;

// === Helpers ===
async function fetchLicenseStatus(bearer: string): Promise<LicenseStatus> {
    const res = await fetch('/api/license/status', {
        method: 'GET',
        headers: { authorization: `Bearer ${bearer}` },
        cache: 'no-store',
    });
    if (!res.ok) return 'SUSPENDED';
    const json = (await res.json()) as { status?: LicenseStatus };
    return json.status ?? 'SUSPENDED';
}

async function isPlatformAdmin(): Promise<boolean> {
    const { data, error } = await supabase.rpc('get_effective_level');
    if (error) return false;
    const lvl = typeof data === 'string' ? data : '';
    return lvl === '1_ADMIN';
}

function hexToRgba(hex: string, alpha = 1): string {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const bigint = parseInt(full, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ---- Extract a dominant/background color from an image (client-side)
function useImageBgColor(src: string, fallback = SPACE.bgDeep): string {
    const [color, setColor] = useState<string>(fallback);
    useEffect(() => {
        let cancelled = false;
        const img = typeof window !== 'undefined' ? new window.Image() : null;
        if (!img) return;
        img.crossOrigin = 'anonymous';
        img.src = src;
        img.decoding = 'async';
        img.onload = () => {
            try {
                const w = 24;
                const h = 24;
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;
                ctx.drawImage(img, 0, 0, w, h);
                const { data } = ctx.getImageData(0, 0, w, h);
                let r = 0;
                let g = 0;
                let b = 0;
                let n = 0;
                for (let i = 0; i < data.length; i += 4) {
                    const a = data[i + 3];
                    if (a === 0) continue;
                    r += data[i];
                    g += data[i + 1];
                    b += data[i + 2];
                    n++;
                }
                if (n > 0) {
                    const rr = Math.round(r / n);
                    const gg = Math.round(g / n);
                    const bb = Math.round(b / n);
                    const toHex = (v: number) => v.toString(16).padStart(2, '0');
                    const hex = `#${toHex(rr)}${toHex(gg)}${toHex(bb)}`.toUpperCase();
                    if (!cancelled) setColor(hex);
                }
            } catch {
                // keep fallback
            }
        };
        return () => {
            cancelled = true;
        };
    }, [src, fallback]);
    return color;
}

function BigLogo() {
    return (
        <div
            className="relative mx-auto h-36 w-36 sm:h-44 sm:w-44 drop-shadow-[0_0_25px_rgba(124,58,237,0.45)]"
            aria-label="HomeOrbit"
        >
            <NextImage src="/logo.png" alt="HomeOrbit" fill sizes="176px" className="object-contain" priority />
        </div>
    );
}

export default function LoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState<string>('');
    const [recentEmails, setRecentEmails] = useState<string[]>([]);
    const [password, setPassword] = useState<string>('');
    const [showPw, setShowPw] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    const year = useMemo(() => new Date().getFullYear(), []);
    const logoBg = useImageBgColor('/logo.png', SPACE.bgDeep);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw) as unknown;
                if (Array.isArray(parsed)) setRecentEmails(parsed.slice(0, 5));
            }
        } catch {
            // ignore
        }
    }, []);

    function saveEmailToHistory(addr: string): void {
        try {
            const raw = localStorage.getItem(LS_KEY);
            const arr: string[] = raw ? ((JSON.parse(raw) as string[]) || []) : [];
            const next = [addr, ...arr.filter((e) => e !== addr)].slice(0, 5);
            localStorage.setItem(LS_KEY, JSON.stringify(next));
            setRecentEmails(next);
        } catch {
            // ignore
        }
    }

    const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
            setLoading(false);
            setError(signInError.message);
            return;
        }

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) {
            await supabase.auth.signOut();
            setLoading(false);
            setError('Could not verify your subscription. Please try again.');
            return;
        }

        const admin = await isPlatformAdmin();
        if (!admin) {
            const status = await fetchLicenseStatus(token);
            if (status === 'SUSPENDED' || status === 'CANCELLED') {
                await supabase.auth.signOut();
                setLoading(false);
                setError(
                    status === 'SUSPENDED'
                        ? 'Your account is currently suspended due to missed payment. Please contact your admin to resolve billing.'
                        : 'This subscription has been cancelled. Please contact your admin to reactivate.',
                );
                return;
            }
        }

        saveEmailToHistory(email.trim());
        setLoading(false);
        router.push('/dashboard');
    };

    // Build the background once we have the logo color
    const bgStyle = {
        backgroundImage: [
            `radial-gradient(90rem 60rem at -10% -20%, ${hexToRgba(logoBg, 0.65)} 0%, rgba(0,0,0,0) 55%)`,
            `radial-gradient(70rem 40rem at 120% -10%, ${hexToRgba(logoBg, 0.35)} 0%, rgba(0,0,0,0) 60%)`,
            `linear-gradient(180deg, ${logoBg} 0%, #060913 100%)`,
        ].join(', '),
    } as const;

    return (
        <div className="relative min-h-svh lg:min-h-screen bg-[#060913]">
            {/* Fixed, full-viewport background to avoid white tails on scroll */}
            <div className="fixed inset-0 -z-10" style={bgStyle} aria-hidden />

            {/* Content */}
            <div className="relative grid grid-cols-1 lg:grid-cols-2">
                {/* ===== Left: Hero with big logo ===== */}
                <aside className="relative hidden lg:flex items-center justify-center overflow-hidden">
                    {/* star field */}
                    <div
                        className="absolute inset-0 opacity-60"
                        style={{
                            backgroundImage:
                                'radial-gradient(1px 1px at 10% 20%, rgba(255,255,255,0.35) 0, rgba(255,255,255,0) 60%), radial-gradient(1px 1px at 40% 80%, rgba(255,255,255,0.25) 0, rgba(255,255,255,0) 60%), radial-gradient(1px 1px at 80% 30%, rgba(255,255,255,0.25) 0, rgba(255,255,255,0) 60%)',
                        }}
                    />
                    <div className="relative z-[1] w-full max-w-2xl px-12 py-16 text-center text-white transform-gpu will-change-transform md:translate-y-6 lg:translate-y-10 xl:translate-y-14">
                        <div className="relative mx-auto">
                            <div
                                className="absolute -inset-8 rounded-[2rem] blur-3xl"
                                style={{
                                    background: `radial-gradient(circle, ${hexToRgba(SPACE.glowViolet, 0.35)} 0%, rgba(0,0,0,0) 60%)`,
                                }}
                            />
                            <BigLogo />
                        </div>
                        <h1 className="mt-6 text-5xl font-semibold tracking-tight">HomeOrbit</h1>
                        <p className="mt-2 text-sm text-white/80">Operations & workforce platform</p>
                        <h2 className="mt-10 text-3xl font-semibold leading-tight tracking-tight">
                            Everything you need to run your homes — all in one place.
                        </h2>
                        <p className="mt-4 text-white/85">
                            Rotas, timesheets, training, budgets and people — in one secure, role-aware workspace.
                        </p>
                        <ul className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-3 text-white/95">
                            {[
                                'Role-based access ensuring GDPR compliance',
                                'Realtime updates with audit trails',
                                'Secure sign-in powered by Supabase',
                                'Server security powered by Vercel',
                            ].map((text) => (
                                <li key={text} className="flex items-start gap-3 rounded-xl bg-white/5 ring-1 ring-white/10 px-3 py-2.5">
                                    <span className="mt-0.5 inline-flex rounded-md bg-white/15 p-1.5 ring-1 ring-white/25">
                                        <svg width="16" height="16" viewBox="0 0 24 24">
                                            <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19l12-12-1.41-1.41z" />
                                        </svg>
                                    </span>
                                    <span className="text-[13px] leading-5">{text}</span>
                                </li>
                            ))}
                        </ul>
                        <p className="mt-8 text-xs text-white/70">© {year} HomeOrbit</p>
                    </div>
                </aside>

                {/* ===== Right: Auth card (dark glass) ===== */}
                <main className="relative flex items-center justify-center py-12 px-6">
                    <div className="w-full max-w-md transform-gpu will-change-transform md:translate-y-6 lg:translate-y-10 xl:translate-y-14">
                        {/* Mobile hero */}
                        <div className="mb-6 lg:hidden text-center text-white">
                            <BigLogo />
                            <h1 className="mt-4 text-3xl font-semibold tracking-tight">HomeOrbit</h1>
                            <p className="mt-1 text-xs text-white/75">Operations & workforce platform</p>
                        </div>

                        <div className="relative rounded-2xl bg-white/5 backdrop-blur-md p-7 shadow-2xl ring-1 ring-white/10 text-white">
                            <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-white/10" />

                            {error && (
                                <div
                                    className="mb-4 rounded-lg border border-red-200/60 bg-red-50/90 px-4 py-3 text-[13px] text-red-800"
                                    role="alert"
                                    aria-live="polite"
                                >
                                    {error}
                                </div>
                            )}

                            <div className="hidden lg:block mb-4">
                                <h2 className="text-[18px] font-semibold tracking-tight">Welcome back</h2>
                                <p className="mt-0.5 text-[13px] text-white/70">Use your work email to sign in</p>
                            </div>

                            <form onSubmit={handleLogin} className="space-y-4.5" autoComplete="on" noValidate>
                                {/* Email */}
                                <div>
                                    <label htmlFor="email" className="block text-[13px] font-medium text-white/95 mb-1">
                                        Email
                                    </label>
                                    <div className="relative">
                                        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-white/70">
                                            <svg width="18" height="18" viewBox="0 0 24 24" className="opacity-70">
                                                <path
                                                    fill="currentColor"
                                                    d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 4l-8 5L4 8V6l8 5l8-5z"
                                                />
                                            </svg>
                                        </span>
                                        <input
                                            id="email"
                                            name="username"
                                            type="email"
                                            inputMode="email"
                                            autoCapitalize="none"
                                            autoCorrect="off"
                                            autoComplete="username"
                                            list="recent-emails"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
                                            required
                                            placeholder="you@company.com"
                                            className="w-full rounded-xl border border-white/15 bg-white/10 pl-10 pr-3 py-2.5 text-[16px] sm:text-[15px] text-white placeholder:text-white/50 focus:ring-2 focus:ring-[rgba(99,102,241,0.7)] focus:outline-none caret-white"
                                        />
                                        <datalist id="recent-emails">
                                            {recentEmails.map((e) => (
                                                <option key={e} value={e} />
                                            ))}
                                        </datalist>
                                    </div>
                                </div>

                                {/* Password */}
                                <div>
                                    <label htmlFor="password" className="block text-[13px] font-medium text-white/95 mb-1">
                                        Password
                                    </label>
                                    <div className="relative">
                                        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-white/70">
                                            <svg width="18" height="18" viewBox="0 0 24 24" className="opacity-70">
                                                <path
                                                    fill="currentColor"
                                                    d="M12 17a2 2 0 1 0 0-4a2 2 0 0 0 0 4m6-6h-1V9a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2M9 9a3 3 0 0 1 6 0v2H9z"
                                                />
                                            </svg>
                                        </span>
                                        <input
                                            id="password"
                                            name="current-password"
                                            type={showPw ? 'text' : 'password'}
                                            autoComplete="current-password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            required
                                            placeholder="••••••••"
                                            className="w-full rounded-xl border border-white/15 bg-white/10 pl-10 pr-16 py-2.5 text-[16px] sm:text-[15px] text-white placeholder:text-white/50 focus:ring-2 focus:ring-[rgba(124,58,237,0.7)] focus:outline-none caret-white"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPw((s) => !s)}
                                            className="absolute inset-y-0 right-0 my-1 mr-2 inline-flex items-center rounded-lg border border-white/15 bg-white/10 px-2.5 text-[11px] font-medium text-white hover:bg-white/15"
                                            aria-label={showPw ? 'Hide password' : 'Show password'}
                                            aria-pressed={showPw}
                                        >
                                            {showPw ? 'Hide' : 'Show'}
                                        </button>
                                    </div>
                                    <p className="mt-1.5 text-[11px] text-white/60">
                                        Use your account password. Contact your admin if you’ve forgotten it.
                                    </p>
                                </div>

                                <div className="flex items-center justify-between">
                                    <a className="text-[13px] font-medium text-white hover:underline underline-offset-2" href="#">
                                        Forgot password?
                                    </a>
                                </div>

                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full rounded-xl bg-gradient-to-r from-[#7C3AED] via-[#6366F1] to-[#3B82F6] py-2.5 text-[15px] font-semibold text-white shadow-[0_10px_25px_rgba(79,70,229,0.35)] hover:brightness-110 focus:ring-2 focus:ring-[rgba(99,102,241,0.6)] disabled:opacity-70 transition"
                                >
                                    {loading ? 'Checking access…' : 'Sign in'}
                                </button>
                            </form>

                            <div className="mt-6 text-center">
                                <p className="text-[12px] text-white/70">
                                    No public sign-ups. Ask an administrator to create your account.
                                </p>
                            </div>
                        </div>

                        <p className="mt-8 text-center text-[11px] text-white/60">
                            © {year} HomeOrbit • All rights reserved
                        </p>
                    </div>

                    {/* global background accents for the right side */}
                    <div
                        className="pointer-events-none absolute -z-[1] right-[-10%] top-[-10%] h-64 w-64 rounded-full blur-3xl"
                        style={{
                            background: `radial-gradient(circle, ${hexToRgba(SPACE.glowViolet, 0.35)} 0%, rgba(0,0,0,0) 60%)`,
                        }}
                        aria-hidden
                    />
                    <div
                        className="pointer-events-none absolute -z-[1] left-[-10%] bottom-[-12%] h-72 w-72 rounded-full blur-3xl"
                        style={{
                            background: `radial-gradient(circle, ${hexToRgba(SPACE.glowBlue, 0.3)} 0%, rgba(0,0,0,0) 60%)`,
                        }}
                        aria-hidden
                    />
                </main>
            </div>
        </div>
    );
}
