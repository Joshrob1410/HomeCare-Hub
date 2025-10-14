'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel, type AppLevel } from '@/supabase/roles';

const BRAND_GRADIENT =
    'linear-gradient(135deg, #7C3AED 0%, #6366F1 50%, #3B82F6 100%)';

function explainFetchError(e: unknown): string {
    if (e && typeof e === 'object' && 'name' in e && (e as { name?: string }).name === 'SyntaxError') {
        return 'Received HTML instead of JSON from a Supabase endpoint. Check NEXT_PUBLIC_SUPABASE_URL and bucket/RPC paths.';
    }
    if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
        return (e as { message: string }).message;
    }
    try {
        return JSON.stringify(e);
    } catch {
        return String(e);
    }
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
    const base =
        kind === 'success'
            ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
            : kind === 'error'
                ? 'bg-rose-50 text-rose-800 ring-rose-200'
                : 'bg-indigo-50 text-indigo-800 ring-indigo-200';
    const orbit =
        kind === 'success'
            ? '[data-orbit="1"]:bg-emerald-500/10 [data-orbit="1"]:text-emerald-200 [data-orbit="1"]:ring-emerald-400/25'
            : kind === 'error'
                ? '[data-orbit="1"]:bg-rose-500/10 [data-orbit="1"]:text-rose-200 [data-orbit="1"]:ring-rose-400/25'
                : '[data-orbit="1"]:bg-indigo-500/10 [data-orbit="1"]:text-indigo-200 [data-orbit="1"]:ring-indigo-400/25';
    return (
        <div className={`rounded-md px-3 py-2 text-sm ring-1 ${base} ${orbit}`}>
            {children}
        </div>
    );
}

