// app/(app)/_components/ThemeToggle.tsx
'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/supabase/client';

type Mode = 'ORBIT' | 'LIGHT';

export default function ThemeToggle() {
    const router = useRouter();
    const [mode, setMode] = useState<Mode>('LIGHT');
    const [isPending, startTransition] = useTransition();

    // Hydrate from the value that ThemeCSSBridge actually applied (dataset),
    // falling back to the cookie if dataset is missing.
    useEffect(() => {
        const ds = document.documentElement.dataset.orbit;
        if (ds === '1' || ds === '0') {
            setMode(ds === '1' ? 'ORBIT' : 'LIGHT');
        } else {
            const orbitOn = document.cookie.split('; ').some((c) => c === 'orbit=1');
            setMode(orbitOn ? 'ORBIT' : 'LIGHT');
        }
    }, []);

    function emitOrbitChanged(nextOrbit: boolean) {
        // Same-tab listeners (ThemeCSSBridge, Dashboard, etc.)
        window.dispatchEvent(new CustomEvent('orbit:changed', { detail: { orbit: nextOrbit } }));
        // Cross-tab sync
        try {
            localStorage.setItem('orbit:lastChange', JSON.stringify({ orbit: nextOrbit, ts: Date.now() }));
        } catch {
            /* noop */
        }
    }

    // Keep cookie in sync so any cookie-based readers still work until migrated.
    function setOrbitCookie(nextOrbit: boolean) {
        document.cookie = `orbit=${nextOrbit ? 1 : 0}; Path=/; Max-Age=31536000; SameSite=Lax`;
    }

    async function apply(nextMode: Mode) {
        const { data: u } = await supabase.auth.getUser();
        const me = u.user?.id;
        if (me) {
            await supabase
                .from('user_preferences')
                .upsert({ user_id: me, theme_mode: nextMode }, { onConflict: 'user_id' });
        }

        // Optional: let the server set the cookie for future SSR (route may be absent; ignore errors)
        fetch('/api/theme', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orbit: nextMode === 'ORBIT' }),
            cache: 'no-store',
        }).catch(() => { });
    }

    async function toggle() {
        if (isPending) return;

        const prev = mode;
        const next: Mode = prev === 'ORBIT' ? 'LIGHT' : 'ORBIT';
        const nextOrbit = next === 'ORBIT';

        // Optimistic flip + broadcast now
        setMode(next);
        setOrbitCookie(nextOrbit);
        emitOrbitChanged(nextOrbit);

        // Re-broadcast on next frame (for components that remount on refresh)
        requestAnimationFrame(() => emitOrbitChanged(nextOrbit));

        // Refresh RSC; also re-broadcast after refresh kicks off
        startTransition(() => {
            router.refresh();
            setTimeout(() => emitOrbitChanged(nextOrbit), 0);
        });

        try {
            await apply(next);
        } catch {
            // Revert on failure (and tell listeners)
            const prevOrbit = prev === 'ORBIT';
            setMode(prev);
            setOrbitCookie(prevOrbit);
            emitOrbitChanged(prevOrbit);
            requestAnimationFrame(() => emitOrbitChanged(prevOrbit));
            startTransition(() => {
                router.refresh();
                setTimeout(() => emitOrbitChanged(prevOrbit), 0);
            });
        }
    }

    const orbitActive = mode === 'ORBIT';

    return (
        <button
            type="button"
            onClick={toggle}
            aria-pressed={orbitActive}
            aria-label="Toggle theme"
            className={[
                'relative inline-flex select-none items-center justify-center',
                'h-9 px-4 rounded-full text-sm font-semibold',
                'transition-all duration-300 ease-out',
                'ring-1 focus:outline-none focus-visible:ring-2',
                orbitActive
                    ? 'text-white ring-indigo-300/40'
                    : 'bg-white text-slate-900 ring-slate-300 hover:bg-slate-50',
            ].join(' ')}
            style={
                orbitActive
                    ? {
                        background:
                            'linear-gradient(135deg, #7C3AED 0%, #6366F1 50%, #3B82F6 100%)',
                        boxShadow:
                            '0 8px 30px rgba(99,102,241,0.35), inset 0 0 0 1px rgba(255,255,255,0.12)',
                    }
                    : {
                        boxShadow:
                            '0 2px 10px rgba(15,23,42,0.06), inset 0 0 0 1px rgba(15,23,42,0.04)',
                    }
            }
            disabled={isPending}
        >
            {orbitActive && (
                <span
                    aria-hidden
                    className="pointer-events-none absolute -inset-0.5 rounded-full blur-md opacity-70 transition-opacity"
                    style={{
                        background:
                            'radial-gradient(60% 60% at 50% 50%, rgba(99,102,241,0.45), rgba(59,130,246,0.25) 60%, transparent 70%)',
                    }}
                />
            )}
            <span
                aria-hidden
                className={[
                    'pointer-events-none absolute inset-0 rounded-full overflow-hidden',
                    orbitActive ? 'opacity-100' : 'opacity-0',
                    'transition-opacity duration-300',
                ].join(' ')}
            >
                <span
                    className="absolute -left-20 top-0 h-full w-20"
                    style={{
                        transform: 'skewX(-15deg)',
                        background:
                            'linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)',
                        animation: orbitActive ? 'ho-sheen 1s ease-out 1' : 'none',
                    }}
                />
            </span>
            <span className="relative z-10">
                {isPending ? (orbitActive ? 'Applying…' : 'Switching…') : orbitActive ? 'Orbit mode' : 'Light mode'}
            </span>
            <style jsx>{`
        @keyframes ho-sheen {
          0% { transform: translateX(0) skewX(-15deg); opacity: 0; }
          30% { opacity: 1; }
          100% { transform: translateX(260%) skewX(-15deg); opacity: 0; }
        }
      `}</style>
        </button>
    );
}
