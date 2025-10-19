import Link from 'next/link';
import { redirect } from 'next/navigation';
import Image from 'next/image';
import { cookies } from 'next/headers';
import { getServerSupabase } from '@/supabase/server';

import UserChip from './_components/UserChip';
import NotificationBell from './_components/NotificationBell';
import Sidebar from './_components/Sidebar';
import MobileSidebar from './_components/MobileSidebar';
import LicenseGate from './_components/LicenseGate';
import ThemeToggle from './_components/ThemeToggle';
import ThemeCSSBridge from './_components/ThemeCSSBridge';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

/* ===== Tokens + helper (SSR-applied to avoid any flip) ===== */
const TOKENS = {
    ORBIT: {
        pageBg:
            'linear-gradient(180deg, rgba(20,26,48,0.96) 0%, rgba(14,19,36,0.96) 60%, rgba(12,17,30,0.96) 100%)',
        // Match client tokens
        ring: 'rgba(148,163,184,0.22)',
        ink: '#E5E7EB',
        sub: '#94A3B8',
        panelBg:
            'linear-gradient(180deg, rgba(20,26,48,0.96) 0%, rgba(14,19,36,0.96) 60%, rgba(12,17,30,0.96) 100%)',
        cardGrad:
            'linear-gradient(135deg, rgba(15,23,42,0.60) 0%, rgba(15,23,42,0.50) 35%, rgba(2,6,23,0.50) 100%), linear-gradient(135deg, rgba(124,58,237,0.18) 0%, rgba(99,102,241,0.16) 35%, rgba(59,130,246,0.14) 100%)',
        ringStrong: 'rgba(148,163,184,0.30)',
        headerTint: 'rgba(0,0,0,0.30)',
        link: '#C7D2FE',
        navItemBg: 'rgba(0,0,0,0.38)',
        navItemBgHover: 'rgba(0,0,0,0.56)',
    },
    LIGHT: {
        pageBg: 'linear-gradient(180deg, #F7F8FB 0%, #F4F6FA 60%, #F2F4F8 100%)',
        ring: 'rgba(15,23,42,0.08)',
        ink: '#0F172A',
        sub: '#475569',
        panelBg:
            'linear-gradient(180deg, #FBFCFE 0%, #F8FAFD 60%, #F6F8FC 100%)',
        cardGrad:
            'linear-gradient(135deg, rgba(124,58,237,0.05) 0%, rgba(99,102,241,0.05) 35%, rgba(59,130,246,0.05) 100%)',
        ringStrong: 'rgba(15,23,42,0.12)',
        headerTint: 'rgba(255,255,255,0.60)',
        link: '#4F46E5',
        navItemBg: '#FFFFFF',
        navItemBgHover: '#F8FAFF',
    },
} as const;

function buildCssVars(orbit: boolean): React.CSSProperties {
    const t = orbit ? TOKENS.ORBIT : TOKENS.LIGHT;
    const vars: Record<`--${string}`, string> = {
        '--page-bg': t.pageBg,
        '--ring': t.ring,
        '--ink': t.ink,
        '--sub': t.sub,
        '--card-grad': t.cardGrad,
        '--ring-strong': t.ringStrong,
        '--header-tint': t.headerTint,
        '--brand-link': t.link,
        '--nav-item-bg': t.navItemBg,
        '--nav-item-bg-hover': t.navItemBgHover,
        '--panel-bg': t.panelBg,
        '--panel-bg-light': TOKENS.LIGHT.panelBg,
        '--panel-bg-dark': TOKENS.ORBIT.panelBg,
        '--bg-light-alpha': orbit ? '0' : '1',
        '--bg-dark-alpha': orbit ? '1' : '0',
    };
    return vars as React.CSSProperties;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const supabase = await getServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/auth/login');

    // 1) Read cookie first
    const cookieStore = await cookies();
    const cookieVal = cookieStore.get('orbit')?.value;
    const cookieOrbit = cookieVal === '1' ? true : cookieVal === '0' ? false : undefined;

    // 2) Read DB pref
    let dbOrbit: boolean | undefined;
    const { data: pref } = await supabase
        .from('user_preferences')
        .select('theme_mode')
        .eq('user_id', user.id)
        .maybeSingle();
    if (pref?.theme_mode === 'ORBIT') dbOrbit = true;
    if (pref?.theme_mode === 'LIGHT') dbOrbit = false;

    // 3) Decide initial mode: cookie → DB → DEFAULT(ORBIT)
    const orbitEnabled = (cookieOrbit ?? dbOrbit) ?? true;

    const cssVars = buildCssVars(orbitEnabled);

    return (
        <div
            className="min-h-screen"
            style={{ ...cssVars, background: 'var(--page-bg)' }}
            data-orbit={orbitEnabled ? '1' : '0'}
        >
            {/* Keeps everything in sync post-hydration and across tabs */}
            <ThemeCSSBridge initialOrbit={orbitEnabled} />

            <LicenseGate />

            <header
                className="sticky top-0 z-30 relative"
                style={{
                    borderBottom: '1px solid var(--ring)',
                    backgroundColor: 'var(--header-tint)',
                    backdropFilter: 'saturate(180%) blur(8px)',
                    WebkitBackdropFilter: 'saturate(180%) blur(8px)',
                }}
            >
                <div className="absolute left-2 top-2 lg:left-3 lg:top-2 z-40">
                    <ThemeToggle initialOrbit={orbitEnabled} />
                </div>

                <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <MobileSidebar orbitInitial={orbitEnabled} />
                        <Link href="/dashboard" className="inline-flex items-center gap-2">
                            <div className="h-8 w-8 rounded-xl overflow-hidden shadow-sm ring-2 ring-white/70" aria-hidden>
                                <Image
                                    src="/logo.png"
                                    alt="HomeOrbit logo"
                                    width={32}
                                    height={32}
                                    className="h-full w-full object-contain"
                                    priority
                                />
                            </div>
                            <span className="font-semibold" style={{ color: 'var(--ink)' }}>
                                HomeOrbit
                            </span>
                        </Link>
                    </div>

                    <div className="flex items-center gap-3">
                        <NotificationBell />
                        <UserChip />
                    </div>
                </div>

                <div
                    className="h-px w-full"
                    style={{
                        background:
                            'linear-gradient(90deg, rgba(124,58,237,0.35), rgba(99,102,241,0.25), rgba(59,130,246,0.35))',
                    }}
                />
            </header>

            <Sidebar orbitInitial={orbitEnabled} />

            <main className="px-4 py-6 lg:pl-72">
                <div className="mx-auto max-w-6xl">{children}</div>
            </main>
        </div>
    );
}