function IndeterminateBar() {
    return (
        <div className="h-1 w-full overflow-hidden rounded" style={{ background: 'var(--ring)' }}>
            <div className="h-full w-1/3 animate-[indeterminate_1.2s_infinite]" style={{ background: 'var(--brand-link)' }} />
            <style jsx>{`
        @keyframes indeterminate {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(50%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
        </div>
    );
}

function DeterminateBar({ pct }: { pct: number }) {
    return (
        <div className="h-1 w-full overflow-hidden rounded" style={{ background: 'var(--ring)' }}>
            <div
                className="h-full transition-[width]"
                style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: 'var(--brand-link)' }}
            />
        </div>
    );
}

// PUT with progress via XHR (for determinate progress bars)
function xhrPutWithProgress(
    url: string,
    file: File | Blob,
    headers: Record<string, string>,
    onProgress?: (pct: number) => void,
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

    // Two-step delete
    const [confirmDelete, setConfirmDelete] = useState(false);

    // Existing payslip (for selected person/month/year)
    const [existing, setExisting] = useState<Payslip | null>(null);

    // File input id
    const fileInputId = 'payslip-file-input';

    const canUpload = level === '1_ADMIN' || level === '2_COMPANY';

    function monthYearLabel(y: number, m: number) {
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
        const set = new Set<number>(mine.map((p) => p.year));
        return Array.from(set).sort((a, b) => b - a);
    }, [mine]);

    // Apply filter + sort (newest month first)
    const visiblePayslips = useMemo(() => {
        const base = mine ?? [];
        const filtered = yearFilter === 'ALL' ? base : base.filter((p) => p.year === yearFilter);
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
                    const { data: hs, error: eh } = await supabase.rpc('homes_list_for_ui');
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
            const uniqueCompanies = Array.from(new Set(homes.map((h) => h.company_id)));
            company = uniqueCompanies.length === 1 ? uniqueCompanies[0] : '';
        } else {
            const h = homes.find((x) => x.id === selHome);
            company = h?.company_id ?? '';
        }

        setSelCompany(company);
        if (!company) return;

        (async () => {
            const { data, error } = await supabase.rpc('list_company_people', { p_company_id: company });
            if (error) {
                // eslint-disable-next-line no-console
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
            return people.filter((p) => p.is_bank);
        }
        if (selHome === COMPANY_OPTION) {
            return people.filter((p) => p.home_id === null && !p.is_bank);
        }
        return people.filter((p) => p.home_id === selHome && !p.is_bank);
    }, [people, selHome, selCompany]);

    const monthLabel = useMemo(() => monthYearLabel(year, month), [year, month]);

    async function download(path: string) {
        const { data, error } = await supabase.storage.from('payslips').download(path);
        if (error) return; // swallow; UI stays stable
        const url = URL.createObjectURL(data);
        const a = document.createElement('a');
        a.href = url;
        a.download = path.split('/').pop() || 'payslip.pdf';
        a.click();
        URL.revokeObjectURL(url);
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!file && !existing) return;
        if (!selUser || !selCompany) return;

        setSubmitting(true);
        setMsg({ type: 'info', text: 'Uploading payslip…' });
        try {
            if (file) {
                const safeName = file.name.replace(/\s+/g, '_');
                const path = `${selCompany}/${selUser}/${year}/${String(month).padStart(2, '0')}/${Date.now()}_${safeName}`;

                // 1) Ask storage for a one-off signed PUT URL
                const { data: signed, error: signErr } =
                    await supabase.storage.from('payslips').createSignedUploadUrl(path);

                if (signErr || !signed?.signedUrl) {
                    // eslint-disable-next-line no-console
                    console.error('❌ createSignedUploadUrl failed', signErr);
                    throw signErr ?? new Error('No signedUrl returned');
                }

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
                    (pct) => setProgress(pct),
                );

                // 3) Link row via RPC
                const link = await supabase.rpc('payslips_upload', {
                    p_company: selCompany,
                    p_home: selHome || null,
                    p_user: selUser,
                    p_year: year,
                    p_month: month,
                    p_path: path,
                });

                if (link.error) {
                    // eslint-disable-next-line no-console
                    console.error('RPC payslips_upload error:', link.error);
                    throw link.error;
                }

                setExisting(link.data as Payslip);
                setFile(null);
            }

            setMsg({ type: 'success', text: 'Payslip uploaded.' });
        } catch (err: unknown) {
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
        } catch (e: unknown) {
            setMsg({ type: 'error', text: explainFetchError(e) || 'Failed to delete' });
        }
    }

    if (loading) {
        return (
            <div className="p-6" style={{ color: 'var(--sub)' }}>
                Loading…
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6" style={{ color: 'var(--ink)' }}>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)' }}>Payslips</h1>

            {/* Tabs */}
            <div className="flex gap-2">
                <button
                    className="px-3 py-1.5 rounded-md ring-1 transition"
                    style={
                        tab === 'mine'
                            ? { background: BRAND_GRADIENT, color: '#FFFFFF', borderColor: 'var(--ring-strong)' }
                            : { background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }
                    }
                    onClick={() => setTab('mine')}
                >
                    My Payslips
                </button>
                {canUpload && (
                    <button
                        className="px-3 py-1.5 rounded-md ring-1 transition"
                        style={
                            tab === 'upload'
                                ? { background: BRAND_GRADIENT, color: '#FFFFFF', borderColor: 'var(--ring-strong)' }
                                : { background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }
                        }
                        onClick={() => setTab('upload')}
                    >
                        Upload Payslips
                    </button>
                )}
            </div>

            {/* Mine */}
            {tab === 'mine' && (
                <div className="rounded-lg overflow-hidden ring-1" style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}>
                    {/* Header with filter */}
                    <div className="p-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--ring)', background: 'var(--nav-item-bg)' }}>
                        <div className="font-medium" style={{ color: 'var(--ink)' }}>My payslips</div>
                        <label className="text-xs flex items-center gap-2" style={{ color: 'var(--sub)' }}>
                            <span>Year</span>
                            <select
                                className="rounded-md px-2 py-1 text-sm ring-1"
                                // Closed control styling:
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                value={yearFilter === 'ALL' ? 'ALL' : String(yearFilter)}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    setYearFilter(v === 'ALL' ? 'ALL' : parseInt(v, 10));
                                }}
                            >
                                <option value="ALL">All time</option>
                                {years.map((y) => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        </label>
                    </div>

                    {/* Body */}
                    {(!visiblePayslips || visiblePayslips.length === 0) ? (
                        <div className="p-6 text-sm" style={{ color: 'var(--sub)' }}>
                            No payslips {yearFilter === 'ALL' ? 'yet.' : `for ${yearFilter}.`}
                        </div>
                    ) : (
                        <div className="max-h-[420px] overflow-y-auto">
                            <ul className="divide-y" style={{ borderColor: 'var(--ring)' }}>
                                {visiblePayslips.map((p) => (
                                    <li
                                        key={p.id}
                                        className="p-4 flex items-center justify-between"
                                        style={{ background: 'var(--nav-item-bg)' }}
                                    >
                                        <div className="flex items-center gap-3">
                                            <span
                                                className="h-8 w-8 grid place-items-center rounded-md ring-1"
                                                style={{
                                                    borderColor: 'var(--ring)',
                                                    background: 'var(--nav-item-bg)',
                                                    color: 'var(--brand-link)',
                                                }}
                                            >
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
                                                    <path d="M4 7h16v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z" />
                                                    <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
                                                    <path d="M8 13h8M8 17h6" />
                                                </svg>
                                            </span>
                                            <div>
                                                <div className="font-medium" style={{ color: 'var(--ink)' }}>
                                                    {new Date(Date.UTC(p.year, p.month - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                                                </div>
                                                <div className="text-xs" style={{ color: 'var(--sub)' }}>
                                                    Uploaded {shortDate(p.created_at)}
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => download(p.file_path)}
                                            className="text-sm rounded-md px-3 py-1.5 transition"
                                            style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                        >
                                            <span
                                                className="inline-flex items-center justify-center px-3 py-1.5 rounded-md ring-1"
                                                style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                            >
                                                Download
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}

            {/* Upload */}
            {tab === 'upload' && canUpload && (
                <form
                    onSubmit={handleSubmit}
                    className="space-y-4 rounded-lg p-4 ring-1"
                    aria-busy={submitting}
                    style={{ background: 'var(--card-grad)', borderColor: 'var(--ring)' }}
                >
                    {msg && <Banner kind={msg.type}>{msg.text}</Banner>}
                    {submitting && (progress !== null ? <DeterminateBar pct={progress} /> : <IndeterminateBar />)}
                    {progress !== null && (
                        <div className="text-xs" style={{ color: 'var(--sub)' }}>{progress}%</div>
                    )}

                    <div className="grid sm:grid-cols-2 gap-4">
                        {/* Home */}
                        <label className="text-sm">
                            <div className="mb-1 font-medium" style={{ color: 'var(--ink)' }}>Home / Category</div>
                            <select
                                className="w-full rounded-md px-2 py-2 ring-1"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                value={selHome}
                                onChange={(e) => { setSelHome(e.target.value); setSelUser(''); }}
                                required
                                disabled={submitting}
                            >
                                <option value="">Select home…</option>
                                {homes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                                <option value={BANK_OPTION}>Bank staff</option>
                                <option value={COMPANY_OPTION}>Company accounts</option>
                            </select>
                        </label>

                        {/* Person */}
                        <label className="text-sm">
                            <div className="mb-1 font-medium" style={{ color: 'var(--ink)' }}>Staff member / bank / manager / company</div>
                            <select
                                className="w-full rounded-md px-2 py-2 ring-1"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                value={selUser}
                                onChange={(e) => setSelUser(e.target.value)}
                                required
                                disabled={!selCompany || submitting}
                            >
                                <option value="">Select person…</option>
                                {peopleOptions.map((p) => (
                                    <option key={p.user_id} value={p.user_id}>
                                        {p.full_name || p.user_id.slice(0, 8)}{p.is_bank ? ' (Bank)' : ''}
                                    </option>
                                ))}
                            </select>
                        </label>

                        {/* Month by NAME */}
                        <label className="text-sm">
                            <div className="mb-1 font-medium" style={{ color: 'var(--ink)' }}>Month</div>
                            <select
                                className="w-full rounded-md px-2 py-2 ring-1"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                value={month}
                                onChange={(e) => setMonth(parseInt(e.target.value, 10))}
                                required
                                disabled={submitting}
                            >
                                {MONTHS.map((mo) => (
                                    <option key={mo.value} value={mo.value}>{mo.label}</option>
                                ))}
                            </select>
                        </label>

                        {/* Year */}
                        <label className="text-sm">
                            <div className="mb-1 font-medium" style={{ color: 'var(--ink)' }}>Year</div>
                            <input
                                type="number"
                                min={2000}
                                max={2100}
                                className="w-full rounded-md px-2 py-2 ring-1"
                                style={{ background: 'var(--nav-item-bg)', color: 'var(--ink)', borderColor: 'var(--ring)' }}
                                value={year}
                                onChange={(e) => setYear(parseInt(e.target.value || String(new Date().getFullYear()), 10))}
                                required
                                disabled={submitting}
                            />
                        </label>
                    </div>

                    {/* Pretty file picker */}
                    <div className="text-sm">
                        <div className="mb-1 font-medium" style={{ color: 'var(--ink)' }}>File</div>
                        <input
                            id={fileInputId}
                            type="file"
                            accept="application/pdf,image/*"
                            className="hidden"
                            onChange={(e) => setFile(e.target.files?.[0] || null)}
                            required={!existing}
                            disabled={submitting}
                        />
                        <label
                            htmlFor={fileInputId}
                            className="block rounded-lg border-2 border-dashed p-4 text-center transition"
                            style={{
                                borderColor: 'var(--ring)',
                                background: 'var(--nav-item-bg)',
                            }}
                        >
                            {!file ? (
                                <span style={{ color: 'var(--sub)' }}>
                                    Click to choose a file, or drag & drop here
                                </span>
                            ) : (
                                <span className="font-medium" style={{ color: 'var(--ink)' }}>
                                    {file.name}
                                </span>
                            )}
                        </label>
                        <div className="mt-1 text-xs" style={{ color: 'var(--sub)' }}>
                            Will save as: {monthLabel}
                        </div>
                    </div>

                    {/* Existing status & actions */}
                    {selUser && (
                        <div className="rounded-md p-3 ring-1" style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)' }}>
                            <div className="text-sm font-medium mb-1" style={{ color: 'var(--ink)' }}>
                                Status: {existing ? 'A payslip is already uploaded for this month' : 'No payslip found for this month'}
                            </div>
                            {existing ? (
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => download(existing.file_path)}
                                        className="rounded-md px-3 py-1.5 text-sm ring-1 transition"
                                        style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                    >
                                        View
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const el = document.getElementById(fileInputId) as HTMLInputElement | null;
                                            el?.click();
                                        }}
                                        className="rounded-md px-3 py-1.5 text-sm text-white transition"
                                        style={{ background: BRAND_GRADIENT }}
                                    >
                                        Change
                                    </button>
                                    {!confirmDelete ? (
                                        <button
                                            type="button"
                                            onClick={() => setConfirmDelete(true)}
                                            className="rounded-md px-3 py-1.5 text-sm text-white transition"
                                            style={{ background: '#DC2626' }}
                                        >
                                            Delete
                                        </button>
                                    ) : (
                                        <>
                                            <button
                                                type="button"
                                                onClick={handleDeleteExisting}
                                                className="rounded-md px-3 py-1.5 text-sm text-white transition"
                                                style={{ background: '#B91C1C' }}
                                            >
                                                Confirm delete
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setConfirmDelete(false)}
                                                className="rounded-md px-3 py-1.5 text-sm ring-1 transition"
                                                style={{ background: 'var(--nav-item-bg)', borderColor: 'var(--ring)', color: 'var(--ink)' }}
                                            >
                                                Cancel
                                            </button>
                                        </>
                                    )}
                                </div>
                            ) : (
                                <div className="text-xs" style={{ color: 'var(--sub)' }}>
                                    When you upload, a new payslip will be created for {monthLabel}.
                                </div>
                            )}
                        </div>
                    )}

                    <div className="pt-2">
                        <button
                            type="submit"
                            disabled={submitting || !selUser || (!file && !existing)}
                            className="rounded-md px-3 py-2 text-white transition disabled:opacity-50"
                            style={{ background: BRAND_GRADIENT }}
                        >
                            {submitting ? 'Uploading…' : existing ? 'Replace payslip' : 'Upload payslip'}
                        </button>
                    </div>
                </form>
            )}

            {/* --- Orbit-only select fixes (scoped to this page) --- */}
            <style jsx global>{`
        /* Make native popovers dark in Orbit and ensure closed state isn't washed out */
        [data-orbit="1"] select,
        [data-orbit="1"] input[type="number"],
        [data-orbit="1"] input[type="date"] {
          color-scheme: dark;
          background: var(--nav-item-bg);
          color: var(--ink);
          border-color: var(--ring);
        }
        /* Option text inside the opened dropdown menu */
        [data-orbit="1"] select option {
          color: var(--ink);
          background-color: #0b1221; /* solid fallback so options don't look transparent */
        }
        /* Firefox also respects this for the popup list */
        @-moz-document url-prefix() {
          [data-orbit="1"] select option {
            background-color: #0b1221;
          }
        }
        /* Remove the greyed-out look some UAs apply */
        [data-orbit="1"] select:where(:not(:disabled)) {
          opacity: 1;
        }
      `}</style>
        </div>
    );
}
