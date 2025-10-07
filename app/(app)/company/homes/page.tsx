'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/supabase/client';

type Home = { id: string; name: string };

export default function CompanyHomesPage() {
  const [level, setLevel] = useState<'loading' | 'ok' | 'forbidden'>('loading');
  const [homes, setHomes] = useState<Home[]>([]);
  const [newHome, setNewHome] = useState('');
  const [msg, setMsg] = useState<string|null>(null);
  const [err, setErr] = useState<string|null>(null);

  useEffect(() => {
    (async () => {
      const { data: lvl } = await supabase.rpc('get_effective_level');
      if (lvl !== '2_COMPANY') { setLevel('forbidden'); return; }
      setLevel('ok');
      await loadHomes();
    })();
  }, []);

  async function loadHomes() {
    setErr(null);
    // We don’t know the company id client-side; ask server to give us all homes via a tiny helper view,
    // but to keep it simple we’ll fetch all homes and let the server-side API enforce scope on edits.
    // If you prefer, create a view limited to caller’s company.
    const { data, error } = await supabase.from('homes').select('id,name').order('name');
    if (error) setErr(error.message);
    setHomes(data || []);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null); setErr(null);
    const res = await fetch('/api/self/homes/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newHome }),
    });
    const data = await res.json();
    if (!res.ok) { setErr(data?.error || `Failed (${res.status})`); return; }
    setMsg(`Created "${data.home.name}"`);
    setNewHome('');
    await loadHomes();
  }

  async function rename(id: string, name: string) {
    setErr(null); setMsg(null);
    const res = await fetch('/api/self/homes/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ home_id: id, name }),
    });
    const data = await res.json();
    if (!res.ok) { setErr(data?.error || `Failed (${res.status})`); return; }
    setMsg('Saved.');
    await loadHomes();
  }

  if (level === 'loading') return <p className="p-6">Loading…</p>;
  if (level === 'forbidden') return <p className="p-6">You don’t have company access.</p>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Company · Homes</h1>

      <form onSubmit={onCreate} className="max-w-md flex gap-2">
        <input className="border rounded-lg px-3 py-2 flex-1" placeholder="New home name" value={newHome} onChange={e=>setNewHome(e.target.value)} />
        <button className="rounded-lg border px-3 py-2 hover:bg-gray-50">Add</button>
      </form>

      {msg && <p className="text-sm text-green-700">{msg}</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {homes.map(h => <EditableHome key={h.id} home={h} onSave={rename} />)}
      </div>
    </div>
  );
}

function EditableHome({ home, onSave }: { home: Home; onSave: (id: string, name: string) => void; }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(home.name);
  return (
    <div className="rounded-xl border p-3">
      {!editing ? (
        <>
          <div className="font-medium">{home.name}</div>
          <button onClick={() => setEditing(true)} className="mt-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50">Rename</button>
        </>
      ) : (
        <>
          <input className="border rounded-lg px-2 py-1.5 text-sm w-full" value={name} onChange={e=>setName(e.target.value)} />
          <div className="flex gap-2 mt-2">
            <button onClick={() => { onSave(home.id, name); setEditing(false); }} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50">Save</button>
            <button onClick={() => { setName(home.name); setEditing(false); }} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50">Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
