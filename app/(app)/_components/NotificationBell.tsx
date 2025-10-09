'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/supabase/client';

type NotifKind = 'TRAINING_ASSIGNMENT' | 'TRAINING_REMINDER' | string;

type NotifPayload = {
    // Assignment
    due_by?: string | null;
    course_name?: string | null;
    // Reminder
    bucket?: 'OVERDUE' | 'DUE_TODAY' | 'DUE_TOMORROW' | 'DUE_SOON' | string;
    due_date?: string | null;
    next_due_date?: string | null;
} & Record<string, unknown>;

type Notif = {
    id: string;
    message: string;
    link: string | null;
    kind: NotifKind;
    is_read: boolean;
    created_at: string;
    payload?: NotifPayload | null;
};

export default function NotificationBell() {
    const [uid, setUid] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<Notif[]>([]);
    const [loading, setLoading] = useState(false);
    const [sendingReminders, setSendingReminders] = useState(false);

    const [err, setErr] = useState<string | null>(null);
    const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
    const mounted = useRef(true);

    const unread = useMemo(() => items.filter(i => !i.is_read), [items]);
    const earlier = useMemo(() => items.filter(i => i.is_read), [items]);
    const unreadCount = unread.length;

    useEffect(() => {
        mounted.current = true;
        (async () => {
            const { data } = await supabase.auth.getUser();
            setUid(data.user?.id ?? null);
        })();
        return () => {
            mounted.current = false;
        };
    }, []);

    const load = useCallback(async () => {
        if (!uid) return;
        setErr(null);
        setLoading(true);
        const { data, error } = await supabase
            .from('notifications')
            .select('id,message,link,kind,is_read,created_at,payload')
            .eq('recipient_id', uid)
            .order('created_at', { ascending: false })
            .limit(50);

        if (!mounted.current) return;
        if (error) {
            setErr(error.message);
            setLoading(false);
            return;
        }
        setItems((data as Notif[]) ?? []);
        setLoading(false);
    }, [uid]);

    useEffect(() => {
        if (!uid) return;
        load();

        const vis = () => {
            if (document.visibilityState === 'visible') load();
        };
        const focus = () => load();
        document.addEventListener('visibilitychange', vis);
        window.addEventListener('focus', focus);

        const channel = supabase
            .channel('notif_changes')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${uid}` },
                () => load()
            )
            .subscribe();

        const interval = window.setInterval(load, 20000);

        return () => {
            document.removeEventListener('visibilitychange', vis);
            window.removeEventListener('focus', focus);
            try {
                supabase.removeChannel(channel);
            } catch {
                /* no-op */
            }
            clearInterval(interval);
        };
    }, [uid, load]);

    async function markRead(id: string, yes: boolean) {
        setBusyIds(s => ({ ...s, [id]: true }));
        const { error } = await supabase.from('notifications').update({ is_read: yes }).eq('id', id);
        setBusyIds(s => ({ ...s, [id]: false }));
        if (error) return alert(error.message);
        setItems(list => list.map(i => (i.id === id ? { ...i, is_read: yes } : i)));
    }

    async function remove(id: string) {
        setBusyIds(s => ({ ...s, [id]: true }));
        const { error } = await supabase.from('notifications').delete().eq('id', id);
        setBusyIds(s => ({ ...s, [id]: false }));
        if (error) return alert(error.message);
        setItems(list => list.filter(i => i.id !== id));
    }

    // Intentionally unused developer utility (kept for parity; prefixed to satisfy lint rules)
    function _fmtISO(d: Date) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }
    // Intentionally unused developer utility (kept for parity; prefixed to satisfy lint rules)
    async function _sendRemindersNow(runISO?: string) {
        if (sendingReminders) return;
        setSendingReminders(true);
        try {
            const iso = runISO ?? _fmtISO(new Date());
            const { error } = await supabase.rpc('send_appointment_reminders', { p_run_date: iso });
            if (error) throw error;
            alert(`Reminders sent for ${iso}. Check your bell.`);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Failed to send reminders';
            alert(msg);
        } finally {
            setSendingReminders(false);
        }
    }

    function chip(text: string) {
        return (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ring-1 ring-gray-200 bg-gray-50 text-gray-700">
                {text}
            </span>
        );
    }

    function renderExtra(n: Notif) {
        if (n.kind === 'TRAINING_ASSIGNMENT') {
            const dueRaw = n.payload?.due_by ?? null;
            const dueTxt = dueRaw ? new Date(dueRaw).toLocaleDateString() : null;
            const course = (n.payload?.course_name as string | undefined) ?? undefined;
            return (
                <div className="flex flex-wrap gap-2 mt-1">
                    {course ? chip(`Course: ${course}`) : null}
                    {dueTxt ? chip(`Due: ${dueTxt}`) : null}
                    {chip('Training')}
                </div>
            );
        }

        if (n.kind === 'TRAINING_REMINDER') {
            const course = (n.payload?.course_name as string | undefined) ?? undefined;
            const bucket = (n.payload?.bucket as string | undefined) ?? undefined;
            const dueRaw = n.payload?.due_date || n.payload?.next_due_date || null;
            const dueTxt = dueRaw ? new Date(dueRaw).toLocaleDateString() : null;

            const bucketLabel =
                bucket === 'OVERDUE'
                    ? 'Overdue'
                    : bucket === 'DUE_TODAY'
                        ? 'Due today'
                        : bucket === 'DUE_TOMORROW'
                            ? 'Due tomorrow'
                            : bucket === 'DUE_SOON'
                                ? 'Due soon'
                                : bucket || 'Reminder';

            return (
                <div className="flex flex-wrap gap-2 mt-1">
                    {course ? chip(`Course: ${course}`) : null}
                    {dueTxt ? chip(`Due: ${dueTxt}`) : null}
                    {chip(bucketLabel)}
                </div>
            );
        }

        return null;
    }

    return (
        <div className="relative">
            {/* Trigger: soft white pill, no border/ring */}
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="relative inline-flex items-center justify-center h-10 w-10 rounded-full bg-white/90 text-black shadow-sm hover:bg-white focus:outline-none"
                aria-label="Notifications"
                aria-haspopup="dialog"
                aria-expanded={open}
            >
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
                    <path d="M12 22a2 2 0 0 0 2-2H10a2 2 0 0 0 2 2Zm6-6V11a6 6 0 1 0-12 0v5L4 18v1h16v-1l-2-2Z" fill="currentColor" />
                </svg>
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 grid place-items-center min-w-[20px] h-[20px] px-1 rounded-full bg-rose-600 text-white text-[11px] font-semibold shadow-sm">
                        {unreadCount}
                    </span>
                )}
            </button>

            {open && (
                <>
                    {/* Mobile backdrop so tapping outside closes it */}
                    <button aria-hidden onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/25 sm:hidden" type="button" />

                    <div
                        className="
    /* Desktop: anchor at bell's left, shift full width left */
    sm:absolute sm:left-0 sm:mt-3 sm:w-[38rem] sm:max-w-[92vw]
    sm:transform sm:-translate-x-full sm:origin-top-right
    /* Mobile: fixed, edge-to-edge with small gutters under the header (unchanged) */
    fixed left-3 right-3 top-14 sm:top-auto
    rounded-2xl bg-white text-gray-900 shadow-xl ring-1 ring-gray-900/5
    z-50 overflow-hidden
  "
                        role="dialog"
                        aria-label="Notifications"
                    >
                        {/* Header */}
                        <div className="p-4 border-b border-gray-200 bg-gray-50/60">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold tracking-wide text-gray-900">Notifications</h3>
                                <div className="flex items-center gap-3">
                                    <button onClick={load} className="text-xs underline">
                                        Refresh
                                    </button>
                                    {unreadCount > 0 && (
                                        <button
                                            onClick={async () => {
                                                const { error } = await supabase
                                                    .from('notifications')
                                                    .update({ is_read: true })
                                                    .eq('recipient_id', uid)
                                                    .eq('is_read', false);
                                                if (!error) setItems(list => list.map(i => ({ ...i, is_read: true })));
                                            }}
                                            className="text-xs rounded border px-2 py-1 hover:bg-gray-50"
                                        >
                                            Mark all read
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Body */}
                        <div className="p-3 overflow-auto max-h-[calc(100vh-12rem)] sm:max-h-[36rem]">
                            {loading ? (
                                <div className="space-y-2">
                                    {[...Array(4)].map((_, i) => (
                                        <div key={i} className="flex items-start gap-3 p-3 rounded-xl border bg-white">
                                            <div className="h-9 w-9 rounded-full bg-gray-100 animate-pulse" />
                                            <div className="flex-1 space-y-2">
                                                <div className="h-4 bg-gray-100 rounded w-3/4 animate-pulse" />
                                                <div className="h-3 bg-gray-100 rounded w-1/2 animate-pulse" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : err ? (
                                <p className="p-2 text-sm text-rose-600">{err}</p>
                            ) : items.length === 0 ? (
                                <p className="p-3 text-sm text-gray-600">No notifications.</p>
                            ) : (
                                <div className="space-y-3">
                                    {unread.length > 0 && (
                                        <div className="space-y-2">
                                            <div className="px-1 text-xs font-medium text-gray-500">Unread</div>
                                            {unread.map(n => (
                                                <NotifRow key={n.id} n={n} busy={!!busyIds[n.id]} markRead={markRead} remove={remove} renderExtra={renderExtra} />
                                            ))}
                                        </div>
                                    )}
                                    {earlier.length > 0 && (
                                        <div className="space-y-2">
                                            <div className="px-1 text-xs font-medium text-gray-500">Earlier</div>
                                            {earlier.map(n => (
                                                <NotifRow key={n.id} n={n} busy={!!busyIds[n.id]} markRead={markRead} remove={remove} renderExtra={renderExtra} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}

function NotifRow({
    n,
    busy,
    markRead,
    remove,
    renderExtra,
}: {
    n: Notif;
    busy: boolean;
    markRead: (id: string, yes: boolean) => Promise<void>;
    remove: (id: string) => Promise<void>;
    renderExtra: (n: Notif) => React.ReactElement | null;
}) {
    return (
        <div className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border ${n.is_read ? 'bg-white' : 'bg-indigo-50/40 ring-1 ring-indigo-100/70'}`}>
            <KindIcon kind={n.kind} />
            <div className="flex-1 min-w-0">
                <div className="text-[15px] leading-tight font-medium text-gray-900">{n.message}</div>
                {renderExtra(n)}
                <div className="text-xs text-gray-500 mt-1">{new Date(n.created_at).toLocaleString()}</div>
            </div>
            <div className="shrink-0 flex flex-col items-end gap-2">
                <div className="flex items-center gap-2">
                    {!n.is_read ? (
                        <button disabled={busy} onClick={() => markRead(n.id, true)} className="text-xs rounded border px-2 py-1 hover:bg-gray-50 disabled:opacity-60">
                            {busy ? '…' : 'Mark read'}
                        </button>
                    ) : (
                        <button disabled={busy} onClick={() => markRead(n.id, false)} className="text-xs text-gray-500 underline disabled:opacity-60">
                            Unread
                        </button>
                    )}
                    {n.link && (
                        <a href={n.link} className="text-xs rounded border px-2 py-1 hover:bg-gray-50">
                            Open
                        </a>
                    )}
                    <button
                        disabled={busy}
                        onClick={() => remove(n.id)}
                        className="text-xs text-gray-500 underline disabled:opacity-60"
                        aria-label="Delete notification"
                    >
                        Delete
                    </button>
                </div>
            </div>
        </div>
    );
}

function KindIcon({ kind }: { kind: string }) {
    const base = 'h-9 w-9 grid place-items-center rounded-full ring-1';
    const { bg, ring, txt } =
        kind === 'TRAINING_ASSIGNMENT'
            ? { bg: 'bg-indigo-50', ring: 'ring-indigo-100', txt: 'text-indigo-700' }
            : kind === 'TRAINING_REMINDER'
                ? { bg: 'bg-amber-50', ring: 'ring-amber-100', txt: 'text-amber-700' }
                : { bg: 'bg-slate-50', ring: 'ring-slate-100', txt: 'text-slate-700' };

    return (
        <div className={`${base} ${bg} ${ring} ${txt}`}>
            {kind === 'TRAINING_ASSIGNMENT' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
                    <path d="M12 3l10 5-10 5L2 8l10-5Zm0 7l6.5-3.25M12 13v6M6 16.5c1.5 1 3.8 1.5 6 1.5s4.5-.5 6-1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
                </svg>
            ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
                    <path d="M12 22a2 2 0 0 0 2-2H10a2 2 0 0 0 2 2Zm6-6V11a6 6 0 1 0-12 0v5L4 18v1h16v-1l-2-2Z" fill="currentColor" />
                </svg>
            )}
        </div>
    );
}
