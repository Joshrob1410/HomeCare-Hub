'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/supabase/client';

type Company = {
  id: string;
  name: string;
  is_archived: boolean;
  created_at: string;
};

type Home = {
  id: string;
  company_id: string;
  name: string;
  is_archived: boolean;
  created_at: string;
};

export default function AdminCompaniesPage() {
  // Companies
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [companiesErr, setCompaniesErr] = useState<string | null>(null);

  // Selected company for homes panel
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);

  // Homes
  const [homes, setHomes] = useState<Home[]>([]);
  const [loadingHomes, setLoadingHomes] = useState(false);
  const [homesErr, setHomesErr] = useState<string | null>(null);

  // Create company
  const [newCompanyName, setNewCompanyName] = useState('');
  const [creatingCompany, setCreatingCompany] = useState(false);

  // Create home
  const [newHomeName, setNewHomeName] = useState('');
  const [creatingHome, setCreatingHome] = useState(false);

  // Edit states
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [editCompanyName, setEditCompanyName] = useState('');
  const [savingCompany, setSavingCompany] = useState(false);
  const [renameCompanyErr, setRenameCompanyErr] = useState<string | null>(null);

  const [editingHomeId, setEditingHomeId] = useState<string | null>(null);
  const [editHomeName, setEditHomeName] = useState('');
  const [savingHome, setSavingHome] = useState(false);
  const [renameHomeErr, setRenameHomeErr] = useState<string | null>(null);

  const selectedCompany = useMemo(
    () => companies.find(c => c.id === selectedCompanyId) ?? null,
    [companies, selectedCompanyId]
  );

  // Load companies
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingCompanies(true);
      setCompaniesErr(null);
      const { data, error } = await supabase
        .from('companies')
        .select('id, name, is_archived, created_at')
        .order('created_at', { ascending: true });
      if (!alive) return;
      if (error) setCompaniesErr(error.message);
      else {
        setCompanies(data ?? []);
        if (!selectedCompanyId && (data?.length ?? 0) > 0) {
          setSelectedCompanyId(data![0].id);
        }
      }
      setLoadingCompanies(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load homes for selected company
  useEffect(() => {
    let alive = true;
    if (!selectedCompanyId) { setHomes([]); return; }
    (async () => {
      setLoadingHomes(true);
      setHomesErr(null);
      const { data, error } = await supabase
        .from('homes')
        .select('id, company_id, name, is_archived, created_at')
        .eq('company_id', selectedCompanyId)
        .order('created_at', { ascending: true });
      if (!alive) return;
      if (error) setHomesErr(error.message);
      else setHomes(data ?? []);
      setLoadingHomes(false);
    })();
    return () => { alive = false; };
  }, [selectedCompanyId]);

  async function createCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!newCompanyName.trim()) return;
    setCreatingCompany(true);
    setCompaniesErr(null);

    const { data, error } = await supabase
      .from('companies')
      .insert({ name: newCompanyName.trim() })
      .select('id, name, is_archived, created_at')
      .single();

    setCreatingCompany(false);
    if (error) {
      if ((error as any).code === '23505') setCompaniesErr('A company with that name already exists.');
      else setCompaniesErr(error.message);
      return;
    }
    setCompanies(prev => [...prev, data!]);
    setNewCompanyName('');
    if (!selectedCompanyId) setSelectedCompanyId(data!.id);
  }

  async function createHome(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCompanyId || !newHomeName.trim()) return;

    setCreatingHome(true);
    setHomesErr(null);

    const { data, error } = await supabase
      .from('homes')
      .insert({ company_id: selectedCompanyId, name: newHomeName.trim() })
      .select('id, company_id, name, is_archived, created_at')
      .single();

    setCreatingHome(false);

    if (error) {
      if ((error as any).code === '23505') setHomesErr('A home with that name already exists in this company.');
      else setHomesErr(error.message);
      return;
    }
    setHomes(prev => [...prev, data!]);
    setNewHomeName('');
  }

  async function renameCompany(companyId: string, newName: string) {
    setSavingCompany(true);
    setRenameCompanyErr(null);
    try {
      const res = await fetch('/api/admin/org/company/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, name: newName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRenameCompanyErr(data?.error || `Failed (${res.status}).`);
      } else {
        setCompanies(prev => prev.map(c => c.id === companyId ? { ...c, name: data.company.name } : c));
        setEditingCompanyId(null);
        setEditCompanyName('');
      }
    } catch (e: any) {
      setRenameCompanyErr(e?.message || 'Network error.');
    } finally {
      setSavingCompany(false);
    }
  }

  async function renameHome(homeId: string, newName: string) {
    setSavingHome(true);
    setRenameHomeErr(null);
    try {
      const res = await fetch('/api/admin/org/home/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ home_id: homeId, name: newName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRenameHomeErr(data?.error || `Failed (${res.status}).`);
      } else {
        setHomes(prev => prev.map(h => h.id === homeId ? { ...h, name: data.home.name } : h));
        setEditingHomeId(null);
        setEditHomeName('');
      }
    } catch (e: any) {
      setRenameHomeErr(e?.message || 'Network error.');
    } finally {
      setSavingHome(false);
    }
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Admin · Companies & Homes</h1>

      {/* --- Companies: create + list --- */}
      <section className="space-y-4">
        <div className="rounded-xl border p-4">
          <h2 className="text-base font-semibold mb-3">Create a company</h2>
          <form onSubmit={createCompany} className="flex gap-2 max-w-lg">
            <input
              value={newCompanyName}
              onChange={(e) => setNewCompanyName(e.target.value)}
              placeholder="Company name"
              className="flex-1 border rounded-lg px-3 py-2"
              required
            />
            <button
              type="submit"
              disabled={creatingCompany}
              className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-60"
            >
              {creatingCompany ? 'Creating…' : 'Create'}
            </button>
          </form>
          {companiesErr && <p className="text-sm text-red-600 mt-2">{companiesErr}</p>}
        </div>

        <div className="space-y-3">
          <h2 className="text-base font-semibold">All companies</h2>
          {loadingCompanies ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <SkeletonCard /><SkeletonCard /><SkeletonCard />
            </div>
          ) : companies.length === 0 ? (
            <p className="text-sm text-gray-600">No companies yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {companies.map(c => {
                const isEditing = editingCompanyId === c.id;
                return (
                  <article
                    key={c.id}
                    className={`rounded-xl border p-4 transition
                                ${selectedCompanyId === c.id ? 'ring-2 ring-indigo-200 bg-indigo-50/40' : 'hover:bg-gray-50'}`}
                    onClick={(e) => {
                      // avoid card click when interacting with inputs
                      const t = e.target as HTMLElement;
                      if (t.tagName === 'INPUT' || t.tagName === 'BUTTON' || t.closest('button')) return;
                      setSelectedCompanyId(c.id);
                    }}
                  >
                    {!isEditing ? (
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-medium">{c.name}</h3>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Created {new Date(c.created_at).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {c.is_archived && <span className="text-xs rounded-full px-2 py-0.5 border bg-gray-50">Archived</span>}
                          <button
                            onClick={() => { setEditingCompanyId(c.id); setEditCompanyName(c.name); setRenameCompanyErr(null); }}
                            className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
                          >
                            Edit
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <label className="block text-xs mb-1">Company name</label>
                        <input
                          value={editCompanyName}
                          onChange={(e)=>setEditCompanyName(e.target.value)}
                          className="w-full border rounded-lg px-3 py-2 text-sm"
                          autoFocus
                        />
                        {renameCompanyErr && <p className="text-xs text-red-600">{renameCompanyErr}</p>}
                        <div className="flex gap-2">
                          <button
                            disabled={savingCompany}
                            onClick={() => renameCompany(c.id, editCompanyName)}
                            className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-60"
                          >
                            {savingCompany ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            disabled={savingCompany}
                            onClick={() => { setEditingCompanyId(null); setEditCompanyName(''); setRenameCompanyErr(null); }}
                            className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* --- Homes for the selected company --- */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold">Homes</h2>
          <CompanyPicker
            companies={companies}
            selectedCompanyId={selectedCompanyId}
            onChange={setSelectedCompanyId}
          />
        </div>

        {selectedCompany ? (
          <>
            <div className="rounded-xl border p-4">
              <h3 className="text-sm font-semibold mb-3">
                Create a home for <span className="font-bold">{selectedCompany.name}</span>
              </h3>
              <form onSubmit={createHome} className="flex gap-2 max-w-lg">
                <input
                  value={newHomeName}
                  onChange={(e) => setNewHomeName(e.target.value)}
                  placeholder="Home name"
                  className="flex-1 border rounded-lg px-3 py-2"
                  required
                />
                <button
                  type="submit"
                  disabled={creatingHome || !selectedCompanyId}
                  className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-60"
                >
                  {creatingHome ? 'Creating…' : 'Create'}
                </button>
              </form>
              {homesErr && <p className="text-sm text-red-600 mt-2">{homesErr}</p>}
            </div>

            <div className="space-y-2">
              {loadingHomes ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <SkeletonCard /><SkeletonCard /><SkeletonCard />
                </div>
              ) : homes.length === 0 ? (
                <p className="text-sm text-gray-600">No homes yet for {selectedCompany.name}.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {homes.map(h => {
                    const isEditing = editingHomeId === h.id;
                    return (
                      <article key={h.id} className="rounded-xl border p-4">
                        {!isEditing ? (
                          <div className="flex items-start justify-between">
                            <div>
                              <h4 className="font-medium">{h.name}</h4>
                              <p className="text-xs text-gray-500 mt-0.5">
                                Created {new Date(h.created_at).toLocaleString()}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {h.is_archived && (
                                <span className="text-xs rounded-full px-2 py-0.5 border bg-gray-50">Archived</span>
                              )}
                              <button
                                onClick={() => { setEditingHomeId(h.id); setEditHomeName(h.name); setRenameHomeErr(null); }}
                                className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50"
                              >
                                Edit
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <label className="block text-xs mb-1">Home name</label>
                            <input
                              value={editHomeName}
                              onChange={(e)=>setEditHomeName(e.target.value)}
                              className="w-full border rounded-lg px-3 py-2 text-sm"
                              autoFocus
                            />
                            {renameHomeErr && <p className="text-xs text-red-600">{renameHomeErr}</p>}
                            <div className="flex gap-2">
                              <button
                                disabled={savingHome}
                                onClick={() => renameHome(h.id, editHomeName)}
                                className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-60"
                              >
                                {savingHome ? 'Saving…' : 'Save'}
                              </button>
                              <button
                                disabled={savingHome}
                                onClick={() => { setEditingHomeId(null); setEditHomeName(''); setRenameHomeErr(null); }}
                                className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-600">Select a company to manage its homes.</p>
        )}
      </section>
    </div>
  );
}

function CompanyPicker({
  companies,
  selectedCompanyId,
  onChange,
}: {
  companies: Company[];
  selectedCompanyId: string | null;
  onChange: (id: string | null) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="text-gray-600">Company:</span>
      <select
        className="border rounded-lg px-2 py-1.5"
        value={selectedCompanyId ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        {companies.length === 0 && <option value="">—</option>}
        {companies.map(c => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </label>
  );
}

function SkeletonCard() {
  return <div className="h-24 rounded-xl bg-gradient-to-br from-gray-100 to-gray-50 animate-pulse" />;
}
