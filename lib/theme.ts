import { headers } from 'next/headers';
import { getServerSupabase } from '@/supabase/server';

export type ThemeMode = 'ORBIT' | 'LIGHT';

export async function getAccountTheme(): Promise<ThemeMode> {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  // 1) Account-level pref, if signed in
  if (user) {
    const { data } = await supabase
      .from('user_preferences')
      .select('theme_mode')
      .eq('user_id', user.id)
      .maybeSingle();
    if (data && (data.theme_mode === 'ORBIT' || data.theme_mode === 'LIGHT')) {
      return data.theme_mode;
    }
  }

  // 2) Fallback to cookie
  const hdrs = await headers();
  const cookieHeader = hdrs.get('cookie') ?? '';
  const orbit = /(?:^|;\s*)orbit=1(?:;|$)/.test(cookieHeader);
  return orbit ? 'ORBIT' : 'LIGHT';
}
