'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel, type AppLevel } from '@/supabase/roles';

function explainFetchError(e: any) {
    // Supabase-js usually returns structured errors, but if a gateway returned HTML,
    // we may only have a SyntaxError. This makes the message clearer.
    if (e?.name === 'SyntaxError') {
        return 'Received HTML instead of JSON from a Supabase endpoint. Check NEXT_PUBLIC_SUPABASE_URL and bucket/RPC paths.';
    }
    if (typeof e?.message === 'string') return e.message;
    try { return JSON.stringify(e); } catch { return String(e); }
}


type Payslip = {
    id: string;
    company_id: string;
    home_id: string | null;
    user_id: string;
    year: number;
    month: number;
    file_path: string;
    uploaded_by: string;
    created_at: string;
};

type HomeRow = { id: string; name: string; company_id: string };
type PersonRow = { user_id: string; full_name: string; home_id: string | null; is_bank: boolean };

function Banner({ kind, children }: { kind: 'info' | 'success' | 'error'; children: React.ReactNode }) {
    const styles = kind === 'success'
        ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
        : kind === 'error'
            ? 'bg-rose-50 text-rose-800 ring-rose-200'
            : 'bg-indigo-50 text-indigo-800 ring-indigo-200';
    return (
        <div className={`rounded-md px-3 py-2 text-sm ring-1 ${styles}`}>
            {children}
        </div>
    );
}

function IndeterminateBar() {
    return (
        <div className="h-1 w-full overflow-hidden rounded bg-gray-200">
            <div className="h-full w-1/3 animate-[indeterminate_1.2s_infinite] bg-indigo-500" />
            <style jsx>{`
        @keyframes indeterminate {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(50%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
        </div>
    );
}

function DeterminateBar({ pct }: { pct: number }) {
    return (
        <div className="h-1 w-full overflow-hidden rounded bg-gray-200">
            <div
                className="h-full bg-indigo-500 transition-[width]"
                style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
        </div>
    );
}


// --- Fast/robust upload helpers (same idea as budgets) ---
function withTimeout<T>(p: Promise<T>, ms = 20_000): Promise<T> {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('UPLOAD_TIMEOUT')), ms);
        p.then(
            (v) => { clearTimeout(t); resolve(v); },
            (e) => { clearTimeout(t); reject(e); }
        );
    });
}

async function putWithTimeout(
    url: string,
    body: Blob,
    headers: Record<string, string>,
    ms = 15_000
) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort('UPLOAD_TIMEOUT'), ms);
    try {
        const res = await fetch(url, { method: 'PUT', body, headers, signal: ac.signal });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            throw new Error(`PUT_FAILED ${res.status} ${txt}`);
        }
        return res;
    } finally {
        clearTimeout(timer);
    }
}

// PUT with progress via XHR (for determinate progress bars)
function xhrPutWithProgress(
    url: string,
    file: File | Blob,
    headers: Record<string, string>,
    onProgress?: (pct: number) => void
): Promise<void> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);

        Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));

        xhr.upload.onprogress = (e) => {
            if (!onProgress || !e.lengthComputable) return;
            onProgress(Math.round((e.loaded / e.total) * 100));
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`PUT_FAILED ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error('PUT_FAILED'));
        xhr.send(file);
    });
}

