'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

interface SavedList {
  id: string;
  name: string;
  meals_prompt: string | null;
  family_size: string;
  store_totals: { store: string; total: number }[];
  is_default: boolean;
  created_at: string;
}

function fmt(price: number) { return `€${price.toFixed(2)}`; }
function storeShort(store: string) {
  const s = store.toLowerCase();
  if (s.includes('tesco')) return 'Tesco';
  if (s.includes('dunnes')) return 'Dunnes';
  if (s.includes('supervalu')) return 'SV';
  return store;
}
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

export function SavedListsPanel({ token }: { token: string }) {
  const [lists, setLists] = useState<SavedList[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/lists?token=${token}`)
      .then(r => r.json())
      .then(d => { setLists(d.lists ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [token]);

  async function handleDelete(id: string) {
    setDeleting(id);
    await fetch(`/api/lists?token=${token}&id=${id}`, { method: 'DELETE' });
    setLists(prev => prev.filter(l => l.id !== id));
    setDeleting(null);
  }

  if (loading || lists.length === 0) return null;

  return (
    <div className="mb-5">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-sm font-semibold text-[#2F2F2E] hover:text-[#006A35] transition mb-2"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
        My saved lists ({lists.length})
        <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="space-y-2">
          {lists.map(list => {
            const cheapest = list.store_totals?.[0];
            return (
              <div key={list.id} className="bg-white rounded-xl border border-[#E8E2DC] px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[#2F2F2E] truncate">{list.name}</div>
                  <div className="text-xs text-[#B2BEC3] mt-0.5 flex items-center gap-2">
                    <span>{timeAgo(list.created_at)}</span>
                    {cheapest && (
                      <span className="text-[#5D9B8F] font-medium">
                        {storeShort(cheapest.store)} {fmt(cheapest.total)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Link
                    href={`/?prompt=${encodeURIComponent(list.meals_prompt ?? list.name)}`}
                    className="text-xs text-[#006A35] font-semibold hover:underline"
                    title="Rebuild this list"
                  >
                    Rebuild
                  </Link>
                  <button
                    onClick={() => handleDelete(list.id)}
                    disabled={deleting === list.id}
                    className="text-[#B2BEC3] hover:text-red-400 transition"
                    title="Delete list"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
          <Link
            href="/"
            className="block text-center text-xs text-[#006A35] font-semibold hover:underline py-1"
          >
            + Build a new list
          </Link>
        </div>
      )}
    </div>
  );
}
