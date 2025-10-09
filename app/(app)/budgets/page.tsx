'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { supabase } from '@/supabase/client';
import { getEffectiveLevel, type AppLevel } from '@/supabase/roles';
import Link from 'next/link';

/** ========= Types ========= */
type Company = { id: string; name: string };
type Home = { id: string; name: string; company_id: string };
type Level = AppLevel;

type Entry = {
    id?: string;
    home_id: string;
    week_start: string;
    entry_no: number;
    date: string;
    description: string;
    method: 'CARD' | 'CASH';
    amount: number;
    yp_cash_in: number;
    is_withdrawal: boolean;
    created_by: string;
    created_by_initials: string;
    created_at?: string;
    updated_at?: string;
    receipt_path?: string | null;
};

type WeekHeader = {
    id?: string;
    home_id: string;
    week_start: string;
    cash_carried_forward: number;
    card_carried_forward: number;
    budget_issued: number;
};

type Submission = {
    id?: string;
    home_id: string;
    week_start: string;
    submitted_by: string;
    submitted_at: string;
};

/** ========= Helpers ========= */
function startOfWeekMonday(d: Date) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = x.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    x.setUTCDate(x.getUTCDate() + diff);
    return x;
}
function fmtISO(d: Date) {
    return d.toISOString().slice(0, 10);
}
function prevWeekISO(weekStartISO: string) {
    const d = new Date(weekStartISO + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - 7);
    return fmtISO(d);
}
function getInitials(name: string | null | undefined) {
    if (!name) return '--';
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
    return (first + last).toUpperCase() || first.toUpperCase() || '--';
}
function parseMoney(input: string | number): number {
    if (typeof input === 'number') return Number.isFinite(input) ? input : 0;
    const clean = (input || '').toString().replace(/[£,\s]/g, '');
    const n = parseFloat(clean);
    return Number.isFinite(n) ? n : 0;
}
function formatMoney(n: number): string {
    if (!Number.isFinite(n)) return '0.00';
    return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
}
// …existing helpers above…
function round2(n: number) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

// dd/mm/yyyy for ISO (YYYY-MM-DD)
function fmtDmy(iso: string | null | undefined) {
    if (!iso) return '';
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
}


/** ========= Fast/robust upload helpers ========= */
function withTimeout<T>(p: Promise<T>, ms = 20_000): Promise<T> {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('UPLOAD_TIMEOUT')), ms);
        p.then(
            (v) => {
                clearTimeout(t);
                resolve(v);
            },
            (e) => {
                clearTimeout(t);
                reject(e);
            }
        );
    });
}

async function putWithTimeout(url: string, body: Blob, headers: Record<string, string>, ms = 15000) {
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
}

// Compress/convert to JPEG (max 1280px) for fast upload + view (typical 120–300KB)
async function prepareImageForUpload(
    file: File
): Promise<{ blob: Blob; filename: string; contentType: string }> {
    if (file.type === 'image/jpeg' && file.size <= 800_000) {
        return { blob: file, filename: file.name, contentType: 'image/jpeg' };
    }

    const loadViaBitmap = async () => createImageBitmap(file);
    const loadViaImg = async () =>
        new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });

    let src: ImageBitmap | HTMLImageElement;
    try {
        src = await loadViaBitmap();
    } catch {
        src = await loadViaImg();
    }

    type HasWidth = { width: number };
    type HasHeight = { height: number };

    const w = 'width' in src
        ? (src as HasWidth).width
        : (src as HTMLImageElement).naturalWidth;

    const h = 'height' in src
        ? (src as HasHeight).height
        : (src as HTMLImageElement).naturalHeight;

    const maxDim = 1280;
    const scale = Math.min(1, maxDim / Math.max(w, h));
    const outW = Math.max(1, Math.round(w * scale));
    const outH = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d', { alpha: false })!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';

    ctx.drawImage(src, 0, 0, outW, outH);

    const blob: Blob = await new Promise((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', 0.76)
    );

    const filename = (file.name || 'receipt').replace(/\.[^.]+$/, '') + '.jpg';
    return { blob, filename, contentType: 'image/jpeg' };
}

