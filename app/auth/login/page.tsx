'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { supabase } from '@/supabase/client';
import { useRouter } from 'next/navigation';

const LS_KEY = 'hch_recent_emails';

export default function LoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [recentEmails, setRecentEmails] = useState<string[]>([]);
    const [password, setPassword] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Load recent emails from localStorage (for datalist suggestions)
    useEffect(() => {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) setRecentEmails(parsed.slice(0, 5));
            }
        } catch { }
    }, []);

    // Save the successful email to localStorage (dedup, keep latest first)
    function saveEmailToHistory(addr: string) {
        try {
            const raw = localStorage.getItem(LS_KEY);
            const arr: string[] = raw ? (JSON.parse(raw) || []) : [];
            const next = [addr, ...arr.filter(e => e !== addr)].slice(0, 5);
            localStorage.setItem(LS_KEY, JSON.stringify(next));
            setRecentEmails(next);
        } catch { }
    }

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            setError(error.message);
        } else {
            saveEmailToHistory(email.trim());
            router.push('/dashboard');
        }
        setLoading(false);
    };

    return (
        <div className="min-h-screen flex bg-white">
            {/* ===== Left: Brand / Marketing Panel ===== */}
            <aside className="relative hidden lg:flex w-1/2 items-center justify-center overflow-hidden text-white bg-gradient-to-br from-indigo-700 via-violet-700 to-purple-600">
                {/* Soft decorative blobs */}
                <div className="pointer-events-none absolute -top-24 -right-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-28 -left-16 h-80 w-80 rounded-full bg-fuchsia-400/20 blur-3xl" />

                <div className="relative px-12 py-10 max-w-xl w-full">
                    {/* Brand chip (purple gradient, white ring so it doesn’t blend) */}
                    <div className="flex items-center gap-4">
                        <div className="relative w-16 h-16 lg:w-20 lg:h-20 overflow-hidden">
                            <Image
                                src="/logo.png"
                                alt="HomeCare Hub"
                                fill
                                sizes="(min-width:1024px) 80px, 64px"
                                className="object-contain"
                                priority
                            />
                        </div>
                        <div>
                            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">HomeCare Hub</h1>
                            <p className="text-sm text-white/80">Staff management platform</p>
                        </div>
                    </div>


                    {/* Hero copy */}
                    <div className="mt-8">
                        <h2 className="text-4xl font-semibold leading-tight tracking-tight">
                            Everything you need to run your homes - all in one place.
                        </h2>
                        <p className="mt-4 text-white/85">
                            Rotas, timesheets, training, budgets and people - in one secure, role-aware workspace.
                        </p>
                    </div>

                    {/* Feature bullets */}
                    <ul className="mt-8 space-y-4 text-white/95">
                        {[
                            'Role-based access ensuring GDPR compliance',
                            'Realtime updates with audit trails',
                            'Secure sign-in powered by Supabase',
                            'Server security powered by Vercel'
                        ].map((text) => (
                            <li key={text} className="flex items-start gap-3">
                                <span className="mt-1 inline-flex rounded-md bg-white/15 p-1.5 ring-1 ring-white/25">
                                    <svg width="16" height="16" viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19l12-12-1.41-1.41z" /></svg>
                                </span>
                                <span>{text}</span>
                            </li>
                        ))}
                    </ul>

                    {/* Testimonial / trust card */}
                    <div className="mt-10 rounded-2xl bg-white/10 p-5 backdrop-blur-sm ring-1 ring-white/20 shadow-lg">
                        <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-full bg-white/95 text-indigo-700 flex items-center justify-center text-sm font-bold">
                                ✓
                            </div>
                            <div>
                                <p className="text-sm leading-5">
                                    “Switching to HomeCare Hub made monthly oversight painless - everything’s in one place.”
                                </p>
                                <p className="mt-1 text-xs text-white/75">Registered Manager, North West</p>
                            </div>
                        </div>
                    </div>

                    <p className="mt-8 text-xs text-white/70">© {new Date().getFullYear()} HomeCare Hub</p>
                </div>
            </aside>

            {/* ===== Right: Auth Card ===== */}
            <main className="flex flex-1 items-center justify-center bg-gray-50">
                <div className="w-full max-w-md">
                    {/* Mobile header (refined typography) */}
                    <div className="mb-6 lg:hidden text-center">
                        <div className="mx-auto w-16 h-16 flex items-center justify-center rounded-2xl text-white text-2xl font-extrabold shadow-xl ring-2 ring-white bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-600">
                            HC
                        </div>
                        <h1 className="mt-3 text-[22px] font-semibold tracking-tight text-gray-900">HomeCare Hub</h1>
                        <p className="mt-1 text-[13px] text-gray-600">Sign in to continue</p>
                    </div>

                    {/* Auth card */}
                    <div className="relative rounded-2xl bg-white p-7 shadow-xl ring-1 ring-gray-900/5">
                        <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-indigo-500/5" />

                        {error && (
                            <div className="mb-4 rounded-lg border border-red-200/80 bg-red-50 px-4 py-3 text-[13px] text-red-700">
                                {error}
                            </div>
                        )}

                        {/* Subtle card title for desktop */}
                        <div className="hidden lg:block mb-4">
                            <h2 className="text-[18px] font-semibold tracking-tight text-gray-900">Welcome back</h2>
                            <p className="mt-0.5 text-[13px] text-gray-600">Use your work email to sign in</p>
                        </div>

                        {/* Enable browser autofill + local suggestions */}
                        <form onSubmit={handleLogin} className="space-y-4.5" autoComplete="on" noValidate>
                            {/* Email */}
                            <div>
                                <label htmlFor="email" className="block text-[13px] font-medium text-gray-800 mb-1">Email</label>
                                <div className="relative">
                                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                        <svg width="18" height="18" viewBox="0 0 24 24" className="opacity-40">
                                            <path fill="currentColor" d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 4l-8 5L4 8V6l8 5l8-5z" />
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
                                        className="
    w-full rounded-xl border border-gray-300/90 pl-10 pr-3 py-2.5
    text-[16px] sm:text-[15px]             /* prevent mobile zoom + fuzzy look */
    text-gray-900                          /* ensure strong text color */
    placeholder:text-gray-400
    bg-white                               /* avoid tinted bg on mobile */
    focus:ring-2 focus:ring-indigo-500 focus:outline-none
    [&:-webkit-autofill]:shadow-[inset_0_0_0px_1000px_white]        /* wipe yellow */
    [&:-webkit-autofill]:[-webkit-text-fill-color:#111827]          /* dark text */
    caret-indigo-600
  "
                                    />
                                    <datalist id="recent-emails">
                                        {recentEmails.map((e) => <option key={e} value={e} />)}
                                    </datalist>
                                </div>
                            </div>

                            {/* Password */}
                            <div>
                                <label htmlFor="password" className="block text-[13px] font-medium text-gray-800 mb-1">Password</label>
                                <div className="relative">
                                    <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                                        <svg width="18" height="18" viewBox="0 0 24 24" className="opacity-40">
                                            <path fill="currentColor" d="M12 17a2 2 0 1 0 0-4a2 2 0 0 0 0 4m6-6h-1V9a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2M9 9a3 3 0 0 1 6 0v2H9z" />
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
                                        className="
    w-full rounded-xl border border-gray-300/90 pl-10 pr-16 py-2.5
    text-[16px] sm:text-[15px]             /* crisp on mobile */
    text-gray-900
    placeholder:text-gray-400
    bg-white
    focus:ring-2 focus:ring-indigo-500 focus:outline-none
    [&:-webkit-autofill]:shadow-[inset_0_0_0px_1000px_white]
    [&:-webkit-autofill]:[-webkit-text-fill-color:#111827]
    caret-indigo-600
  "
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPw((s) => !s)}
                                        className="absolute inset-y-0 right-0 my-1 mr-2 inline-flex items-center rounded-lg border border-gray-200 bg-white px-2.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                                        aria-label={showPw ? 'Hide password' : 'Show password'}
                                    >
                                        {showPw ? 'Hide' : 'Show'}
                                    </button>
                                </div>

                                {/* Microcopy for password */}
                                <p className="mt-1.5 text-[11px] text-gray-500">
                                    Use your account password. Contact your admin if you’ve forgotten it.
                                </p>
                            </div>

                            <div className="flex items-center justify-between">
                                <a className="text-[13px] font-medium text-indigo-700 hover:text-indigo-800 hover:underline underline-offset-2" href="#">
                                    Forgot password?
                                </a>
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full rounded-xl bg-indigo-600 py-2.5 text-[15px] font-semibold text-white shadow-md hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 disabled:opacity-70 transition"
                            >
                                {loading ? 'Signing in…' : 'Sign in'}
                            </button>
                        </form>

                        <div className="mt-6 text-center">
                            <p className="text-[12px] text-gray-500">
                                No public sign-ups. Ask an administrator to create your account.
                            </p>
                        </div>
                    </div>

                    <p className="mt-8 text-center text-[11px] text-gray-400">
                        © {new Date().getFullYear()} HomeCare Hub • All rights reserved
                    </p>
                </div>
            </main>

        </div>
    );
}
