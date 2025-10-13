'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/supabase/client';

type LicenseStatus = 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED';

// Returns true if the current user is Level 1 Admin
async function isPlatformAdmin(): Promise<boolean> {
    const { data, error } = await supabase.rpc('get_effective_level');
    if (error) return false;
    const lvl = typeof data === 'string' ? data : '';
    return lvl === '1_ADMIN';
}

export default function LicenseGate(): null {
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        (async () => {
            const { data } = await supabase.auth.getSession();
            const token = data.session?.access_token;
            if (!token) return; // not logged in (e.g., on /auth/login)

            // ⬅️ Admins bypass license checks entirely
            if (await isPlatformAdmin()) return;

            const res = await fetch('/api/license/status', {
                headers: { authorization: `Bearer ${token}` },
                cache: 'no-store',
            });
            if (!res.ok) return;

            const { status } = (await res.json()) as { status: LicenseStatus };
            if (status === 'SUSPENDED' || status === 'CANCELLED') {
                await supabase.auth.signOut();
                if (pathname !== '/auth/login') router.replace('/auth/login');
            }
        })().catch(() => {
            // fail-safe: ignore errors
        });
    }, [router, pathname]);

    return null;
}
