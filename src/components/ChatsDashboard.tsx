'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MessageSquare, MessageSquarePlus, Trash2 } from 'lucide-react';
import { loadSession } from '@/lib/session';
import { trackEvent } from '@/lib/analytics';

type Conversation = {
  id: string;
  title: string;
  updatedAt: string | null;
  messageCount: number;
  agentChat: boolean;
};

function normaliseConversations(value: unknown): Conversation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string' || !row.id) return [];
    return [{
      id: row.id,
      title: typeof row.title === 'string' && row.title.trim() ? row.title.trim() : 'Untitled chat',
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
      messageCount: typeof row.message_count === 'number' && Number.isFinite(row.message_count)
        ? Math.max(0, Math.floor(row.message_count))
        : 0,
      agentChat: row.agent_chat === true,
    }];
  });
}

function timeAgo(value: string | null) {
  if (!value) return '';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' });
}

export function ChatsDashboard() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadChats = useCallback(async (sessionToken: string) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/conversations?token=${encodeURIComponent(sessionToken)}`);
      if (!response.ok) throw new Error('Could not load your chats');
      const data = await response.json() as { conversations?: unknown };
      setConversations(normaliseConversations(data.conversations));
    } catch {
      setError('Your chats could not be loaded. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const session = loadSession();
    if (!session?.token) {
      router.push('/');
      return;
    }
    setToken(session.token);
    trackEvent('dashboard_visit', undefined, session.token);
    void loadChats(session.token);
  }, [loadChats, router]);

  async function deleteConversation(id: string) {
    if (!token) return;
    const response = await fetch(`/api/conversations/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`, { method: 'DELETE' });
    if (response.ok) setConversations(current => current.filter(conversation => conversation.id !== id));
  }

  return (
    <main className="min-h-screen bg-[#f7faf7] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-[#43805a]">Saved automatically</p>
            <h1 className="mt-1 text-3xl font-bold tracking-[-0.03em] text-[#142219]">Chats</h1>
            <p className="mt-2 text-sm leading-6 text-[#68736b]">Continue where you left off or start a fresh conversation.</p>
          </div>
          <Link href="/?new_chat=1" className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[#0b1710] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#183025]">
            <MessageSquarePlus className="size-4" /> New chat
          </Link>
        </div>

        <section className="overflow-hidden rounded-3xl border border-[#dfe7e1] bg-white shadow-[0_12px_35px_rgba(31,64,43,0.06)]">
          {loading && (
            <div className="space-y-3 p-5" aria-label="Loading chats">
              {[0, 1, 2].map(item => <div key={item} className="h-16 animate-pulse rounded-2xl bg-[#f1f5f2]" />)}
            </div>
          )}

          {!loading && error && (
            <div className="p-8 text-center">
              <p className="text-sm text-red-700">{error}</p>
              {token && <button type="button" onClick={() => void loadChats(token)} className="mt-3 text-sm font-bold text-[#08783b]">Try again</button>}
            </div>
          )}

          {!loading && !error && conversations.length === 0 && (
            <div className="px-6 py-14 text-center">
              <span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-[#e8f5ec] text-[#08783b]"><MessageSquare className="size-5" /></span>
              <h2 className="mt-4 font-semibold text-[#223128]">No saved chats yet</h2>
              <p className="mt-1 text-sm text-[#748078]">Your conversations with Supermarket.ie will appear here automatically.</p>
            </div>
          )}

          {!loading && !error && conversations.length > 0 && (
            <div className="divide-y divide-[#edf1ee]">
              {conversations.map(conversation => {
                const date = timeAgo(conversation.updatedAt);
                return (
                  <div key={conversation.id} className="group flex items-center gap-3 px-4 py-4 transition hover:bg-[#f8faf8] sm:px-5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#e8f5ec] text-[#08783b]"><MessageSquare className="size-4" /></span>
                    <Link href={conversation.agentChat ? `/?chat=${encodeURIComponent(conversation.id)}` : `/dashboard/chat/${encodeURIComponent(conversation.id)}`} className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#25342a]">{conversation.title}</p>
                      <p className="mt-1 text-xs text-[#7a857d]">
                        {conversation.messageCount} {conversation.messageCount === 1 ? 'message' : 'messages'}{date ? ` · ${date}` : ''}
                      </p>
                    </Link>
                    <button type="button" aria-label={`Delete ${conversation.title}`} onClick={() => void deleteConversation(conversation.id)} className="rounded-lg p-2 text-[#9aa39d] opacity-60 transition hover:bg-red-50 hover:text-red-700 sm:opacity-0 sm:group-hover:opacity-100">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
