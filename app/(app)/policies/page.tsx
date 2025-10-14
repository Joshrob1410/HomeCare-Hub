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
  useEffect(() => {
    (async () => {
      if (view.status !== 'ready' || !view.selectedCompanyId) return;
      setLoadingList(true);
      const { data, error } = await supabase
        .from('policies')
        .select('*')
        .eq('company_id', view.selectedCompanyId)
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('❌ load policies failed', error);
        setPolicies([]);
      } else {
        setPolicies((data ?? []) as Policy[]);
      }
      setLoadingList(false);
    })();
  }, [view.status, view.selectedCompanyId]);

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

  const onCreateOrUpdate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (view.status !== 'ready' || !view.selectedCompanyId) return;
      if (!nameInput.trim()) return;

      setSaving(true);
      try {
        if (!editingId) {
          // create row
          const { data, error } = await supabase
            .from('policies')
            .insert({
              company_id: view.selectedCompanyId,
              name: nameInput.trim(),
              created_by: view.uid,
            })
            .select('*')
            .single();
          if (error) {
            console.error('❌ insert policies failed', error);
            return;
          }
          let created = data as Policy;

          if (fileInput) {
            const up = await uploadFile(view.selectedCompanyId, created.id, fileInput);
            if (up.ok && up.path) {
              const { data: upd, error: updErr } = await supabase
                .from('policies')
                .update({ file_path: up.path })
                .eq('id', created.id)
                .select('*')
                .single();
              if (!updErr && upd) created = upd as Policy;
              await signUrl(up.path, 6 * 3600);
            }
          }

          setPolicies((prev) => [created, ...prev]);
        } else {
          // update row
          const basePatch: Partial<Policy> = { name: nameInput.trim() };
          let path: string | null = null;

          if (fileInput) {
            const up = await uploadFile(view.selectedCompanyId, editingId, fileInput);
            if (up.ok && up.path) path = up.path;
          }

          const { data: upd, error: updErr } = await supabase
            .from('policies')
            .update(path ? { ...basePatch, file_path: path } : basePatch)
            .eq('id', editingId)
            .select('*')
            .single();

          if (updErr) {
            console.error('❌ update policies failed', updErr);
            return;
          }

          if (path) await signUrl(path, 6 * 3600);

          const updated = upd as Policy;
          setPolicies((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        }

        // reset form
        setEditingId(null);
        setNameInput('');
        setFileInput(null);
      } finally {
        setSaving(false);
      }
    },
    [view.status, view.selectedCompanyId, view.uid, nameInput, fileInput, editingId, uploadFile, signUrl]
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

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Policies</h1>

      {/* Company selector (Admins) */}
      {showCompanySelector && (
        <div>
          <label className="block text-xs text-gray-600 mb-1">Company</label>
          <select
            className="w-full max-w-xs border rounded-lg px-3 py-2 bg-white"
            value={view.selectedCompanyId ?? ''}
            onChange={(e) =>
              setView((v) =>
                v.status !== 'ready' ? v : { ...v, selectedCompanyId: e.target.value || null }
              )
            }
          >
            {view.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Tabs */}
      <div className="inline-flex rounded-lg border bg-white ring-1 ring-gray-50 shadow-sm overflow-hidden">
        <button
          className={`px-4 py-2 text-sm ${tab === 'LIST' ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-gray-50'}`}
          onClick={() => setTab('LIST')}
        >
          Company Policies
        </button>
        {canSeeReview && (
          <button
            className={`px-4 py-2 text-sm ${tab === 'REVIEW' ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-gray-50'}`}
            onClick={() => setTab('REVIEW')}
          >
            Add & Review
          </button>
        )}
      </div>

      {/* LIST (everyone) */}
      {tab === 'LIST' && (
        <section className="rounded-xl border bg-white shadow-sm ring-1 ring-gray-50 p-4">
          {loadingList ? (
            <p className="text-sm text-gray-600">Loading…</p>
          ) : policies.length === 0 ? (
            <p className="text-sm text-gray-600">No policies yet.</p>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-[480px] text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left p-2">Name</th>
                    <th className="text-left p-2">Updated</th>
                    <th className="p-2 w-40">File</th>
                  </tr>
                </thead>
                <tbody>
                  {policies.map((p) => (
                    <tr key={p.id} className="border-t">
                      <td className="p-2">{p.name}</td>
                      <td className="p-2">
                        {new Date(p.updated_at).toLocaleString(undefined, {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="p-2">
                        {p.file_path ? (
                          <button
                            className="rounded border px-3 py-1 text-xs hover:bg-gray-50"
                            onClick={() => onDownload(p)}
                          >
                            Download
                          </button>
                        ) : (
                          <span className="text-xs text-gray-500">No file</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* REVIEW (managers/company/admin) */}
      {tab === 'REVIEW' && canSeeReview && (
        <div className="space-y-4">
          <section className="rounded-xl border bg-white shadow-sm ring-1 ring-gray-50 p-4">
            <h2 className="text-base font-semibold mb-3">
              {editingId ? 'Edit policy' : 'Add a new policy'}
            </h2>
            <form onSubmit={onCreateOrUpdate} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div className="sm:col-span-2">
                <label className="block text-xs text-gray-600 mb-1">Policy name</label>
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Attach file (PDF/Doc/etc.)</label>
                <input
                  type="file"
                  className="w-full border rounded-lg px-3 py-2"
                  onChange={(e) => setFileInput(e.target.files?.[0] ?? null)}
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.rtf,image/*"
                />
              </div>
              <div className="sm:col-span-3 flex gap-2">
                <button
                  disabled={saving || !nameInput.trim() || view.status !== 'ready' || !view.selectedCompanyId}
                  className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                {editingId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(null);
                      setNameInput('');
                      setFileInput(null);
                    }}
                    className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </section>

          <section className="rounded-xl border bg-white shadow-sm ring-1 ring-gray-50 p-0">
            <div className="max-h-[28rem] overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600 sticky top-0">
                  <tr>
                    <th className="text-left p-2">Name</th>
                    <th className="text-left p-2">Updated</th>
                    <th className="p-2 w-56">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {policies.map((p) => (
                    <tr key={p.id} className="border-t align-top">
                      <td className="p-2">{p.name}</td>
                      <td className="p-2">
                        {new Date(p.updated_at).toLocaleString(undefined, {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                            onClick={() => onEdit(p)}
                          >
                            Edit
                          </button>
                          <button
                            className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                            onClick={() => onDownload(p)}
                            disabled={!p.file_path}
                            title={p.file_path ? 'Download' : 'No file attached'}
                          >
                            Download
                          </button>
                          <button
                            className="rounded border px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                            onClick={() => onDelete(p)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {policies.length === 0 && (
                    <tr>
                      <td className="p-2 text-sm text-gray-500" colSpan={3}>
                        No policies yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
