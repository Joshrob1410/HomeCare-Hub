import { redirect } from 'next/navigation';
import { getServerSupabase } from '@/supabase/server';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Must be signed in (your (app)/layout already enforces this, but it's fine to be explicit)
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  // Must be Level 1 Admin
  const { data: level, error } = await supabase.rpc('get_effective_level');
  if (error || level !== '1_ADMIN') redirect('/dashboard');

  // Already inside the (app) layout (header + sign out), so just render the page
  return <>{children}</>;
}