/** ========= Page ========= */
export default function Page() {
    const [view, setView] = useState<
        | { status: 'loading' }
        | { status: 'signed_out' }
        | {
            status: 'ready';
            level: Level;
            uid: string;
            initials: string;
            companies: Company[];
            homes: Home[];
            selectedCompanyId: string | null;
            selectedHomeId: string | null;
            bankOnly: boolean;
        }
    >({ status: 'loading' });

    const [tab, setTab] = useState<'HOME' | 'YP' | 'COMPANY'>('HOME');

    // Week selection
    const [weekStart, setWeekStart] = useState<string>(() => fmtISO(startOfWeekMonday(new Date())));
    const prevWeekStart = useMemo(() => prevWeekISO(weekStart), [weekStart]);

    // Week header (persisted)
    const [header, setHeader] = useState<WeekHeader | null>(null);
    const [savingHeader, setSavingHeader] = useState(false);

    // Entries
    const [entries, setEntries] = useState<Entry[]>([]);
    const [loadingEntries, setLoadingEntries] = useState(false);

    // Add Entry modal
    const [showAdd, setShowAdd] = useState(false);
    const [newKind, setNewKind] = useState<'ENTRY' | 'WITHDRAWAL'>('ENTRY');
    const [newDate, setNewDate] = useState<string>(fmtISO(new Date()));
    const [newDesc, setNewDesc] = useState('');
    const [newMethod, setNewMethod] = useState<'CARD' | 'CASH'>('CARD');
    const [newAmountTxt, setNewAmountTxt] = useState<string>(''); // user-typed, no formatting
    const [newYpCashInTxt, setNewYpCashInTxt] = useState<string>(''); // user-typed, no formatting
    const [newFile, setNewFile] = useState<File | null>(null); // optional receipt on create

    // Manager submission status for current week/home
    const [submission, setSubmission] = useState<Submission | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // Company tab state
    const [companySubmissions, setCompanySubmissions] = useState<Submission[]>([]);
    const [loadingCompanySubs, setLoadingCompanySubs] = useState(false);
    const [selectedCompanySubmission, setSelectedCompanySubmission] = useState<Submission | null>(null);
    const [companyViewHeader, setCompanyViewHeader] = useState<WeekHeader | null>(null);
    const [companyViewEntries, setCompanyViewEntries] = useState<Entry[]>([]);
    const [loadingCompanyView, setLoadingCompanyView] = useState(false);

    // 🔹 NEW: company week selector (defaults to this Monday)
    const [companyWeekStart, setCompanyWeekStart] = useState<string>(() => fmtISO(startOfWeekMonday(new Date())));


    // near other useState hooks
    const [adjustMode, setAdjustMode] = useState(false);

    /** ====== Load session, role, scope (companies/homes) ====== */
    useEffect(() => {
        let mounted = true;

        const load = async () => {
            const { data: s } = await supabase.auth.getSession();
            const session = s?.session;
            if (!session) {
                if (mounted) setView({ status: 'signed_out' });
                return;
            }
            const uid = session.user.id;

            try {
                const lvl = await getEffectiveLevel();

                const fullName =
                    (session.user.user_metadata?.full_name as string | undefined) ||
                    (session.user.user_metadata?.name as string | undefined) ||
                    null;
                const initials = getInitials(fullName);

                // bank-only?
                const { data: bankRows } = await supabase
                    .from('bank_memberships')
                    .select('id')
                    .eq('user_id', uid)
                    .limit(1);

                const hasBank = !!(bankRows && bankRows.length);

                // Fetch memberships up-front
                const { data: homeRows } = await supabase
                    .from('home_memberships')
                    .select('home_id')
                    .eq('user_id', uid)
                    .limit(200);

                const { data: companyRows } = await supabase
                    .from('company_memberships')
                    .select('company_id')
                    .eq('user_id', uid)
                    .limit(50);

                let companies: Company[] = [];
                let homes: Home[] = [];

                if (lvl === '1_ADMIN') {
                    const { data: cs } = await supabase.from('companies').select('id,name').order('name');
                    const { data: hs } = await supabase.from('homes').select('id,name,company_id').order('name');
                    companies = cs ?? [];
                    homes = hs ?? [];
                } else if (lvl === '2_COMPANY') {
                    const companyIds = (companyRows ?? []).map((r) => r.company_id);
                    if (companyIds.length) {
                        const [{ data: cs }, { data: hs }] = await Promise.all([
                            supabase.from('companies').select('id,name').in('id', companyIds).order('name'),
                            supabase.from('homes').select('id,name,company_id').in('company_id', companyIds).order('name'),
                        ]);
                        companies = cs ?? [];
                        homes = hs ?? [];
                    }
                } else {
                    const { data: hs } = await supabase
                        .from('homes')
                        .select('id,name,company_id')
                        .in('id', (homeRows ?? []).map((r) => r.home_id))
                        .order('name');
                    homes = hs ?? [];
                    const companyIdsFromHomes = Array.from(new Set((homes ?? []).map((h) => h.company_id)));
                    if (companyIdsFromHomes.length) {
                        const { data: cs } = await supabase
                            .from('companies')
                            .select('id,name')
                            .in('id', companyIdsFromHomes)
                            .order('name');
                        companies = cs ?? [];
                    }
                }

                // defaults
                let selectedCompanyId: string | null = null;
                let selectedHomeId: string | null = null;

                if (lvl === '1_ADMIN') {
                    selectedCompanyId = companies[0]?.id ?? null;
                    const firstHome = homes.find((h) => h.company_id === selectedCompanyId) ?? homes[0];
                    selectedHomeId = firstHome?.id ?? null;
                } else if (lvl === '2_COMPANY') {
                    selectedCompanyId = companies[0]?.id ?? null;
                    const firstHomeInCompany = homes.find((h) => h.company_id === selectedCompanyId) ?? homes[0];
                    selectedHomeId = firstHomeInCompany?.id ?? null;
                } else {
                    selectedHomeId = homes[0]?.id ?? null;
                    selectedCompanyId = homes.find((h) => h.id === selectedHomeId)?.company_id ?? null;
                }

                if (mounted) {
                    setView({
                        status: 'ready',
                        level: lvl,
                        uid,
                        initials,
                        companies,
                        homes,
                        selectedCompanyId,
                        selectedHomeId,
                        bankOnly: hasBank && !homeRows?.length,
                    });
                }
            } catch (e) {
                console.error(e);
                if (mounted) setView({ status: 'signed_out' });
            }
        };

        load();
        return () => {
            mounted = false;
        };
    }, []);

    /** ====== Load current+previous week headers, entries & submission ====== */
    const loadWeekHeader = useCallback(async (homeId: string, wk: string) => {
        const { data, error } = await supabase
            .from('budgets_home_weeks')
            .select('*')
            .eq('home_id', homeId)
            .eq('week_start', wk)
            .maybeSingle();

        if (error) {
            console.error('❌ load budgets_home_weeks failed', error);
            return null;
        }
        return (data as WeekHeader) ?? null;
    }, []);

    const ensureCurrentHeader = useCallback(
        async (homeId: string, wk: string) => {
            const current = await loadWeekHeader(homeId, wk);
            if (current) return current;

            const blank: WeekHeader = {
                home_id: homeId,
                week_start: wk,
                cash_carried_forward: 0,
                card_carried_forward: 0,
                budget_issued: 0,
            };
            const { data, error } = await supabase.from('budgets_home_weeks').insert(blank).select('*').single();
            if (error) {
                console.error('❌ insert budgets_home_weeks failed', error);
                return null;
            }
            return data as WeekHeader;
        },
        [loadWeekHeader]
    );

    // Load headers, entries and submission status whenever home/week changes
    // derive a safe dependency for the union-typed `view`
    const selectedHomeId = view.status === 'ready' ? view.selectedHomeId : null;

    useEffect(() => {
        (async () => {
            if (view.status !== 'ready' || !view.selectedHomeId) return;

            // 1) Load or create current header
            let cur = await ensureCurrentHeader(view.selectedHomeId, weekStart);

            // 2) If current header CFs are zero, try to autofill from previous week balances
            if (cur && cur.cash_carried_forward === 0 && cur.card_carried_forward === 0) {
                const prevHeader = await loadWeekHeader(view.selectedHomeId, prevWeekStart);

                // Load previous week entries to compute balances
                const { data: prevEntries, error: prevErr } = await supabase
                    .from('budgets_home_entries')
                    .select('*')
                    .eq('home_id', view.selectedHomeId)
                    .eq('week_start', prevWeekStart);

                if (prevErr) console.error('❌ load previous entries failed', prevErr);

                const prevTotals = computeTotals(
                    (prevEntries as Entry[]) || [],
                    prevHeader?.cash_carried_forward ?? 0,
                    prevHeader?.card_carried_forward ?? 0,
                    prevHeader?.budget_issued ?? 0
                );

                cur = {
                    ...(cur as WeekHeader),
                    cash_carried_forward: round2(prevTotals.totalPettyCashBalance),
                    card_carried_forward: round2(prevTotals.totalCardBalance),
                };

                // Persist the prefill so it sticks
                const { error: updErr } = await supabase
                    .from('budgets_home_weeks')
                    .update({
                        cash_carried_forward: cur.cash_carried_forward,
                        card_carried_forward: cur.card_carried_forward,
                    })
                    .eq('home_id', cur.home_id)
                    .eq('week_start', cur.week_start);

                if (updErr) console.error('❌ prefill update budgets_home_weeks failed', updErr);
            }

            setHeader(cur);

            // 3) Load current week entries
            setLoadingEntries(true);
            const { data, error } = await supabase
                .from('budgets_home_entries')
                .select('*')
                .eq('home_id', view.selectedHomeId)
                .eq('week_start', weekStart)
                .order('entry_no', { ascending: true });

            if (error) {
                console.error('❌ load budgets_home_entries failed', error);
                setEntries([]);
            } else {
                setEntries((data ?? []) as Entry[]);
            }
            setLoadingEntries(false);

            // 4) Load submission status for this home+week
            const { data: subRow, error: subErr } = await supabase
                .from('budgets_home_submissions')
                .select('*')
                .eq('home_id', view.selectedHomeId)
                .eq('week_start', weekStart)
                .maybeSingle();

            if (subErr) {
                console.warn('⚠️ load submission failed', subErr);
                setSubmission(null);
            } else {
                const submissionRow: Submission | null = (subRow ?? null) as Submission | null;
                setSubmission(submissionRow);
            }
        })();
    }, [view.status, selectedHomeId, weekStart, prevWeekStart, ensureCurrentHeader, loadWeekHeader]);

    const isAdmin = view.status === 'ready' && view.level === '1_ADMIN';
    const isCompany = view.status === 'ready' && view.level === '2_COMPANY';
    const isManager = view.status === 'ready' && view.level === '3_MANAGER';
    const bankOnly = view.status === 'ready' && view.bankOnly;

    const canChooseCompany = isAdmin;
    const canChooseHome = isAdmin || isCompany || isManager;

    /** ====== Derived totals from entries + header figures ====== */
    const totals = useMemo(() => {
        const cashCF = header?.cash_carried_forward ?? 0;
        const cardCF = header?.card_carried_forward ?? 0;
        const budget = header?.budget_issued ?? 0;

        return computeTotals(entries, cashCF, cardCF, budget);
    }, [entries, header?.cash_carried_forward, header?.card_carried_forward, header?.budget_issued]);

    /** ====== Storage helpers for receipts ====== */
    const BUCKET = 'budgets';

    const makePath = (homeId: string, entryId: string, filename: string) => {
        const safe = filename.replace(/[^\w.\-]+/g, '_');
        return `${homeId}/${entryId}/${Date.now()}_${safe}`;
    };

    // Signed URL cache so "View" is instant after the first time
    const signedCache = useRef<Map<string, { url: string; exp: number }>>(new Map());
    const signUrl = useCallback(async (path: string, ttlSec = 3600) => {
        const now = Date.now();
        const cached = signedCache.current.get(path);
        if (cached && cached.exp > now + 5_000) return cached.url;

        const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, ttlSec);
        if (error) {
            console.error('❌ createSignedUrl failed', error);
            return null;
        }
        const url = data?.signedUrl ?? null;
        if (url) signedCache.current.set(path, { url, exp: now + ttlSec * 1000 });
        return url;
    }, []);

    const uploadReceipt = useCallback(
        async (e: Entry, file: File) => {
            if (!e.id) return { ok: false, path: null as string | null };

            // 1) Downscale & convert (fast view, small upload)
            let prepared: { blob: Blob; filename: string; contentType: string };
            try {
                prepared = await prepareImageForUpload(file);
            } catch (err) {
                console.error('❌ image preparation failed', err);
                return { ok: false, path: null as string | null };
            }

            const path = makePath(e.home_id, e.id, prepared.filename);

            try {
                // 2) Ask Storage for a one-off signed PUT url (edge)
                const { data: signed, error: signErr } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
                if (signErr || !signed?.signedUrl) {
                    console.error('❌ createSignedUploadUrl failed', signErr);
                    return { ok: false, path: null as string | null };
                }

                // 3) PUT directly to Storage with a short timeout
                await putWithTimeout(
                    signed.signedUrl,
                    prepared.blob,
                    {
                        'content-type': prepared.contentType,
                        'x-upsert': 'true',
                        'cache-control': '31536000',
                    },
                    15000
                );

                // 4) Persist path on the row
                const { error: dbErr } = await supabase.from('budgets_home_entries').update({ receipt_path: path }).eq('id', e.id);
                if (dbErr) throw dbErr;

                // 5) Update UI & warm the signed URL cache for instant "View"
                setEntries((prev) => prev.map((x) => (x.id === e.id ? { ...x, receipt_path: path } : x)));
                await signUrl(path, 3600 * 6); // 6h

                return { ok: true, path };
            } catch (err) {
                console.error('❌ upload/update failed', err);
                try {
                    await supabase.storage.from(BUCKET).remove([path]);
                } catch { }
                return { ok: false, path: null as string | null };
            }
        },
        [signUrl]
    );

    const removeReceipt = useCallback(async (e: Entry) => {
        if (!e.id || !e.receipt_path) return;
        const toRemove = e.receipt_path;

        const { error: delErr } = await supabase.storage.from(BUCKET).remove([toRemove]);
        if (delErr) {
            console.warn('⚠️ storage remove issue (continuing):', delErr.message);
        }

        const { error: dbErr } = await supabase.from('budgets_home_entries').update({ receipt_path: null }).eq('id', e.id);

        if (dbErr) {
            console.error('❌ clear receipt_path failed', dbErr);
            return;
        }

        signedCache.current.delete(toRemove);
        setEntries((prev) => prev.map((x) => (x.id === e.id ? { ...x, receipt_path: null } : x)));
    }, []);

    /** ====== Actions ====== */
    const nextEntryNo = useMemo(() => {
        return entries.length ? Math.max(...entries.map((e) => e.entry_no)) + 1 : 1;
    }, [entries]);

    const saveHeader = useCallback(
        async (patch: Partial<WeekHeader>) => {
            if (!header || view.status !== 'ready') return;
            const upd: WeekHeader = { ...header, ...patch };
            setHeader(upd);
            setSavingHeader(true);
            const { error } = await supabase
                .from('budgets_home_weeks')
                .update({
                    cash_carried_forward: upd.cash_carried_forward,
                    card_carried_forward: upd.card_carried_forward,
                    budget_issued: upd.budget_issued,
                })
                .eq('home_id', upd.home_id)
                .eq('week_start', upd.week_start);
            setSavingHeader(false);
            if (error) console.error('❌ update budgets_home_weeks failed', error);
        },
        [header, view.status]
    );

    // ✅ Derive safe, narrowed values for deps (avoid union-property access in deps)
    const selectedHomeIdDep = view.status === 'ready' ? view.selectedHomeId : null;
    const uidDep = view.status === 'ready' ? view.uid : null;
    const initialsDep = view.status === 'ready' ? view.initials : '';

    const onAddEntry = useCallback(
        async () => {
            // Keep the original guard, but use the derived id for clarity.
            if (view.status !== 'ready' || !selectedHomeIdDep) return;
            if (!uidDep) return; // uid exists when status === 'ready'; this is a safe, explicit guard.

            const amount = parseMoney(newAmountTxt);
            const ypIn = newKind === 'WITHDRAWAL' ? 0 : parseMoney(newYpCashInTxt);

            const desc =
                newKind === 'WITHDRAWAL'
                    ? newDesc.trim() || `Withdrawal (card) £${formatMoney(amount)}`
                    : newDesc.trim();

            const payload: Entry = {
                home_id: selectedHomeIdDep,
                week_start: weekStart,
                entry_no: nextEntryNo,
                date: newDate,
                description: desc,
                method: newKind === 'WITHDRAWAL' ? 'CARD' : newMethod,
                amount,
                yp_cash_in: ypIn,
                is_withdrawal: newKind === 'WITHDRAWAL',
                created_by: uidDep,
                created_by_initials: initialsDep,
            };

            const { data, error } = await supabase
                .from('budgets_home_entries')
                .insert(payload)
                .select('*')
                .single();

            if (error) {
                console.error('❌ insert budgets_home_entries failed', error);
                return;
            }

            let created = data as Entry;

            if (newFile) {
                const res = await uploadReceipt(created, newFile);
                // ✅ remove non-null assertion; guard path before using it
                if (res.ok && res.path) {
                    created = { ...created, receipt_path: res.path };
                }
            }

            setEntries((prev) => [...prev, created].sort((a, b) => a.entry_no - b.entry_no));
            setShowAdd(false);
            setNewKind('ENTRY');
            setNewDate(fmtISO(new Date()));
            setNewDesc('');
            setNewMethod('CARD');
            setNewAmountTxt('');
            setNewYpCashInTxt('');
            setNewFile(null);
        },
        [
            // ✅ use derived, safely-typed deps instead of `view.selectedHomeId | uid | initials`
            view.status,
            selectedHomeIdDep,
            uidDep,
            initialsDep,
            weekStart,
            nextEntryNo,
            newDate,
            newDesc,
            newMethod,
            newAmountTxt,
            newYpCashInTxt,
            newKind,
            newFile,
            uploadReceipt,
        ]
    );


    const updateEntry = useCallback(async (e: Entry, patch: Partial<Entry>) => {
        if (!e.id) return;

        // Normalize possible string inputs to numbers without using `any`
        const normalized: Partial<Entry> = { ...patch };
        if (typeof normalized.amount === 'string') {
            normalized.amount = parseMoney(normalized.amount);
        }
        if (typeof normalized.yp_cash_in === 'string') {
            normalized.yp_cash_in = parseMoney(normalized.yp_cash_in);
        }

        // Merge only defined fields to keep the final type strictly Entry
        const upd: Entry = {
            ...e,
            ...(normalized.date !== undefined ? { date: normalized.date } : {}),
            ...(normalized.description !== undefined ? { description: normalized.description } : {}),
            ...(normalized.method !== undefined ? { method: normalized.method } : {}),
            ...(normalized.amount !== undefined ? { amount: normalized.amount } : {}),
            ...(normalized.yp_cash_in !== undefined ? { yp_cash_in: normalized.yp_cash_in } : {}),
            ...(normalized.is_withdrawal !== undefined ? { is_withdrawal: normalized.is_withdrawal } : {}),
            ...(normalized.receipt_path !== undefined ? { receipt_path: normalized.receipt_path } : {}),
        };

        setEntries((prev) => prev.map((x) => (x.id === e.id ? upd : x)));

        const { error } = await supabase
            .from('budgets_home_entries')
            .update({
                date: upd.date,
                description: upd.description,
                method: upd.method,
                amount: upd.amount,
                yp_cash_in: upd.yp_cash_in,
                is_withdrawal: upd.is_withdrawal,
            })
            .eq('id', e.id);

        if (error) {
            console.error('❌ update budgets_home_entries failed', error);
            setEntries((prev) => prev.map((x) => (x.id === e.id ? e : x))); // revert
        }
    }, []);


    const deleteEntry = useCallback(
        async (e: Entry) => {
            if (!e.id) return;
            const prev = entries;

            if (e.receipt_path) {
                try {
                    await supabase.storage.from(BUCKET).remove([e.receipt_path]);
                } catch (er: unknown) {
                    const msg = er instanceof Error ? er.message : String(er);
                    console.warn('⚠️ receipt remove during deleteEntry:', msg);
                }
            }

            setEntries(prev.filter((x) => x.id !== e.id));

            const { error } = await supabase.from('budgets_home_entries').delete().eq('id', e.id);

            if (error) {
                console.error('❌ delete budgets_home_entries failed', error);
                setEntries(prev); // revert
            }
        },
        [entries]
    );


    /** ====== Submit current week (Managers only) ====== */
    // Derive narrowed values once per render (safe for deps)

    const submitCurrentWeek = useCallback(async () => {
        if (view.status !== 'ready' || !selectedHomeIdDep || !uidDep) return;

        setSubmitting(true);
        try {
            const { data, error } = await supabase
                .from('budgets_home_submissions')
                .upsert(
                    { home_id: selectedHomeIdDep, week_start: weekStart, submitted_by: uidDep },
                    { onConflict: 'home_id,week_start' }
                )
                .select('*')
                .single();

            if (error) {
                console.error('❌ submit failed', error);
                return;
            }

            const row: Submission = data as Submission;
            setSubmission(row);
        } finally {
            setSubmitting(false);
        }
    }, [view.status, selectedHomeIdDep, uidDep, weekStart]);


    /** ====== Company tab: load submissions list and selected view ====== */
    const homesForSelectedCompany = useMemo(() => {
        if (view.status !== 'ready') return [];
        if (!view.selectedCompanyId) return view.homes;
        return view.homes.filter((h) => h.company_id === view.selectedCompanyId);
    }, [view]);

    // Narrow union-only fields once per render for safe deps
    const selectedCompanyIdDep = view.status === 'ready' ? view.selectedCompanyId : null;
    // Stable ids array for deps
    const homeIds = useMemo(() => homesForSelectedCompany.map((h) => h.id), [homesForSelectedCompany]);

    useEffect(() => {
        (async () => {
            if (tab !== 'COMPANY' || !selectedCompanyIdDep) return;

            if (homeIds.length === 0) {
                setCompanySubmissions([]);
                setSelectedCompanySubmission(null);
                return;
            }

            setLoadingCompanySubs(true);
            try {
                // 🔹 Only fetch submissions for the selected week
                const { data, error } = await supabase
                    .from('budgets_home_submissions')
                    .select('*')
                    .in('home_id', homeIds)
                    .eq('week_start', companyWeekStart) // ← match the chosen week
                    .order('submitted_at', { ascending: false });

                if (error) {
                    console.error('❌ load company submissions failed', error);
                    setCompanySubmissions([]);
                    return;
                }

                const subs: Submission[] = (data ?? []) as Submission[];
                setCompanySubmissions(subs);

                // 🔹 Auto-select first for convenience
                if (subs.length) {
                    setSelectedCompanySubmission(subs[0]);
                } else {
                    setSelectedCompanySubmission(null);
                    setCompanyViewEntries([]);
                    setCompanyViewHeader(null);
                }
            } finally {
                setLoadingCompanySubs(false);
            }
        })();
    }, [tab, selectedCompanyIdDep, homeIds, companyWeekStart]);


    useEffect(() => {
        (async () => {
            if (!selectedCompanySubmission) return;
            setLoadingCompanyView(true);
            const { home_id, week_start } = selectedCompanySubmission;

            const [{ data: hdr }, { data: ents }] = await Promise.all([
                supabase
                    .from('budgets_home_weeks')
                    .select('*')
                    .eq('home_id', home_id)
                    .eq('week_start', week_start)
                    .maybeSingle(),
                supabase
                    .from('budgets_home_entries')
                    .select('*')
                    .eq('home_id', home_id)
                    .eq('week_start', week_start)
                    .order('entry_no', { ascending: true }),
            ]);

            const header: WeekHeader | null = (hdr ?? null) as WeekHeader | null;
            const entries: Entry[] = (ents ?? []) as Entry[];

            setCompanyViewHeader(header);
            setCompanyViewEntries(entries);
            setLoadingCompanyView(false);
        })();
    }, [selectedCompanySubmission]);

    /** ====== UI ====== */
    const homesForCompany = useMemo(() => {
        if (view.status !== 'ready') return [];

        const { level, homes, selectedCompanyId } = view;

        if (level === '1_ADMIN') {
            if (!selectedCompanyId) return homes;
            return homes.filter((h) => h.company_id === selectedCompanyId);
        }
        return homes;
    }, [view]);

    // Guards
    if (view.status === 'signed_out') return null;
    if (view.status === 'loading') return <div className="p-4 md:p-6">Loading budgets...</div>;
    if (bankOnly) {
        return (
            <div className="p-4 md:p-6">
                <h1 className="text-xl md:text-2xl font-semibold mb-2">Budgets</h1>
                <p className="text-sm text-gray-700">Bank staff do not have access to Budgets.</p>
            </div>
        );
    }

    const showCompanyTab = isAdmin || isCompany;

    return (
        <div className="p-4 md:p-6 space-y-6 [color-scheme:light]">
            {/* Tabs */}
            <div className="flex gap-3 border-b">
                <button
                    className={`px-3 py-2 text-sm md:text-base ${tab === 'HOME' ? 'border-b-2 border-indigo-600 font-medium' : 'text-gray-700'}`}
                    onClick={() => setTab('HOME')}
                >
                    Home
                </button>
                <button
                    className={`px-3 py-2 text-sm md:text-base ${tab === 'YP' ? 'border-b-2 border-indigo-600 font-medium' : 'text-gray-700'}`}
                    onClick={() => setTab('YP')}
                >
                    Young People
                </button>
                {showCompanyTab && (
                    <button
                        className={`px-3 py-2 text-sm md:text-base ${tab === 'COMPANY' ? 'border-b-2 border-indigo-600 font-medium' : 'text-gray-700'}`}
                        onClick={() => setTab('COMPANY')}
                    >
                        Company
                    </button>
                )}
            </div>

            {tab === 'HOME' ? (
                <>
                    {/* Scope + Week selectors */}
                    <div className="grid grid-cols-1 xs:grid-cols-2 md:flex md:flex-wrap md:items-end gap-3 md:gap-4">
                        {canChooseCompany && (
                            <div className="min-w-[200px]">
                                <label className="block text-xs text-gray-700 mb-1">Company</label>
                                <select
                                    className="border rounded-md px-2 py-2 text-sm w-full bg-white text-gray-900"
                                    value={view.selectedCompanyId ?? ''}
                                    onChange={(e) => {
                                        const id = e.target.value || null;
                                        setView((v) => (v.status !== 'ready' ? v : { ...v, selectedCompanyId: id, selectedHomeId: null }));
                                    }}
                                >
                                    {view.companies.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {canChooseHome && (
                            <div className="min-w-[200px]">
                                <label className="block text-xs text-gray-700 mb-1">Home</label>
                                <select
                                    className="border rounded-md px-2 py-2 text-sm w-full bg-white text-gray-900"
                                    value={view.selectedHomeId ?? ''}
                                    onChange={(e) => {
                                        const id = e.target.value || null;
                                        setView((v) => (v.status !== 'ready' ? v : { ...v, selectedHomeId: id }));
                                    }}
                                >
                                    {homesForCompany.map((h) => (
                                        <option key={h.id} value={h.id}>
                                            {h.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div>
                            <label className="block text-xs text-gray-700 mb-1">Week (Mon - Sun)</label>
                            <div className="flex items-stretch gap-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        const d = new Date(weekStart + 'T00:00:00Z');
                                        d.setUTCDate(d.getUTCDate() - 7);
                                        setWeekStart(fmtISO(d));
                                    }}
                                    className="h-9 w-9 inline-flex items-center justify-center rounded-md border bg-white text-gray-900 active:scale-[0.98]"
                                    title="Previous week"
                                    aria-label="Previous week"
                                >
                                    ←
                                </button>

                                <input
                                    type="date"
                                    className="border rounded-md px-2 py-2 text-sm bg-white text-gray-900"
                                    value={weekStart}
                                    onChange={(e) => {
                                        const d = new Date(e.target.value + 'T00:00:00Z');
                                        setWeekStart(fmtISO(startOfWeekMonday(d)));
                                    }}
                                />

                                <button
                                    type="button"
                                    onClick={() => {
                                        const d = new Date(weekStart + 'T00:00:00Z');
                                        d.setUTCDate(d.getUTCDate() + 7);
                                        setWeekStart(fmtISO(d));
                                    }}
                                    className="h-9 w-9 inline-flex items-center justify-center rounded-md border bg-white text-gray-900 active:scale-[0.98]"
                                    title="Next week"
                                    aria-label="Next week"
                                >
                                    →
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setWeekStart(fmtISO(startOfWeekMonday(new Date())))}
                                    className="inline-flex items-center rounded-md border px-2 py-2 text-xs bg-white text-gray-900 active:scale-[0.98]"
                                    title="Jump to current week"
                                >
                                    Today
                                </button>
                            </div>
                            <p className="text-[11px] text-gray-600 mt-1">Auto-adjusts to the Monday of the selected week.</p>
                        </div>

                        <div className="md:flex-1" />

                        {/* Manager-only submit button */}
                        {isManager && (
                            <button
                                className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 text-white text-sm px-3 py-2 hover:bg-emerald-700 active:scale-[0.99] w-full md:w-auto md:self-end"
                                onClick={submitCurrentWeek}
                                disabled={!view.selectedHomeId || submitting}
                                title="Submit this week's budget for company review"
                            >
                                {submission ? 'Submitted' : submitting ? 'Submitting…' : 'Submit week for review'}
                            </button>
                        )}

                        <button
                            className="inline-flex items-center justify-center gap-2 rounded-md bg-indigo-600 text-white text-sm px-3 py-2 hover:bg-indigo-700 active:scale-[0.99] w-full md:w-auto md:self-end md:ml-2"
                            onClick={() => {
                                setNewKind('ENTRY');
                                setNewDate(fmtISO(new Date()));
                                setNewDesc('');
                                setNewMethod('CARD');
                                setNewAmountTxt('');
                                setNewYpCashInTxt('');
                                setNewFile(null);
                                setShowAdd(true);
                            }}
                            disabled={!view.selectedHomeId}
                        >
                            Create Entry
                        </button>
                    </div>

                    {/* Adjust amounts toggle */}
                    <div className="mt-2 flex items-center gap-3">
                        <button
                            type="button"
                            role="switch"
                            aria-checked={adjustMode}
                            onClick={() => setAdjustMode(!adjustMode)}
                            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${adjustMode ? 'bg-green-500' : 'bg-gray-300'
                                } focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
                            title="Adjust amounts (first-time setup or corrections)"
                        >
                            <span
                                className={`inline-block h-6 w-6 transform rounded-full bg-white shadow transition-transform ${adjustMode ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                            />
                        </button>
                        <span className="text-sm font-medium select-none text-gray-900">Adjust amounts</span>
                        {adjustMode && (
                            <span className="text-xs px-2 py-1 rounded bg-amber-50 text-amber-800 border border-amber-200">
                                Only use for first-time setup or necessary corrections.
                            </span>
                        )}
                    </div>

                    {/* Summary strip (persisted) */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 pt-2">
                        {adjustMode ? (
                            <SummaryMoneyInput
                                label="Cash Carried Forward"
                                value={header?.cash_carried_forward ?? 0}
                                onCommit={(v) => saveHeader({ cash_carried_forward: v })}
                                saving={savingHeader}
                            />
                        ) : (
                            <SummaryMoneyReadonly label="Cash Carried Forward" value={header?.cash_carried_forward ?? 0} />
                        )}

                        {adjustMode ? (
                            <SummaryMoneyInput
                                label="Card Carried Forward"
                                value={header?.card_carried_forward ?? 0}
                                onCommit={(v) => saveHeader({ card_carried_forward: v })}
                                saving={savingHeader}
                            />
                        ) : (
                            <SummaryMoneyReadonly label="Card Carried Forward" value={header?.card_carried_forward ?? 0} />
                        )}

                        <SummaryMoneyReadonly
                            label="Total Brought Forward"
                            value={round2((header?.cash_carried_forward ?? 0) + (header?.card_carried_forward ?? 0))}
                        />

                        <SummaryMoneyInput
                            label="Budget Issued"
                            value={header?.budget_issued ?? 0}
                            onCommit={(v) => saveHeader({ budget_issued: v })}
                            saving={savingHeader}
                        />

                        <SummaryMoneyReadonly label="YP Cash In Total" value={round2(totals.ypIn)} />
                        <SummaryMoneyReadonly label="Total Cash Withdrawn" value={round2(totals.cashWithdrawn)} />
                        <SummaryMoneyReadonly label="Total Petty Cash Balance" value={round2(totals.totalPettyCashBalance)} />
                        <SummaryMoneyReadonly label="Total Card Balance" value={round2(totals.totalCardBalance)} />
                    </div>

                    {/* Entries - Desktop table */}
                    <div className="hidden md:block mt-4 border rounded-lg overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm min-w-[1000px]">
                                <thead className="bg-gray-50">
                                    <tr className="text-left">
                                        <Th>#</Th>
                                        <Th>Date</Th>
                                        <Th>Description</Th>
                                        <Th>Method</Th>
                                        <Th className="text-right">Amount</Th>
                                        <Th className="text-right">YP Cash In</Th>
                                        <Th>Initials</Th>
                                        <Th>Receipt</Th>
                                        <Th className="text-right">
                                            <span className="sr-only">Actions</span>
                                        </Th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white">
                                    {loadingEntries ? (
                                        <tr>
                                            <td colSpan={9} className="p-3 text-center text-gray-700">
                                                Loading...
                                            </td>
                                        </tr>
                                    ) : entries.length === 0 ? (
                                        <tr>
                                            <td colSpan={9} className="p-6 text-center text-gray-700">
                                                No entries for this week.
                                            </td>
                                        </tr>
                                    ) : (
                                        entries.map((e) => (
                                            <tr key={e.id ?? e.entry_no} className="border-t">
                                                <Td>{e.entry_no}</Td>
                                                <Td>
                                                    <input
                                                        type="date"
                                                        className="border rounded-md px-2 py-2 text-sm bg-white text-gray-900"
                                                        value={e.date}
                                                        onChange={(ev) => updateEntry(e, { date: ev.target.value })}
                                                    />
                                                </Td>
                                                <Td>
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="text"
                                                            className="border rounded px-2 py-1 w-full bg-white text-gray-900"
                                                            value={e.description}
                                                            onChange={(ev) => updateEntry(e, { description: ev.target.value })}
                                                        />
                                                        {e.is_withdrawal && (
                                                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                                                                Withdrawal
                                                            </span>
                                                        )}
                                                    </div>
                                                </Td>
                                                <Td>
                                                    {e.is_withdrawal ? (
                                                        <span className="inline-flex items-center rounded px-2 py-1 text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                                                            Card
                                                        </span>
                                                    ) : (
                                                        <select
                                                            className="border rounded-md px-2 py-2 text-sm w-full bg-white text-gray-900"
                                                            value={e.method}
                                                            onChange={(ev) => updateEntry(e, { method: ev.target.value as Entry['method'] })}
                                                        >
                                                            <option value="CARD">Card</option>
                                                            <option value="CASH">Cash</option>
                                                        </select>
                                                    )}
                                                </Td>
                                                <Td className="text-right">
                                                    <MoneyInline value={e.amount} onChange={(v) => updateEntry(e, { amount: v })} />
                                                </Td>
                                                <Td className="text-right">
                                                    <MoneyInline value={e.yp_cash_in} onChange={(v) => updateEntry(e, { yp_cash_in: v })} />
                                                </Td>
                                                <Td>{e.created_by_initials || '--'}</Td>
                                                <Td>
                                                    <ReceiptCell
                                                        entry={e}
                                                        onUpload={uploadReceipt}
                                                        onRemove={removeReceipt}
                                                        onPreview={async (path) => {
                                                            const url = await signUrl(path);
                                                            if (url) window.open(url, '_blank', 'noopener,noreferrer');
                                                        }}
                                                    />
                                                </Td>
                                                <Td className="text-right">
                                                    <button className="text-red-600 hover:underline" onClick={() => deleteEntry(e)}>
                                                        Delete
                                                    </button>
                                                </Td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Entries - Mobile cards */}
                    <div className="md:hidden space-y-3 mt-4">
                        {loadingEntries ? (
                            <div className="p-3 text-center text-gray-700 border rounded-lg bg-white">Loading...</div>
                        ) : entries.length === 0 ? (
                            <div className="p-4 text-center text-gray-700 border rounded-lg bg-white">No entries for this week.</div>
                        ) : (
                            entries.map((e) => (
                                <div key={e.id ?? e.entry_no} className="border rounded-lg p-3 bg-white">
                                    <div className="flex items-center justify-between">
                                        <div className="text-xs text-gray-600">#{e.entry_no}</div>
                                        {e.is_withdrawal && (
                                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                                                Withdrawal
                                            </span>
                                        )}
                                    </div>

                                    <div className="mt-2 grid grid-cols-2 gap-2">
                                        <label className="text-xs text-gray-700">Date</label>
                                        <input
                                            type="date"
                                            className="border rounded-md px-2 py-2 text-sm bg-white text-gray-900"
                                            value={e.date}
                                            onChange={(ev) => updateEntry(e, { date: ev.target.value })}
                                        />

                                        <label className="text-xs text-gray-700 col-span-2">Description</label>
                                        <input
                                            type="text"
                                            className="border rounded px-2 py-2 text-sm bg-white text-gray-900 col-span-2"
                                            value={e.description}
                                            onChange={(ev) => updateEntry(e, { description: ev.target.value })}
                                        />

                                        <label className="text-xs text-gray-700">Method</label>
                                        {e.is_withdrawal ? (
                                            <span className="inline-flex items-center justify-center rounded px-2 py-1 text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                                                Card
                                            </span>
                                        ) : (
                                            <select
                                                className="border rounded-md px-2 py-2 text-sm w-full bg-white text-gray-900"
                                                value={e.method}
                                                onChange={(ev) => updateEntry(e, { method: ev.target.value as Entry['method'] })}
                                            >
                                                <option value="CARD">Card</option>
                                                <option value="CASH">Cash</option>
                                            </select>
                                        )}

                                        <label className="text-xs text-gray-700">Amount</label>
                                        <div>
                                            <MoneyInline value={e.amount} onChange={(v) => updateEntry(e, { amount: v })} />
                                        </div>

                                        <label className="text-xs text-gray-700">YP Cash In</label>
                                        <div>
                                            <MoneyInline value={e.yp_cash_in} onChange={(v) => updateEntry(e, { yp_cash_in: v })} />
                                        </div>

                                        <label className="text-xs text-gray-700">Initials</label>
                                        <div className="text-sm text-gray-900">{e.created_by_initials || '--'}</div>

                                        <label className="text-xs text-gray-700">Receipt</label>
                                        <div>
                                            <ReceiptCell
                                                entry={e}
                                                onUpload={uploadReceipt}
                                                onRemove={removeReceipt}
                                                onPreview={async (path) => {
                                                    const url = await signUrl(path);
                                                    if (url) window.open(url, '_blank', 'noopener,noreferrer');
                                                }}
                                                compact
                                            />
                                        </div>
                                    </div>

                                    <div className="mt-3 flex justify-end">
                                        <button className="text-red-600 text-sm" onClick={() => deleteEntry(e)}>
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Add Entry modal */}
                    {showAdd && (
                        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-3">
                            <div className="bg-white rounded-xl p-4 w-[560px] max-w-[92vw] shadow-lg">
                                <h3 className="text-lg font-semibold mb-3">Create Entry</h3>

                                {/* Segmented control */}
                                <div className="inline-flex rounded-lg border overflow-hidden mb-4">
                                    <button
                                        className={`px-3 py-1.5 text-sm ${newKind === 'ENTRY' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-900'}`}
                                        onClick={() => setNewKind('ENTRY')}
                                    >
                                        Entry
                                    </button>
                                    <button
                                        className={`px-3 py-1.5 text-sm ${newKind === 'WITHDRAWAL' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-900'}`}
                                        onClick={() => setNewKind('WITHDRAWAL')}
                                    >
                                        Withdrawal
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-xs text-gray-700 mb-1">Date</label>
                                        <input
                                            type="date"
                                            className="border rounded-md px-2 py-2 text-sm bg-white text-gray-900"
                                            value={newDate}
                                            onChange={(e) => setNewDate(e.target.value)}
                                        />
                                    </div>

                                    {newKind === 'ENTRY' && (
                                        <div>
                                            <label className="block text-xs text-gray-700 mb-1">Method</label>
                                            <select
                                                className="border rounded-md px-2 py-2 text-sm w-full bg-white text-gray-900"
                                                value={newMethod}
                                                onChange={(e) => setNewMethod(e.target.value as 'CARD' | 'CASH')}
                                            >
                                                <option value="CARD">Card</option>
                                                <option value="CASH">Cash</option>
                                            </select>
                                        </div>
                                    )}

                                    <div className={newKind === 'WITHDRAWAL' ? 'sm:col-span-2' : ''}>
                                        <label className="block text-xs text-gray-700 mb-1">
                                            {newKind === 'WITHDRAWAL' ? 'Withdrawal Amount' : 'Amount'}
                                        </label>
                                        <MoneyText value={newAmountTxt} onChange={setNewAmountTxt} placeholder="£0.00" />
                                    </div>

                                    {newKind === 'ENTRY' && (
                                        <div>
                                            <label className="block text-xs text-gray-700 mb-1">YP Cash In</label>
                                            <MoneyText value={newYpCashInTxt} onChange={setNewYpCashInTxt} placeholder="£0.00" />
                                            <p className="text-[11px] text-gray-600 mt-1">
                                                Use when spend should have come from the young persons cash.
                                            </p>
                                        </div>
                                    )}

                                    <div className="sm:col-span-2">
                                        <label className="block text-xs text-gray-700 mb-1">Description</label>
                                        <input
                                            type="text"
                                            className="border rounded px-2 py-2 w-full bg-white text-gray-900"
                                            value={newDesc}
                                            onChange={(e) => setNewDesc(e.target.value)}
                                            placeholder={newKind === 'WITHDRAWAL' ? 'Withdrawal (card) £...' : 'e.g., Groceries, activity, etc.'}
                                        />
                                    </div>

                                    {/* Optional photo */}
                                    <div className="sm:col-span-2">
                                        <label className="block text-xs text-gray-700 mb-1">Attach photo (optional)</label>
                                        <input
                                            type="file"
                                            accept="image/*"
                                            capture="environment"
                                            className="border rounded-md px-2 py-2 text-sm w-full bg-white text-gray-900"
                                            onChange={(e) => setNewFile(e.target.files?.[0] ?? null)}
                                        />
                                        {newFile && <p className="text-[11px] text-gray-600 mt-1">Selected: {newFile.name}</p>}
                                    </div>
                                </div>

                                <div className="mt-4 flex flex-col sm:flex-row justify-end gap-2">
                                    <button className="px-3 py-2 text-sm rounded-md border bg-white text-gray-900" onClick={() => setShowAdd(false)}>
                                        Cancel
                                    </button>
                                    <button
                                        className="px-3 py-2 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
                                        onClick={onAddEntry}
                                        disabled={!view.selectedHomeId}
                                    >
                                        Add
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            ) : tab === 'COMPANY' ? (
                <CompanyReviewTab
                    view={view}
                    companies={view.companies}
                    homes={homesForSelectedCompany}
                    submissions={companySubmissions}
                    loadingList={loadingCompanySubs}
                    selected={selectedCompanySubmission}
                    onSelect={setSelectedCompanySubmission}
                    header={companyViewHeader}
                    entries={companyViewEntries}
                    loadingView={loadingCompanyView}
                    signUrl={signUrl}
                    companyWeekStart={companyWeekStart}             // 🔹 NEW
                    setCompanyWeekStart={setCompanyWeekStart}       // 🔹 NEW
                />

            ) : (
                <div className="text-sm text-gray-700">
                    The Young People tab will track each young persons balances and transactions. Say the word when you are ready and I will
                    scaffold this to match your process (cash in/out, pocket money, clothing, activities).
                </div>
            )}
        </div>
    );
}

/** ====== Totals logic (single source of truth) ====== */
function computeTotals(entries: Entry[], cashCarriedForward: number, cardCarriedForward: number, budgetIssued: number) {
    const cardSpend = entries.filter((e) => e.method === 'CARD' && !e.is_withdrawal).reduce((a, b) => a + (b.amount || 0), 0);
    const cashSpend = entries.filter((e) => e.method === 'CASH' && !e.is_withdrawal).reduce((a, b) => a + (b.amount || 0), 0);
    const cashWithdrawn = entries.filter((e) => e.is_withdrawal).reduce((a, b) => a + (b.amount || 0), 0);
    const ypIn = entries.reduce((a, b) => a + (b.yp_cash_in || 0), 0);

    // Balances: transfers reduce card, increase petty
    const totalCardBalance = cardCarriedForward + budgetIssued - cardSpend - cashWithdrawn;
    const totalPettyCashBalance = cashCarriedForward + ypIn + cashWithdrawn - cashSpend;

    const totalBroughtForward = cashCarriedForward + cardCarriedForward;

    return {
        cardSpend,
        cashSpend,
        ypIn,
        cashWithdrawn,
        totalCardBalance,
        totalPettyCashBalance,
        totalBroughtForward,
    };
}

/** ====== Money Inputs ====== */
function SummaryMoneyReadonly({ label, value }: { label: string; value: number }) {
    return (
        <div className="border rounded-lg p-3 bg-white">
            <div className="text-xs text-gray-700">{label}</div>
            <div className="mt-1 text-base font-medium text-gray-900">£{formatMoney(value)}</div>
        </div>
    );
}

function SummaryMoneyInput({
    label,
    value,
    onCommit,
    saving,
}: {
    label: string;
    value: number;
    onCommit: (v: number) => void;
    saving?: boolean;
}) {
    const [txt, setTxt] = useState<string>(formatMoney(value));
    const focusedRef = useRef(false);

    useEffect(() => {
        if (!focusedRef.current) setTxt(formatMoney(value));
    }, [value]);

    return (
        <div className="border rounded-lg p-3 bg-white">
            <div className="text-xs text-gray-700">{label}</div>
            <div className="mt-1 flex items-center">
                <span className="mr-1 text-gray-900">£</span>
                <input
                    type="text"
                    className="border rounded px-2 py-2 w-full bg-white text-gray-900"
                    value={txt}
                    onFocus={() => {
                        focusedRef.current = true;
                    }}
                    onBlur={() => {
                        focusedRef.current = false;
                        const v = parseMoney(txt);
                        setTxt(formatMoney(v));
                        onCommit(v);
                    }}
                    onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d.,-]/g, '');
                        setTxt(raw);
                    }}
                />
                {saving && <span className="ml-2 text-[11px] text-gray-600">Saving...</span>}
            </div>
        </div>
    );
}

function MoneyInline({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    const [txt, setTxt] = useState<string>(formatMoney(value));
    const focusedRef = useRef(false);

    useEffect(() => {
        if (!focusedRef.current) setTxt(formatMoney(value));
    }, [value]);

    return (
        <div className="flex items-center justify-end gap-1">
            <span className="text-gray-900">£</span>
            <input
                type="text"
                className="border rounded px-2 py-2 text-right w-28 bg-white text-gray-900"
                value={txt}
                onFocus={() => {
                    focusedRef.current = true;
                }}
                onBlur={() => {
                    focusedRef.current = false;
                    const v = parseMoney(txt);
                    const snap = formatMoney(v);
                    setTxt(snap);
                    onChange(v);
                }}
                onChange={(e) => {
                    const raw = e.target.value.replace(/[^\d.,-]/g, '');
                    setTxt(raw);
                    onChange(parseMoney(raw));
                }}
            />
        </div>
    );
}

function MoneyText({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
    const show = value.replace(/^£/, '');
    return (
        <div className="flex items-center">
            <span className="mr-1 text-gray-900">£</span>
            <input
                type="text"
                className="border rounded px-2 py-2 w-full bg-white text-gray-900"
                value={show}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value.replace(/[^\d.,-]/g, ''))}
            />
        </div>
    );
}

/** ====== Table helpers ====== */
function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return <th className={`p-2 text-xs font-medium text-gray-700 ${className}`}>{children}</th>;
}
function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return <td className={`p-2 align-top text-gray-900 ${className}`}>{children}</td>;
}

/** ====== ReceiptCell (camera/gallery + optimistic UI) ====== */
function ReceiptCell({
    entry,
    onUpload,
    onRemove,
    onPreview,
    compact = false,
}: {
    entry: Entry;
    onUpload: (e: Entry, file: File) => Promise<{ ok: boolean; path: string | null }>;
    onRemove: (e: Entry) => Promise<void>;
    onPreview: (path: string) => Promise<void>;
    compact?: boolean;
}) {
    // Two inputs so iOS respects camera/gallery intent
    const cameraInputRef = useRef<HTMLInputElement | null>(null);
    const galleryInputRef = useRef<HTMLInputElement | null>(null);

    const [busy, setBusy] = useState<'idle' | 'upload' | 'delete'>('idle');
    const [err, setErr] = useState<string | null>(null);

    // Local mirror so UI flips instantly when upload succeeds.
    const [localPath, setLocalPath] = useState<string | null>(entry.receipt_path ?? null);
    useEffect(() => {
        setLocalPath(entry.receipt_path ?? null);
    }, [entry.receipt_path]);

    const triggerCamera = () => cameraInputRef.current?.click();
    const triggerGallery = () => galleryInputRef.current?.click();

    const onChosen = async (file?: File | null) => {
        if (!file) return;
        setErr(null);
        setBusy('upload');
        const res = await onUpload(entry, file);
        if (!res.ok || !res.path) {
            setErr('Upload failed. Please try again.');
            setBusy('idle');
            return;
        }
        setLocalPath(res.path);
        setBusy('idle');
    };

    const doRemove = async () => {
        if (!localPath) return;
        setErr(null);
        setBusy('delete');
        try {
            await onRemove(entry);
            setLocalPath(null);
        } catch {
            setErr('Delete failed. Please try again.');
        } finally {
            setBusy('idle');
        }
    };

    return (
        <div className={`flex ${compact ? 'flex-col gap-2' : 'items-center gap-2'} text-sm`}>
            {/* Hidden inputs */}
            <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    onChosen(f);
                }}
            />
            <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    onChosen(f);
                }}
            />

            {localPath ? (
                <>
                    <button
                        type="button"
                        className="px-2 py-1 rounded border bg-white text-gray-900 hover:bg-gray-50 disabled:opacity-60"
                        disabled={busy !== 'idle'}
                        onClick={() => onPreview(localPath)}
                    >
                        View
                    </button>
                    <button
                        type="button"
                        className="px-2 py-1 rounded border bg-white text-gray-900 hover:bg-gray-50 disabled:opacity-60"
                        onClick={triggerCamera}
                        disabled={busy !== 'idle'}
                        title="Retake from camera"
                    >
                        Replace
                    </button>
                    <button
                        type="button"
                        className="px-2 py-1 rounded border text-red-600 bg-white hover:bg-red-50 disabled:opacity-60"
                        onClick={doRemove}
                        disabled={busy !== 'idle'}
                    >
                        {busy === 'delete' ? 'Deleting…' : 'Delete'}
                    </button>
                </>
            ) : (
                <>
                    <button
                        type="button"
                        className="px-2 py-1 rounded border bg-white text-gray-900 hover:bg-gray-50 disabled:opacity-60"
                        onClick={triggerCamera}
                        disabled={busy !== 'idle'}
                        title="Open camera"
                    >
                        {busy === 'upload' ? 'Uploading…' : 'Take photo'}
                    </button>
                    <button
                        type="button"
                        className="px-2 py-1 rounded border bg-white text-gray-900 hover:bg-gray-50 disabled:opacity-60"
                        onClick={triggerGallery}
                        disabled={busy !== 'idle'}
                        title="Pick from library"
                    >
                        {busy === 'upload' ? 'Uploading…' : 'Upload'}
                    </button>
                </>
            )}

            <span className="text-[11px] text-gray-600" aria-live="polite">
                {busy === 'upload' && 'Uploading…'}
            </span>
            {err && <span className="text-[11px] text-red-600">{err}</span>}
        </div>
    );
}

