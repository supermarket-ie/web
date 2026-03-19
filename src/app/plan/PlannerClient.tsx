'use client';
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useChat } from '@ai-sdk/react';
import { loadSession } from '@/lib/session';

const EXAMPLE_PROMPTS = [
  "Spaghetti bolognese, chicken stir fry, and packed lunches for the week",
  "Sunday roast, midweek pasta, fish on Friday",
  "Healthy week — salads, grilled chicken, overnight oats for breakfast",
  "Quick and easy — stir fries, soup, and sandwiches",
];

const HOUSEHOLD_SIZES = [1, 2, 3, 4, 5, 6];

export function PlannerClient() {
  const [householdSize, setHouseholdSize] = useState(2);
  const [started, setStarted] = useState(false);
  const [session, setSession] = useState<{ token: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { messages, input, setInput, handleInputChange, handleSubmit, isLoading, stop } = useChat({
    api: '/api/plan',
    body: { householdSize },
    streamProtocol: 'data',
    onFinish: () => {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    },
  });

  useEffect(() => {
    const s = loadSession();
    if (s) setSession(s);
  }, []);

  useEffect(() => {
    if (isLoading) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isLoading, messages]);

  function handleExample(prompt: string) {
    setInput(prompt);
    textareaRef.current?.focus();
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    setStarted(true);
    handleSubmit(e);
  }

  async function saveList() {
    if (!session || saving) return;
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    if (!lastAssistant) return;
    setSaving(true);
    // Save as a note on their list — we'll store it in subscriber preferences
    await fetch('/api/list/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-session-token': session.token },
      body: JSON.stringify({ aiPlanNote: lastAssistant.content, aiPlanDate: new Date().toISOString() }),
    });
    setSaving(false);
    setSaved(true);
  }

  const lastAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant');
  const hasResult = !!lastAssistantMessage;

  return (
    <div className="min-h-screen bg-[#FFFBF7] flex flex-col">
      {/* Header */}
      <header className="px-6 py-4 border-b border-[#E8E2DC] bg-white sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link href="/" className="text-base font-bold text-[#1D2324]">
            supermarket<span className="text-[#E17055]">.ie</span>
          </Link>
          <div className="flex items-center gap-3">
            {session ? (
              <Link href={`/list?token=${session.token}`}
                className="text-sm font-semibold text-[#5D9B8F] hover:text-[#4A8A7E] transition">
                My list →
              </Link>
            ) : (
              <Link href="/"
                className="text-sm font-semibold text-[#636E72] hover:text-[#1D2324] transition">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8 flex flex-col gap-6">

        {/* Hero — shown before first submission */}
        {!started && (
          <div className="text-center pt-4 pb-2">
            <div className="inline-flex items-center gap-2 bg-[#F0FAF7] text-[#5D9B8F] px-3 py-1.5 rounded-full text-sm font-semibold mb-4">
              <span className="text-base">✨</span> Ireland's first AI grocery planner
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-[#1D2324] leading-tight mb-3">
              What are you cooking<br />this week?
            </h1>
            <p className="text-[#636E72] text-base max-w-md mx-auto">
              Tell us your meals and we'll build a complete shopping list with the best prices across Tesco, Dunnes and SuperValu.
            </p>
          </div>
        )}

        {/* Conversation */}
        {messages.length > 0 && (
          <div className="space-y-4">
            {messages.map(m => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {m.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#E17055] to-[#D4604A] flex items-center justify-center text-white text-xs font-bold mr-2 mt-1 flex-shrink-0">
                    S
                  </div>
                )}
                <div className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-[#1D2324] text-white rounded-br-sm'
                    : 'bg-white border border-[#E8E2DC] text-[#1D2324] rounded-bl-sm shadow-sm'
                }`}>
                  {m.role === 'assistant' ? (
                    <div className="prose prose-sm max-w-none prose-headings:text-[#1D2324] prose-headings:font-bold prose-p:text-[#1D2324] prose-strong:text-[#1D2324] prose-li:text-[#1D2324]">
                      <FormattedMessage content={m.content} />
                    </div>
                  ) : (
                    <p>{m.content}</p>
                  )}
                </div>
              </div>
            ))}

            {/* Streaming indicator */}
            {isLoading && (
              <div className="flex justify-start">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#E17055] to-[#D4604A] flex items-center justify-center text-white text-xs font-bold mr-2 mt-1 flex-shrink-0">S</div>
                <div className="bg-white border border-[#E8E2DC] rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                  <div className="flex gap-1 items-center">
                    <span className="w-2 h-2 bg-[#E17055] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}/>
                    <span className="w-2 h-2 bg-[#E17055] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}/>
                    <span className="w-2 h-2 bg-[#E17055] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}/>
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}

        {/* Save to list CTA — after result */}
        {hasResult && !isLoading && (
          <div className="bg-[#F0FAF7] border border-[#5D9B8F]/20 rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
            <div>
              <div className="font-semibold text-[#1D2324] text-sm">Save this list to your account</div>
              <div className="text-xs text-[#636E72] mt-0.5">Access it anytime, update quantities, swap stores.</div>
            </div>
            {session ? (
              <button onClick={saveList} disabled={saving || saved}
                className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${saved ? 'bg-[#5D9B8F] text-white' : 'bg-[#5D9B8F] text-white hover:bg-[#4A8A7E]'}`}>
                {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Save to my list'}
              </button>
            ) : (
              <Link href="/"
                className="flex-shrink-0 bg-[#E17055] text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-[#D4604A] transition">
                Sign in to save →
              </Link>
            )}
          </div>
        )}

        {/* Input form */}
        <div className="sticky bottom-0 pb-4 bg-gradient-to-t from-[#FFFBF7] via-[#FFFBF7] pt-2">

          {/* Example prompts — shown before first submit */}
          {!started && (
            <div className="flex flex-wrap gap-2 mb-3 justify-center">
              {EXAMPLE_PROMPTS.map(p => (
                <button key={p} onClick={() => handleExample(p)}
                  className="text-xs bg-white border border-[#E8E2DC] text-[#636E72] px-3 py-1.5 rounded-full hover:border-[#E17055] hover:text-[#E17055] transition-all">
                  {p.length > 45 ? p.slice(0, 45) + '…' : p}
                </button>
              ))}
            </div>
          )}

          {/* Household size */}
          <div className="flex items-center gap-2 mb-3 justify-center">
            <span className="text-xs text-[#636E72] font-medium">Household size:</span>
            <div className="flex gap-1">
              {HOUSEHOLD_SIZES.map(n => (
                <button key={n} onClick={() => setHouseholdSize(n)}
                  className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${householdSize === n ? 'bg-[#E17055] text-white' : 'bg-white border border-[#E8E2DC] text-[#636E72] hover:border-[#E17055]'}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={onSubmit} className="relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(e as unknown as React.FormEvent); } }}
              placeholder={started ? "Ask me to adjust, add a meal, or plan another week…" : "e.g. Spaghetti bolognese Monday, chicken curry Wednesday, fish on Friday…"}
              rows={3}
              className="w-full px-4 py-3 pr-14 rounded-2xl border-2 border-[#E8E2DC] focus:border-[#E17055] focus:outline-none text-sm text-[#1D2324] placeholder:text-[#B2BEC3] resize-none bg-white shadow-sm transition"
            />
            <button type="submit" disabled={isLoading || !input.trim()}
              onClick={isLoading ? stop : undefined}
              className="absolute right-3 bottom-3 w-9 h-9 bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white rounded-xl flex items-center justify-center hover:from-[#D4604A] hover:to-[#C5533D] transition-all disabled:opacity-40 shadow-sm">
              {isLoading ? (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/>
                </svg>
              )}
            </button>
          </form>
          <p className="text-center text-xs text-[#B2BEC3] mt-2">Prices from Tesco, Dunnes Stores and SuperValu · Updated regularly</p>
        </div>
      </main>
    </div>
  );
}

// Render markdown-lite: bold, headers, lists — without a heavy library
function FormattedMessage({ content }: { content: string }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { elements.push(<br key={i} />); continue; }

    if (line.startsWith('### ')) {
      elements.push(<h3 key={i} className="text-base font-bold text-[#1D2324] mt-4 mb-1">{renderInline(line.slice(4))}</h3>);
    } else if (line.startsWith('## ')) {
      elements.push(<h2 key={i} className="text-lg font-bold text-[#1D2324] mt-4 mb-1">{renderInline(line.slice(3))}</h2>);
    } else if (line.startsWith('**') && line.endsWith('**') && line.length > 4) {
      elements.push(<p key={i} className="font-bold text-[#1D2324] mt-3 mb-1">{renderInline(line.slice(2, -2))}</p>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(<p key={i} className="pl-2 text-[#1D2324] leading-relaxed">{renderInline(line.slice(2))}</p>);
    } else if (line.startsWith('---')) {
      elements.push(<hr key={i} className="border-[#E8E2DC] my-3"/>);
    } else if (line.startsWith('💡')) {
      elements.push(<p key={i} className="mt-3 p-3 bg-[#FEF3E2] rounded-xl text-sm text-[#E17055] font-medium">{renderInline(line)}</p>);
    } else {
      elements.push(<p key={i} className="text-[#1D2324] leading-relaxed">{renderInline(line)}</p>);
    }
  }
  return <>{elements}</>;
}

function renderInline(text: string): React.ReactNode {
  // Bold: **text**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-[#1D2324]">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}