export default function PayslipsPage() {
    const [level, setLevel] = useState<AppLevel>('4_STAFF');
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<'mine' | 'upload'>('mine');

    // My list
    const [mine, setMine] = useState<Payslip[] | null>(null);

    // Upload form
    const [homes, setHomes] = useState<HomeRow[]>([]);
    const [people, setPeople] = useState<PersonRow[]>([]);
    const [selHome, setSelHome] = useState<string>('');
    const [selCompany, setSelCompany] = useState<string>('');
    const [selUser, setSelUser] = useState<string>('');
    const [year, setYear] = useState<number>(new Date().getFullYear());
    const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
    const [file, setFile] = useState<File | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const [progress, setProgress] = useState<number | null>(null);

    // Inline status banner (no popups)
    const [msg, setMsg] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null);

    // Two-step delete (no confirm())
    const [confirmDelete, setConfirmDelete] = useState(false);

    // NEW: currently-existing payslip (for selected person/month/year)
    const [existing, setExisting] = useState<Payslip | null>(null);

    // NEW: ref for file input so we can trigger it from a pretty button
    const fileInputId = 'payslip-file-input';


    const canUpload = level === '1_ADMIN' || level === '2_COMPANY';

    function monthYearLabel(y: number, m: number) {
        // Use UTC to avoid any DST/local edge cases
        const d = new Date(Date.UTC(y, m - 1, 1));
        return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    }
    function shortDate(iso: string) {
        const d = new Date(iso);
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    }

    const MONTHS = [
        { value: 1, label: 'January' },
        { value: 2, label: 'February' },
        { value: 3, label: 'March' },
        { value: 4, label: 'April' },
        { value: 5, label: 'May' },
        { value: 6, label: 'June' },
        { value: 7, label: 'July' },
        { value: 8, label: 'August' },
        { value: 9, label: 'September' },
        { value: 10, label: 'October' },
        { value: 11, label: 'November' },
        { value: 12, label: 'December' },
    ];

    const BANK_OPTION = '__BANK__';
    const COMPANY_OPTION = '__COMPANY__';

    // Filter: "All time" or a specific year
    const [yearFilter, setYearFilter] = useState<'ALL' | number>('ALL');

    // Distinct years present, newest first (computed from your data)
    const years = useMemo(() => {
        if (!mine?.length) return [];
        const set = new Set<number>(mine.map(p => p.year));
        return Array.from(set).sort((a, b) => b - a);
    }, [mine]);

    // Apply filter + sort (newest month first)
    const visiblePayslips = useMemo(() => {
        const base = mine ?? [];
        const filtered = yearFilter === 'ALL' ? base : base.filter(p => p.year === yearFilter);
        return filtered.slice().sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            return b.month - a.month;
        });
    }, [mine, yearFilter]);


    useEffect(() => {
        (async () => {
            try {
                const lvl = await getEffectiveLevel();
                setLevel(lvl);

                // My payslips (via RPC)
                const { data: rows, error } = await supabase.rpc('payslips_my_list');
                if (error) throw error;
                setMine(rows ?? []);

                // For upload tab (only fetch if they can see it)
                if (canUpload) {
                    const { data: hs, error: eh } = await supabase.rpc('homes_list_for_ui'); // id, name, company_id
                    if (eh) throw eh;
                    setHomes(hs ?? []);
                }
            } finally {
                setLoading(false);
            }
        })();
    }, [canUpload]);

    // When a home is chosen, remember company + fetch people for that company
    useEffect(() => {
        if (!selHome) return;

        let company = '';
        if (selHome === BANK_OPTION || selHome === COMPANY_OPTION) {
            // derive company from homes list
            const uniqueCompanies = Array.from(new Set(homes.map(h => h.company_id)));
            company = uniqueCompanies.length === 1 ? uniqueCompanies[0] : '';
        } else {
            const h = homes.find(x => x.id === selHome);
            company = h?.company_id ?? '';
        }

        setSelCompany(company);
        if (!company) return;

        (async () => {
            const { data, error } = await supabase.rpc('list_company_people', { p_company_id: company });
            if (error) {
                console.error(error);
                return;
            }
            setPeople(data ?? []);
        })();
    }, [selHome, homes]);

    // Check if a payslip already exists for the chosen person/month/year
    useEffect(() => {
        (async () => {
            setExisting(null);
            if (!selUser || !year || !month) return;
            const { data, error } = await supabase
                .from('payslips')
                .select('*')
                .eq('user_id', selUser)
                .eq('year', year)
                .eq('month', month)
                .maybeSingle();
            if (!error && data) setExisting(data as Payslip);
        })();
    }, [selUser, year, month]);


    // Derived: people options presented in the dropdown
    const peopleOptions = useMemo(() => {
        if (!selCompany) return [];
        if (selHome === BANK_OPTION) {
            // Only bank staff across the company
            return people.filter(p => p.is_bank);
        }
        if (selHome === COMPANY_OPTION) {
            // Only company-level (no home) and not bank
            return people.filter(p => p.home_id === null && !p.is_bank);
        }
        // Real home: only that home’s people (exclude bank and exclude company-level)
        return people.filter(p => p.home_id === selHome && !p.is_bank);
    }, [people, selHome, selCompany]);


    const monthLabel = useMemo(() => monthYearLabel(year, month), [year, month]);

    async function download(path: string) {
        const { data, error } = await supabase.storage.from('payslips').download(path);
        if (error) return console.error(error);
        const url = URL.createObjectURL(data);
        const a = document.createElement('a');
        a.href = url;
        a.download = path.split('/').pop() || 'payslip.pdf';
        a.click();
        URL.revokeObjectURL(url);
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!file || !selUser || !selCompany) return;

        setSubmitting(true);
        setMsg({ type: 'info', text: 'Uploading payslip…' });
        try {
            const safeName = file.name.replace(/\s+/g, '_');
            const path = `${selCompany}/${selUser}/${year}/${String(month).padStart(2, '0')}/${Date.now()}_${safeName}`;

            // 1) Ask storage for a one-off signed PUT URL (edge)
            const { data: signed, error: signErr } =
                await supabase.storage.from('payslips').createSignedUploadUrl(path);

            if (signErr || !signed?.signedUrl) {
                console.error('❌ createSignedUploadUrl failed', signErr);
                throw signErr ?? new Error('No signedUrl returned');
            }

            // 2) PUT directly to storage (fewer hops, faster)
            // 2) PUT directly to storage with progress
            setProgress(0);
            await xhrPutWithProgress(
                signed.signedUrl,
                file,
                {
                    'content-type': file.type || 'application/octet-stream',
                    'x-upsert': 'true',
                    'cache-control': '31536000',
                },
                (pct) => setProgress(pct)
            );

            console.log('Storage PUT ok. bucket=payslips path=', path);

            // 2) RPC link
            const link = await supabase.rpc('payslips_upload', {
                p_company: selCompany,
                p_home: selHome || null,
                p_user: selUser,
                p_year: year,
                p_month: month,
                p_path: path,
            });

            if (link.error) {
                console.error('RPC payslips_upload error:', link.error);
                throw link.error;
            }

            setExisting(link.data as Payslip);
            setFile(null);
            setMsg({ type: 'success', text: 'Payslip uploaded.' });
        } catch (err: any) {
            // Key addition: surface HTML/JSON mismatch clearly
            console.error('Upload flow failed:', err);
            setMsg({ type: 'error', text: explainFetchError(err) });
        } finally {
            setSubmitting(false);
            setProgress(null);
        }
    }


    async function handleDeleteExisting() {
        if (!existing) return;
        setMsg({ type: 'info', text: 'Deleting payslip…' });
        try {
            const del = await supabase.from('payslips').delete().eq('id', existing.id);
            if (del.error) throw del.error;
            await supabase.storage.from('payslips').remove([existing.file_path]);

            setExisting(null);
            setConfirmDelete(false);
            setMsg({ type: 'success', text: 'Payslip deleted.' });
        } catch (e: any) {
            setMsg({ type: 'error', text: e?.message || 'Failed to delete' });
        }
    }


    if (loading) return <div className="p-6">Loading…</div>;

    return (
        <div className="p-6 space-y-6">
            <h1 className="text-xl font-semibold">Payslips</h1>

            <div className="flex gap-2">
                <button
                    className={`px-3 py-1.5 rounded-md ring-1 ${tab === 'mine' ? 'bg-indigo-600 text-white ring-indigo-400' : 'bg-white text-gray-700 ring-gray-300'}`}
                    onClick={() => setTab('mine')}
                >
                    My Payslips
                </button>
                {canUpload && (
                    <button
                        className={`px-3 py-1.5 rounded-md ring-1 ${tab === 'upload' ? 'bg-violet-600 text-white ring-violet-400' : 'bg-white text-gray-700 ring-gray-300'}`}
                        onClick={() => setTab('upload')}
                    >
                        Upload Payslips
                    </button>
                )}
            </div>

            {tab === 'mine' && (
                <div className="rounded-lg border bg-white">
                    {/* Header with filter */}
                    <div className="p-3 border-b flex items-center justify-between">
                        <div className="font-medium">My payslips</div>
                        <label className="text-xs text-gray-700 flex items-center gap-2">
                            <span>Year</span>
                            <select
                                className="border rounded-md px-2 py-1 text-sm bg-white text-gray-900"
                                value={yearFilter === 'ALL' ? 'ALL' : String(yearFilter)}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    setYearFilter(v === 'ALL' ? 'ALL' : parseInt(v, 10));
                                }}
                            >
                                <option value="ALL">All time</option>
                                {years.map(y => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        </label>
                    </div>

                    {/* Body: fixed max height + scroll */}
                    {(!visiblePayslips || visiblePayslips.length === 0) ? (
                        <div className="p-6 text-sm text-gray-600">No payslips {yearFilter === 'ALL' ? 'yet.' : `for ${yearFilter}.`}</div>
                    ) : (
                        <div className="max-h-[420px] overflow-y-auto">
                            <ul className="divide-y">
                                {visiblePayslips.map(p => (
                                    <li key={p.id} className="p-4 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <span className="h-8 w-8 grid place-items-center rounded-md ring-1 ring-sky-200 bg-sky-50 text-sky-700">
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                                                    <path d="M4 7h16v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z" />
                                                    <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                                                    <path d="M8 13h8M8 17h6" />
                                                </svg>
                                            </span>
                                            <div>
                                                <div className="font-medium">
                                                    {new Date(Date.UTC(p.year, p.month - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                                                </div>
                                                <div className="text-xs text-gray-500">
                                                    Uploaded {new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => download(p.file_path)}
                                            className="text-sm rounded-md px-3 py-1.5 bg-slate-800 text-white hover:bg-slate-700"
                                        >
                                            Download
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}

            {tab === 'upload' && canUpload && (
                <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border bg-white p-4" aria-busy={submitting}>
                    {msg && <Banner kind={msg.type}>{msg.text}</Banner>}
                    {submitting && (progress !== null ? <DeterminateBar pct={progress} /> : <IndeterminateBar />)}
                    {progress !== null && (
                        <div className="text-xs text-gray-600">{progress}%</div>
                    )}
                    <div className="grid sm:grid-cols-2 gap-4">
                        {/* Home */}
                        <label className="text-sm">
                            <div className="mb-1 font-medium">Home / Category</div>
                            <select
                                className="w-full rounded-md ring-1 ring-gray-300 px-2 py-2"
                                value={selHome}
                                onChange={e => { setSelHome(e.target.value); setSelUser(''); }}
                                required
                                disabled={submitting}
                            >
                                <option value="">Select home…</option>
                                {homes.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                                <option value={BANK_OPTION}>Bank staff</option>
                                <option value={COMPANY_OPTION}>Company accounts</option>
                            </select>
                        </label>

                        {/* Person */}
                        <label className="text-sm">
                            <div className="mb-1 font-medium">Staff member / bank / manager / company</div>
                            <select
                                className="w-full rounded-md ring-1 ring-gray-300 px-2 py-2"
                                value={selUser}
                                onChange={e => setSelUser(e.target.value)}
                                required
                                disabled={!selCompany || submitting}
                            >
                                <option value="">Select person…</option>
                                {peopleOptions.map(p => (
                                    <option key={p.user_id} value={p.user_id}>
                                        {p.full_name || p.user_id.slice(0, 8)}{p.is_bank ? ' (Bank)' : ''}
                                    </option>
                                ))}
                            </select>
                        </label>

                        {/* Month by NAME */}
                        <label className="text-sm">
                            <div className="mb-1 font-medium">Month</div>
                            <select
                                className="w-full rounded-md ring-1 ring-gray-300 px-2 py-2"
                                value={month}
                                onChange={e => setMonth(parseInt(e.target.value, 10))}
                                required
                                disabled={submitting}
                            >
                                {MONTHS.map(mo => (
                                    <option key={mo.value} value={mo.value}>{mo.label}</option>
                                ))}
                            </select>
                        </label>

                        {/* Year */}
                        <label className="text-sm">
                            <div className="mb-1 font-medium">Year</div>
                            <input
                                type="number"
                                min={2000}
                                max={2100}
                                className="w-full rounded-md ring-1 ring-gray-300 px-2 py-2"
                                value={year}
                                onChange={e => setYear(parseInt(e.target.value || String(new Date().getFullYear()), 10))}
                                required
                                disabled={submitting}
                            />
                        </label>
                    </div>

                    {/* Pretty file picker */}
                    <div className="text-sm">
                        <div className="mb-1 font-medium">File</div>
                        <input
                            id={fileInputId}
                            type="file"
                            accept="application/pdf,image/*"
                            className="hidden"
                            onChange={e => setFile(e.target.files?.[0] || null)}
                            required={!existing}
                            disabled={submitting}
                        />
                        <label
                            htmlFor={fileInputId}
                            className={`block rounded-lg border-2 border-dashed border-gray-300 p-4 text-center ${submitting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}
                        >
                            {!file ? (
                                <span className="text-gray-700">
                                    Click to choose a file, or drag & drop here
                                </span>
                            ) : (
                                <span className="text-gray-900 font-medium">
                                    {file.name}
                                </span>
                            )}
                        </label>
                        <div className="mt-1 text-xs text-gray-500">Will save as: {monthLabel}</div>
                    </div>

                    {/* Existing status & actions */}
                    {selUser && (
                        <div className="rounded-md border p-3 bg-gray-50">
                            <div className="text-sm font-medium mb-1">
                                Status: {existing ? 'A payslip is already uploaded for this month' : 'No payslip found for this month'}
                            </div>
                            {existing ? (
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => download(existing.file_path)}
                                        className="rounded-md px-3 py-1.5 text-sm bg-slate-800 text-white hover:bg-slate-700"
                                    >
                                        View
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            // Focus file picker for replacement (upload will upsert)
                                            const el = document.getElementById(fileInputId) as HTMLInputElement | null;
                                            el?.click();
                                        }}
                                        className="rounded-md px-3 py-1.5 text-sm bg-indigo-600 text-white hover:bg-indigo-500"
                                    >
                                        Change
                                    </button>
                                    {!confirmDelete ? (
                                        <button
                                            type="button"
                                            onClick={() => setConfirmDelete(true)}
                                            className="rounded-md px-3 py-1.5 text-sm bg-rose-600 text-white hover:bg-rose-500"
                                        >
                                            Delete
                                        </button>
                                    ) : (
                                        <>
                                            <button
                                                type="button"
                                                onClick={handleDeleteExisting}
                                                className="rounded-md px-3 py-1.5 text-sm bg-rose-700 text-white hover:bg-rose-600"
                                            >
                                                Confirm delete
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setConfirmDelete(false)}
                                                className="rounded-md px-3 py-1.5 text-sm bg-gray-200 text-gray-800 hover:bg-gray-300"
                                            >
                                                Cancel
                                            </button>
                                        </>
                                    )}
                                </div>
                            ) : (
                                <div className="text-xs text-gray-600">
                                    When you upload, a new payslip will be created for {monthLabel}.
                                </div>
                            )}
                        </div>
                    )}

                    <div className="pt-2">
                        <button
                            type="submit"
                            disabled={submitting || !selUser || (!file && !existing)}
                            className="rounded-md px-3 py-2 bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50"
                        >
                            {submitting ? 'Uploading…' : existing ? 'Replace payslip' : 'Upload payslip'}
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
}
