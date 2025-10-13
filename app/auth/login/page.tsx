'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { supabase } from '@/supabase/client';
import { useRouter } from 'next/navigation';

// --- Brand palette (keep it purple, lighter near the top)
const ACTIVE = {
  start: '#8B5CF6', // violet-500/600
  mid:   '#7C3AED', // violet-600/700
  end:   '#6D28D9', // indigo-700-ish purple
} as const;

// Utility: hex -> rgba
function hexToRgba(hex: string, alpha = 1): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const bigint = parseInt(full, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const LS_KEY = 'hch_recent_emails';

/* ============================
   Small brand atoms
   ============================ */
function BrandLogo({ size = 56 }: { size?: number }) {
  return (
    <div className="relative" style={{ width: size, height: size }} aria-label="HomeCare Hub">
      <Image
        src="/logo.png"
        alt="HomeCare Hub"
        fill
        sizes={`${size}px`}
        className="object-contain"
        priority
      />
    </div>
  );
}

/** Banner ribbon that contains the logo + headings. No boxes/borders – keyline + frosted look */
function BrandBanner() {
  return (
    <div className="relative -mx-12">
      <div className="relative isolate group will-change-transform">
        {/* Shell */}
        <div className="absolute inset-0 -skew-x-6 overflow-hidden rounded-2xl">
          {/* Gradient keyline (subtle) */}
          <div
            className="absolute inset-0 p-[1.5px] rounded-2xl"
            style={{
              background: `linear-gradient(90deg,
                ${hexToRgba(ACTIVE.start, 0.55)} 0%,
                ${hexToRgba(ACTIVE.mid,   0.35)} 50%,
                ${hexToRgba(ACTIVE.end,   0.12)} 100%)`,
            }}
          />
          {/* Body */}
          <div
            className="absolute inset-[1.5px] rounded-2xl bg-white/10 backdrop-blur-[2px] shadow-[0_12px_30px_rgba(0,0,0,0.25)]"
          />
          {/* Micro texture */}
          <div
            className="absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage:
                'repeating-linear-gradient(135deg, rgba(255,255,255,.7) 0 1px, rgba(255,255,255,0) 1px 8px)',
            }}
          />
          {/* Soft shimmer */}
          <div
            className="absolute -left-1/3 top-0 h-full w-1/2
                       bg-gradient-to-r from-white/0 via-white/35 to-white/0
                       translate-x-[-120%]
                       motion-safe:group-hover:translate-x-[220%]
                       transition-transform duration-[2200ms] ease-linear"
          />
        </div>

        {/* Content row */}
        <div className="relative flex items-center gap-4 px-6 py-4">
          <BrandLogo size={56} />
          <div>
            <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">HomeCare Hub</h1>
            <p className="text-sm text-white/85">Staff management platform</p>
          </div>
        </div>

        {/* Chevron tail */}
        <div
          className="absolute right-[-18px] top-1/2 -translate-y-1/2 h-10 w-10 opacity-40"
          style={{
            clipPath: 'polygon(0% 0%, 100% 50%, 0% 100%)',
            background: `linear-gradient(to right, ${hexToRgba(ACTIVE.mid, 0.5)}, ${hexToRgba(ACTIVE.end, 0)})`,
          }}
        />
      </div>
    </div>
  );
}

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
    } catch {}
  }, []);

  // Save the successful email to localStorage (dedup, keep latest first)
  function saveEmailToHistory(addr: string) {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const arr: string[] = raw ? (JSON.parse(raw) || []) : [];
      const next = [addr, ...arr.filter((e) => e !== addr)].slice(0, 5);
      localStorage.setItem(LS_KEY, JSON.stringify(next));
      setRecentEmails(next);
    } catch {}
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
    <div className="min-h-screen bg-white grid grid-cols-1 lg:grid-cols-2 relative">
      {/* Decorative seam + glow */}
      <div className="pointer-events-none hidden lg:block absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-gradient-to-b from-transparent via-indigo-200 to-transparent" />
      <div className="pointer-events-none hidden lg:block absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 h-40 w-40 rounded-full bg-indigo-400/10 blur-3xl" />

      {/* ===== Left: Brand / Marketing Panel ===== */}
      <aside
        className="relative hidden lg:flex items-center justify-center overflow-hidden text-white"
        style={{
          // Keep it purple with lighter top: stacked radials + diagonal sweep
          backgroundImage: `
            radial-gradient(700px circle at 5% 0%, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 60%),
            radial-gradient(450px circle at 45% -10%, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 60%),
            linear-gradient(135deg, ${ACTIVE.start} 0%, ${ACTIVE.mid} 40%, ${ACTIVE.end} 100%)
          `,
        }}
      >
        {/* Top glow band */}
        <div
          className="absolute inset-x-0 top-0 h-28"
          style={{
            background: `linear-gradient(to bottom, rgba(255,255,255,0.18), rgba(255,255,255,0))`,
          }}
        />

        <div className="relative px-12 py-10 max-w-xl w-full">
          <BrandBanner />

          {/* Hero copy */}
          <div className="mt-8">
            <h2 className="text-4xl font-semibold leading-tight tracking-tight">
              Everything you need to run your homes — all in one place.
            </h2>
            <p className="mt-4 text-white/85">
              Rotas, timesheets, training, budgets and people — in one secure, role-aware workspace.
            </p>
          </div>

          {/* Feature bullets */}
          <ul className="mt-8 space-y-4 text-white/95">
            {[
              'Role-based access ensuring GDPR compliance',
              'Realtime updates with audit trails',
              'Secure sign-in powered by Supabase',
              'Server security powered by Vercel',
            ].map((text) => (
              <li key={text} className="flex items-start gap-3">
                <span className="mt-1 inline-flex rounded-md bg-white/15 p-1.5 ring-1 ring-white/25">
                  <svg width="16" height="16" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M9 16.17L4.83 12l-1.42 1.41L9 19l12-12-1.41-1.41z"
                    />
                  </svg>
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ul>

          {/* Testimonial */}
          <div className="mt-10 rounded-2xl bg-white/10 p-5 backdrop-blur-sm ring-1 ring-white/20 shadow-lg">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-white/95 text-indigo-700 flex items-center justify-center text-sm font-bold">
                ✓
              </div>
              <div>
                <p className="text-sm leading-5">
                  “Switching to HomeCare Hub made monthly oversight painless — everything’s in one place.”
                </p>
                <p className="mt-1 text-xs text-white/75">Registered Manager, North West</p>
              </div>
            </div>
          </div>

          <p className="mt-8 text-xs text-white/70">© {new Date().getFullYear()} HomeCare Hub</p>
        </div>
      </aside>

      {/* ===== Right: Auth Card ===== */}
      <main className="flex items-center justify-center bg-gray-50 relative py-10">
        <div className="w-full max-w-md">
          {/* Mobile banner (branding above the form) */}
          <div className="mb-6 lg:hidden text-center">
            <div className="mx-auto max-w-[calc(100%-2rem)]">
              <div className="relative isolate">
                <div
                  className="absolute inset-0 -skew-x-6 rounded-2xl"
                  style={{
                    background: `linear-gradient(90deg,
                      ${hexToRgba(ACTIVE.start, 0.16)} 0%,
                      ${hexToRgba(ACTIVE.mid,   0.12)} 50%,
                      ${hexToRgba(ACTIVE.end,   0.06)} 100%)`,
                  }}
                />
                <div className="relative flex items-center justify-center gap-3 px-4 py-3">
                  <BrandLogo size={40} />
                  <div>
                    <h1 className="text-[20px] font-semibold tracking-tight text-gray-900">HomeCare Hub</h1>
                    <p className="mt-0.5 text-[12px] text-gray-600">Staff management platform</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Auth card */}
          <div className="relative rounded-2xl bg-white p-7 shadow-xl ring-1 ring-gray-900/5">
            <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-indigo-500/5" />

            {error && (
              <div
                className="mb-4 rounded-lg border border-red-200/80 bg-red-50 px-4 py-3 text-[13px] text-red-700"
                role="alert"
                aria-live="polite"
              >
                {error}
              </div>
            )}

            <div className="hidden lg:block mb-4">
              <h2 className="text-[18px] font-semibold tracking-tight text-gray-900">Welcome back</h2>
              <p className="mt-0.5 text-[13px] text-gray-600">Use your work email to sign in</p>
            </div>

            {/* Enable browser autofill + local suggestions */}
            <form onSubmit={handleLogin} className="space-y-4.5" autoComplete="on" noValidate>
              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-[13px] font-medium text-gray-800 mb-1">
                  Email
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <svg width="18" height="18" viewBox="0 0 24 24" className="opacity-40">
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
                    className="w-full rounded-xl border border-gray-300/90 pl-10 pr-3 py-2.5 text-[16px] sm:text-[15px] text-gray-900 placeholder:text-gray-400 bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none [&:-webkit-autofill]:shadow-[inset_0_0_0px_1000px_white] [&:-webkit-autofill]:[-webkit-text-fill-color:#111827] caret-indigo-600"
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
                <label htmlFor="password" className="block text-[13px] font-medium text-gray-800 mb-1">
                  Password
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <svg width="18" height="18" viewBox="0 0 24 24" className="opacity-40">
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
                    className="w-full rounded-xl border border-gray-300/90 pl-10 pr-16 py-2.5 text-[16px] sm:text-[15px] text-gray-900 placeholder:text-gray-400 bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none [&:-webkit-autofill]:shadow-[inset_0_0_0px_1000px_white] [&:-webkit-autofill]:[-webkit-text-fill-color:#111827] caret-indigo-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((s) => !s)}
                    className="absolute inset-y-0 right-0 my-1 mr-2 inline-flex items-center rounded-lg border border-gray-200 bg-white px-2.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                    aria-pressed={showPw}
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
                <a
                  className="text-[13px] font-medium text-indigo-700 hover:text-indigo-800 hover:underline underline-offset-2"
                  href="#"
                >
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
