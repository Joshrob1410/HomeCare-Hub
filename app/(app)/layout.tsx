// app/(app)/layout.tsx (or wherever your AppLayout lives)
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSupabase } from '@/supabase/server';
import UserChip from './_components/UserChip';
import NotificationBell from './_components/NotificationBell';
import Sidebar from './_components/Sidebar';
import MobileSidebar from './_components/MobileSidebar';
import LicenseGate from './_components/LicenseGate';

// ---- HomeOrbit dark (subtle) tokens (match Sidebar/MobileSidebar) ----
const ORBIT = {
    pageBg:
        'linear-gradient(180deg, rgba(20,26,48,0.96) 0%, rgba(14,19,36,0.96) 60%, rgba(12,17,30,0.96) 100%)',
    ring: 'rgba(148,163,184,0.16)', // slate-400 alpha
    ink: '#E5E7EB',                 // slate-200
    sub: '#94A3B8',                 // slate-400
};
const BRAND_GRADIENT =
    'linear-gradient(135deg, #7C3AED 0%, #6366F1 50%, #3B82F6 100%)';

export default async function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Block access if not signed in
    const supabase = await getServerSupabase();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect('/auth/login');

    return (
        <div className="min-h-screen" style={{ background: ORBIT.pageBg }}>
            {/* Login/license gate runs on the client and will sign out suspended/cancelled users */}
            <LicenseGate />

            {/* Top header (dark glass) */}
            <header
                className="sticky top-0 z-30 backdrop-blur supports-[backdrop-filter]:bg-black/30"
                style={{ borderBottom: `1px solid ${ORBIT.ring}` }}
            >
                <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
                    {/* Left: mobile burger + brand */}
                    <div className="flex items-center gap-2">
                        {/* Mobile hamburger + drawer (hidden on lg+) */}
                        <MobileSidebar />

                        <Link href="/dashboard" className="inline-flex items-center gap-2">
                            <span
                                className="h-8 w-8 rounded-xl grid place-items-center font-bold text-white shadow-sm ring-2 ring-white/70"
                                style={{ background: BRAND_GRADIENT }}
                                aria-hidden
                            >
                                HO
                            </span>
                            <span className="font-semibold" style={{ color: ORBIT.ink }}>
                                HomeOrbit
                            </span>
                        </Link>
                    </div>

                    {/* Right: tools (bell on the LEFT of the user name) */}
                    <div className="flex items-center gap-3">
                        <NotificationBell />
                        <UserChip />
                    </div>
                </div>

                {/* brand glow seam */}
                <div
                    className="h-px w-full"
                    style={{
                        background:
                            'linear-gradient(90deg, rgba(124,58,237,0.35), rgba(99,102,241,0.25), rgba(59,130,246,0.35))',
                    }}
                />
            </header>

            {/* Sidebar fixed on the very left (lg+), content padded to clear it */}
            <Sidebar />

            <main className="px-4 py-6 lg:pl-72">
                <div className="mx-auto max-w-6xl">{children}</div>
            </main>
        </div>
    );
}
