'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/supabase/client';

type AppLevel = '1_ADMIN' | '2_COMPANY' | '3_MANAGER' | '4_STAFF';

type ProfileRow = {
  user_id: string;
  full_name: string | null;
  is_admin: boolean | null;
} & Record<string, unknown>;

export default function DebugAuth() {
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [level, setLevel] = useState<AppLevel | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: userData, error: uErr } = await supabase.auth.getUser();
      if (uErr) {
        setError(uErr.message);
        return;
      }
      const u = userData.user;
      setUserId(u?.id ?? null);
      setEmail(u?.email ?? null);

      // what level does the DB think?
      const { data: lvl, error: lErr } = await supabase
        .rpc('get_effective_level')
        .returns<AppLevel>();
      if (lErr) setError(lErr.message);
      else setLevel(lvl ?? null);

      if (u?.id) {
        // read your profile row (policy allows self-read)
        const { data: prof, error: pErr } = await supabase
          .from('profiles')
          .select('*')
          .eq('user_id', u.id)
          .maybeSingle()
          .returns<ProfileRow | null>();
        if (pErr) setError(pErr.message);
        else setProfile(prof);
      }
    })();
  }, []);

  return (
    <div className="p-6 space-y-2">
      <h1 className="text-xl font-semibold">Auth Debug</h1>
      {error && <p className="text-red-600">Error: {error}</p>}
      <p><b>User ID:</b> {userId ?? '—'}</p>
      <p><b>Email:</b> {email ?? '—'}</p>
      <p><b>get_effective_level:</b> {level ?? '—'}</p>
      <pre className="mt-4 p-3 border rounded bg-gray-50 text-xs overflow-auto">
        {JSON.stringify(profile, null, 2)}
      </pre>
    </div>
  );
}
