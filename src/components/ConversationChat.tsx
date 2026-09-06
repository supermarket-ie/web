'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { loadSession } from '@/lib/session';

type ArchivedMessage = { role: 'user' | 'assistant'; content: string; timestamp?: string };
type ArchivedConversation = { title: string; messages: ArchivedMessage[]; list_id?: string | null };

export function ConversationChat({ conversationId, prefill = '' }: { conversationId: string; prefill?: string }) {
  const router = useRouter();
  const [conversation, setConversation] = useState<ArchivedConversation | null>(null);
  const [error, setError] = useState('');
  const continueHref = `/?resume_conversation=${encodeURIComponent(conversationId)}${prefill.trim() ? `&agent_prompt=${encodeURIComponent(prefill.trim())}` : ''}`;

  useEffect(() => {
    const token = loadSession()?.token;
    if (!token) {
      router.push('/');
      return;
    }
    const controller = new AbortController();
    fetch(`/api/conversations/${conversationId}?token=${encodeURIComponent(token)}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('Conversation not found')))
      .then(data => setConversation(data.conversation as ArchivedConversation))
      .catch(nextError => {
        if (!(nextError instanceof DOMException && nextError.name === 'AbortError')) setError(nextError instanceof Error ? nextError.message : 'Conversation not found');
      });
    return () => controller.abort();
  }, [conversationId, router]);

  if (error) return <div className="mx-auto max-w-2xl px-4 py-12 text-sm text-red-700">{error}</div>;
  if (!conversation) return <div className="mx-auto max-w-2xl px-4 py-12 text-sm text-[#667169]">Loading archived conversation…</div>;

  const messages = (conversation.messages ?? []).filter(message => message.role === 'user' || message.role === 'assistant');
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <div className="mb-5 rounded-2xl border border-[#dbe9df] bg-[#f5faf6] p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-[#397250]">Archived conversation</p>
        <h1 className="mt-1 text-lg font-bold text-[#152219]">{conversation.title}</h1>
        <p className="mt-2 text-sm leading-6 text-[#667169]">This transcript is preserved for reference. Continue in the current Eve agent, which will load this history and any linked structured shop safely.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={continueHref} className="rounded-full bg-[#0b1710] px-4 py-2 text-xs font-bold text-white">Continue with Eve</Link>
          {conversation.list_id && <Link href={`/list?list=${encodeURIComponent(conversation.list_id)}`} className="rounded-full border border-[#cddbd1] bg-white px-4 py-2 text-xs font-bold text-[#17452a]">View linked shop</Link>}
          <Link href="/dashboard" className="rounded-full px-4 py-2 text-xs font-semibold text-[#397250]">Back to dashboard</Link>
        </div>
      </div>
      <div className="space-y-3">
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'rounded-br-md bg-[#122018] text-white' : 'rounded-bl-md bg-[#f1f3f1] text-[#39443d]'}`}>
              {message.content}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
