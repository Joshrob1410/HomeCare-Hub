// supabase/roles.ts
import { supabase } from '@/supabase/client';

export type AppLevel = '1_ADMIN'|'2_COMPANY'|'3_MANAGER'|'4_STAFF';

export async function getEffectiveLevel(): Promise<AppLevel> {
  try {
    const { data, error } = await supabase.rpc('get_effective_level');
    if (error || !data) return '4_STAFF';
    return data as AppLevel;
  } catch {
    return '4_STAFF';
  }
}
