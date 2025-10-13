// app/(app)/licenses/page.tsx
import { redirect } from 'next/navigation';
import { getServerSupabase } from '@/supabase/server';
import LicenseAdminClient from './ui/LicenseAdminClient';

export default async function LicensesPage() {
  // Auth guard (layout also checks, but we keep it belt & braces)
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  // ✅ Only Level 1 Admin may access
  const { data: level } = await supabase.rpc('get_effective_level');
  if (typeof level !== 'string' || level !== '1_ADMIN') {
    redirect('/dashboard'); // or show 404/Not Authorized page
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Licenses</h1>
          <p className="text-sm text-gray-600">
            View and manage company license status, plan, seats, and renewal dates.
          </p>
        </div>
      </header>
      <LicenseAdminClient />
    </div>
  );
}
