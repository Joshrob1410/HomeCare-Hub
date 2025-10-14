'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel, type AppLevel } from '@/supabase/roles';

/** ========= Types ========= */
type Level = AppLevel;
type Company = { id: string; name: string };

type Policy = {
  id: string;
  company_id: string;
  name: string;
  file_path: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type ViewState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | {
      status: 'ready';
      level: Level;
      uid: string;
      companies: Company[];
      selectedCompanyId: string | null;
    };

/** ========= Helpers ========= */
function safeFilename(name: string) {
  return name.replace(/[^\w.\-]+/g, '_');
}
function isManagerOrAbove(level: Level) {
  return level === '1_ADMIN' || level === '2_COMPANY' || level === '3_MANAGER';
}

/** ========= Page ========= */
export default function PoliciesPage() {
  const [view, setView] = useState<ViewState>({ status: 'loading' });
  const [tab, setTab] = useState<'LIST' | 'REVIEW'>('LIST');

  // list (everyone)
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  // review tab (create/edit)
  const [nameInput, setNameInput] = useState('');
  const [fileInput, setFileInput] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // per-file signed URL cache (download speedups)
  const signedCache = useRef<Map<string, { url: string; exp: number }>>(new Map());

  const canSeeReview =
    view.status === 'ready' && isManagerOrAbove(view.level);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const user = u.user;
      if (!user) {
        setView({ status: 'signed_out' });
        return;
      }

      const lvl = (await getEffectiveLevel()) as Level | null;

      // All companies user can see (same pattern you use elsewhere)
      const [{ data: coAll }, { data: cm }] = await Promise.all([
        supabase.from('companies').select('id,name').order('name'),
        supabase.from('company_memberships').select('company_id').maybeSingle(),
      ]);

      const companies: Company[] = (coAll ?? []) as Company[];

      // Default company:
      // - Admins: first company (if many, user can switch).
      // - Others: their membership’s company.
      let selectedCompanyId: string | null = null;
      if (lvl === '1_ADMIN') {
        selectedCompanyId = companies[0]?.id ?? null;
      } else {
        selectedCompanyId = (cm?.company_id as string | undefined) ?? null;
      }

      setView({
        status: 'ready',
        level: (lvl as Level) ?? '4_STAFF',
        uid: user.id,
        companies,
        selectedCompanyId,
      });
    })();
  }, []);

  // load list for selected company (everyone)


  // signed download link (cache + refresh)
  const signUrl = useCallback(
    async (path: string, ttlSec = 3600) => {
      const now = Date.now();
      const cached = signedCache.current.get(path);
      if (cached && cached.exp > now + 5_000) return cached.url;

      const { data, error } = await supabase.storage
        .from('policies')
        .createSignedUrl(path, ttlSec);
      if (error) {
        console.error('❌ createSignedUrl failed', error);
        return null;
      }
      const url = data?.signedUrl ?? null;
      if (url) signedCache.current.set(path, { url, exp: now + ttlSec * 1000 });
      return url;
    },
    []
  );

  // build storage key & upload (mirrors budgets’ signed PUT flow) 
  const makePath = (companyId: string, policyId: string, filename: string) =>
    `${companyId}/${policyId}/${Date.now()}_${safeFilename(filename)}`;

  const uploadFile = useCallback(
    async (companyId: string, policyId: string, file: File) => {
      const path = makePath(companyId, policyId, file.name);

      const { data: signed, error: signErr } = await supabase.storage
        .from('policies')
        .createSignedUploadUrl(path);
      if (signErr || !signed?.signedUrl) {
        console.error('❌ createSignedUploadUrl failed', signErr);
        return { ok: false as const, path: null as string | null };
      }

      // Small PUT helper (same as budgets) :contentReference[oaicite:3]{index=3}
      const putWithTimeout = async (
        url: string,
        body: Blob,
        headers: Record<string, string>,
        ms = 15000
      ) => {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort('UPLOAD_TIMEOUT'), ms);
        try {
          const res = await fetch(url, { method: 'PUT', body, headers, signal: ac.signal });
          if (!res.ok) {
            const txt = await res.text().catch(() => '');
            throw new Error(`PUT_FAILED ${res.status} ${txt}`);
          }
          return res;
        } finally {
          clearTimeout(t);
        }
      };

      try {
        await putWithTimeout(
          signed.signedUrl,
          file,
          {
            'content-type': file.type || 'application/octet-stream',
            'x-upsert': 'true',
            'cache-control': '31536000',
          },
          15000
        );
        return { ok: true as const, path };
      } catch (err) {
        console.error('❌ upload failed', err);
        try {
          await supabase.storage.from('policies').remove([path]);
        } catch {}
        return { ok: false as const, path: null as string | null };
      }
    },
    []
  );

  const onEdit = useCallback((p: Policy) => {
    setEditingId(p.id);
    setNameInput(p.name);
    setFileInput(null);
  }, []);

  const onDelete = useCallback(
    async (p: Policy) => {
      if (!confirm('Delete this policy? This cannot be undone.')) return;
      // optimistic
      const prev = policies;
      setPolicies((list) => list.filter((x) => x.id !== p.id));
      try {
        if (p.file_path) {
          try {
            await supabase.storage.from('policies').remove([p.file_path]);
          } catch (er) {
            console.warn('⚠️ storage remove warning:', er);
          }
        }
        const { error } = await supabase.from('policies').delete().eq('id', p.id);
        if (error) throw error;
      } catch (err) {
        console.error('❌ delete policies failed', err);
        setPolicies(prev); // revert
      }
    },
    [policies]
  );

  const onDownload = useCallback(
    async (p: Policy) => {
      if (!p.file_path) return;
      const url = await signUrl(p.file_path, 60 * 10);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    },
    [signUrl]
  );

  // UI guards
  if (view.status === 'loading') return <div className="p-6">Loading policies…</div>;
  if (view.status === 'signed_out') return null;

  const isAdmin = view.level === '1_ADMIN';
  const showCompanySelector = isAdmin;
}
