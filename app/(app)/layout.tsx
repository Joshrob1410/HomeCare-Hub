import Link from 'next/link';
import { redirect } from 'next/navigation';
import Image from 'next/image';
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

export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const supabase = await getServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/auth/login');

    // Resolve theme from DB; default to LIGHT if unset
    let orbitEnabled = false;
    const { data: pref } = await supabase
        .from('user_preferences')
        .select('theme_mode')
        .eq('user_id', user.id)
        .maybeSingle();

    if (pref?.theme_mode === 'ORBIT') orbitEnabled = true;
    if (pref?.theme_mode === 'LIGHT') orbitEnabled = false;

    return (
        <div className="min-h-screen" style={{ background: 'var(--page-bg)' }}>
            {/* Instant CSS var sync (no UI) */}
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
                    <ThemeToggle />
                </div>

                <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <MobileSidebar orbitInitial={orbitEnabled} />
                        <Link href="/dashboard" className="inline-flex items-center gap-2">
                            {/* Logo */}
                            <div className="h-8 w-8 rounded-xl overflow-hidden shadow-sm ring-2 ring-white/70" aria-hidden>
                                <Image
                                    src="/logo.png" // change to '/logo.svg' if your asset is SVG
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

            {/* Pass the required prop */}
            <Sidebar orbitInitial={orbitEnabled} />

            <main className="px-4 py-6 lg:pl-72">
                <div className="mx-auto max-w-6xl">{children}</div>
            </main>
        </div>
    );
}
