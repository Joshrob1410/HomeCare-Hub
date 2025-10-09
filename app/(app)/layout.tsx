import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getServerSupabase } from '@/supabase/server';
import UserChip from './_components/UserChip';
import NotificationBell from './_components/NotificationBell';
import Sidebar from './_components/Sidebar';
import MobileSidebar from './_components/MobileSidebar';


export default async function AppLayout({ children }: { children: React.ReactNode }) {
    // Block access if not signed in
    const supabase = await getServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/auth/login');

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Top header (clean white) */}
            <header className="sticky top-0 z-30 bg-gray/90 backdrop-blur border-b border-gray-200 shadow-sm">
                <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between">
                    {/* Left: mobile burger + brand */}
                    <div className="flex items-center gap-2">
                        {/* Mobile hamburger + drawer (hidden on lg+) */}
                        <MobileSidebar />

                        <Link href="/dashboard" className="inline-flex items-center gap-2">
                            <span className="h-8 w-8 rounded-xl grid place-items-center font-bold text-white shadow-sm ring-2 ring-white bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-600">
                                HC
                            </span>
                            <span className="font-semibold text-gray-900">HomeCare Hub</span>
                        </Link>
                    </div>

                    {/* Right: tools (bell on the LEFT of the user name) */}
                    <div className="flex items-center gap-3">
                        <NotificationBell />
                        <UserChip />
                    </div>
                </div>
                <div className="h-px w-full bg-gradient-to-r from-indigo-500/30 via-violet-500/30 to-purple-500/30" />
            </header>

            {/* Sidebar fixed on the very left (lg+), content padded to clear it */}
            <Sidebar />

            <main className="px-4 py-6 lg:pl-72">
                <div className="mx-auto max-w-6xl">
                    {children}
                </div>
            </main>
        </div>
    );
}