/** ====== Company review tab (read-only) ====== */
// Narrow, explicit "ready" view — eliminates `any`
type ViewReady = {
    status: 'ready';
    level: Level;
    uid: string;
    initials: string;
    companies: Company[];
    homes: Home[];
    selectedCompanyId: string | null;
    selectedHomeId: string | null;
    bankOnly: boolean;
};

// Props for CompanyReviewTab (includes the NEW week props)
type CompanyReviewTabProps = {
    view: ViewReady;
    companies: Company[];
    homes: Home[];
    submissions: Submission[];
    loadingList: boolean;
    selected: Submission | null;
    onSelect: (s: Submission | null) => void;
    header: WeekHeader | null;
    entries: Entry[];
    loadingView: boolean;
    signUrl: (path: string, ttlSec?: number) => Promise<string | null>;
    companyWeekStart: string; // ISO date string for the chosen week
    setCompanyWeekStart: React.Dispatch<React.SetStateAction<string>>;
};

function CompanyReviewTab({
    view,
    companies,
    homes,
    submissions,
    loadingList,
    selected,
    onSelect,
    header,
    entries,
    loadingView,
    signUrl,
    companyWeekStart,           // ✅ now typed
    setCompanyWeekStart,        // ✅ now typed
}: CompanyReviewTabProps) {
    const homeName = useCallback(
        (id: string) => homes.find((h) => h.id === id)?.name ?? id.slice(0, 8),
        [homes]
    );

    const totals = useMemo(() => {
        if (!header) {
            return computeTotals(entries, 0, 0, 0);
        }
        return computeTotals(
            entries,
            header.cash_carried_forward,
            header.card_carried_forward,
            header.budget_issued
        );
    }, [entries, header]);

    return (
        <div className="space-y-4">
            {/* List */}
            <div className="border rounded-lg bg-white">
                <div className="p-3 border-b flex items-center justify-between">
                    <div className="font-medium">Submitted budgets</div>
                    <div className="text-xs text-gray-600">
                        Viewing company: <span className="font-medium">{companies.find((c) => c.id === view.selectedCompanyId)?.name ?? '—'}</span>
                    </div>
                </div>
                {loadingList ? (
                    <div className="p-4 text-sm text-gray-700">Loading…</div>
                ) : submissions.length === 0 ? (
                    <div className="p-4 text-sm text-gray-700">No submissions in the last 12 weeks.</div>
                ) : (
                    <div className="max-h-[420px] overflow-y-auto divide-y">
                        {submissions.map((s) => (
                            <button
                                key={`${s.home_id}-${s.week_start}`}
                                className={`w-full text-left px-3 py-2 hover:bg-gray-50 ${selected && s.home_id === selected.home_id && s.week_start === selected.week_start ? 'bg-indigo-50' : ''}`}
                                onClick={() => onSelect(s)}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium">{homeName(s.home_id)}</span>
                                        <span className="text-xs text-gray-600">Week: {fmtDmy(s.week_start)}</span>
                                    </div>
                                    <div className="text-xs text-gray-600">
                                        Submitted {new Date(s.submitted_at).toLocaleString()}
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Read-only view */}
            <div className="border rounded-lg bg-white">
                <div className="p-3 border-b flex items-center justify-between">
                    <div className="font-medium">Budget details</div>
                    {selected ? (
                        <div className="text-xs text-gray-600">
                            {homeName(selected.home_id)} — Week {fmtDmy(selected.week_start)}
                        </div>
                    ) : null}
                </div>

                {loadingView ? (
                    <div className="p-4 text-sm text-gray-700">Loading…</div>
                ) : !selected ? (
                    <div className="p-4 text-sm text-gray-700">Select a submission to review.</div>
                ) : (
                    <div className="p-3 space-y-3">
                        {/* Summary */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <SummaryMoneyReadonly label="Cash Carried Forward" value={header?.cash_carried_forward ?? 0} />
                            <SummaryMoneyReadonly label="Card Carried Forward" value={header?.card_carried_forward ?? 0} />
                            <SummaryMoneyReadonly label="Budget Issued" value={header?.budget_issued ?? 0} />
                            <SummaryMoneyReadonly label="YP Cash In Total" value={round2(totals.ypIn)} />
                            <SummaryMoneyReadonly label="Total Cash Withdrawn" value={round2(totals.cashWithdrawn)} />
                            <SummaryMoneyReadonly label="Total Petty Cash Balance" value={round2(totals.totalPettyCashBalance)} />
                            <SummaryMoneyReadonly label="Total Card Balance" value={round2(totals.totalCardBalance)} />
                        </div>

                        {/* Read-only entries */}
                        <div className="overflow-x-auto border rounded-lg">
                            <table className="w-full text-sm min-w-[900px]">
                                <thead className="bg-gray-50">
                                    <tr className="text-left">
                                        <Th>#</Th>
                                        <Th>Date</Th>
                                        <Th>Description</Th>
                                        <Th>Method</Th>
                                        <Th className="text-right">Amount</Th>
                                        <Th className="text-right">YP Cash In</Th>
                                        <Th>Initials</Th>
                                        <Th>Receipt</Th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white">
                                    {entries.length === 0 ? (
                                        <tr>
                                            <td colSpan={8} className="p-4 text-center text-gray-600">No entries.</td>
                                        </tr>
                                    ) : (
                                        entries.map((e) => (
                                            <tr key={e.id ?? e.entry_no} className="border-t">
                                                <Td>{e.entry_no}</Td>
                                                <Td>
                                                    {e.date
                                                        ? new Date(e.date + 'T00:00:00Z').toLocaleDateString('en-GB', {
                                                            day: '2-digit',
                                                            month: '2-digit',
                                                            year: 'numeric',
                                                        })
                                                        : ''}
                                                </Td>

                                                <Td>
                                                    <div className="flex items-center gap-2">
                                                        <span>{e.description}</span>
                                                        {e.is_withdrawal && (
                                                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                                                                Withdrawal
                                                            </span>
                                                        )}
                                                    </div>
                                                </Td>
                                                <Td>{e.is_withdrawal ? 'Card' : e.method === 'CARD' ? 'Card' : 'Cash'}</Td>
                                                <Td className="text-right">£{formatMoney(e.amount)}</Td>
                                                <Td className="text-right">£{formatMoney(e.yp_cash_in)}</Td>
                                                <Td>{e.created_by_initials || '--'}</Td>
                                                <Td>
                                                    {e.receipt_path ? (
                                                        <button
                                                            className="px-2 py-1 rounded border bg-white text-gray-900 hover:bg-gray-50"
                                                            onClick={async () => {
                                                                const url = await signUrl(e.receipt_path!);
                                                                if (url) window.open(url, '_blank', 'noopener,noreferrer');
                                                            }}
                                                        >
                                                            View
                                                        </button>
                                                    ) : (
                                                        <span className="text-xs text-gray-500">—</span>
                                                    )}
                                                </Td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
