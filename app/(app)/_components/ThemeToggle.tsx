// app/(app)/_components/ThemeToggle.tsx
'use client';

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/supabase/client';

type Mode = 'ORBIT' | 'LIGHT';

type Props = {
  initialOrbit: boolean;
};

export default function ThemeToggle({ initialOrbit }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialOrbit ? 'ORBIT' : 'LIGHT');
  const [isPending, startTransition] = useTransition();

  function emitOrbitChanged(nextOrbit: boolean) {
    window.dispatchEvent(new CustomEvent('orbit:changed', { detail: { orbit: nextOrbit } }));
    try {
      localStorage.setItem('orbit:lastChange', JSON.stringify({ orbit: nextOrbit, ts: Date.now() }));
    } catch {
      /* noop */
    }
  }

  function setOrbitCookie(nextOrbit: boolean) {
    document.cookie = `orbit=${nextOrbit ? 1 : 0}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  async function persist(nextMode: Mode) {
    const { data: u } = await supabase.auth.getUser();
    const me = u.user?.id;
    if (me) {
      await supabase
        .from('user_preferences')
        .upsert({ user_id: me, theme_mode: nextMode }, { onConflict: 'user_id' });
    }
    fetch('/api/theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orbit: nextMode === 'ORBIT' }),
      cache: 'no-store',
    }).catch(() => {});
  }

  async function toggle() {
    if (isPending) return;
    const prev = mode;
    const next: Mode = prev === 'ORBIT' ? 'LIGHT' : 'ORBIT';
    const nextOrbit = next === 'ORBIT';

    // Optimistic UI + cookie + broadcast
    setMode(next);
    setOrbitCookie(nextOrbit);
    emitOrbitChanged(nextOrbit);

    try {
      await persist(next);
      startTransition(() => router.refresh());
    } catch {
      // Revert on failure
      const revertOrbit = prev === 'ORBIT';
      setMode(prev);
      setOrbitCookie(revertOrbit);
      emitOrbitChanged(revertOrbit);
      try { await persist(prev); } catch { /* noop */ }
      startTransition(() => router.refresh());
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
        orbitActive ? 'text-white ring-indigo-300/40' : 'bg-white text-slate-900 ring-slate-300 hover:bg-slate-50',
      ].join(' ')}
      style={
        orbitActive
          ? {
              background: 'linear-gradient(135deg, #7C3AED 0%, #6366F1 50%, #3B82F6 100%)',
              boxShadow: '0 8px 30px rgba(99,102,241,0.35), inset 0 0 0 1px rgba(255,255,255,0.12)',
            }
          : {
              boxShadow: '0 2px 10px rgba(15,23,42,0.06), inset 0 0 0 1px rgba(15,23,42,0.04)',
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
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)',
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
