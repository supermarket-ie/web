'use client';
import { useState, useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import { saveSession, loadSession } from '@/lib/session';

const EXAMPLES = [
  "Spaghetti bolognese, chicken stir fry, packed lunches",
  "Sunday roast, midweek pasta, fish on Friday",
  "Healthy week — salads, grilled chicken, overnight oats",
  "Quick & easy — stir fries, soup, toasties",
];

interface SignupGateProps {
  onSuccess: (token: string) => void;
  onSkip: () => void;
}

function SignupGate({ onSuccess, onSkip }: SignupGateProps) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), familySize: '2' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      // Save session if token returned
      if (data.token) {
        saveSession({ token: data.token, familySize: '2', expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
        onSuccess(data.token);
      } else {
        onSuccess('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-4 bg-gradient-to-br from-[#FEF3E2] to-[#FFFBF7] border-2 border-[#E17055]/20 rounded-2xl p-5">
      <div className="flex items-start gap-3 mb-4">
        <span className="text-2xl flex-shrink-0">🎉</span>
        <div>
          <div className="font-bold text-[#1D2324] text-sm">Your list is ready!</div>
          <div className="text-sm text-[#636E72] mt-0.5">Save it to your free account — we&apos;ll track prices and update your list every week.</div>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="your@email.com"
          className="flex-1 px-3 py-2.5 rounded-xl border-2 border-[#E8E2DC] focus:border-[#E17055] focus:outline-none text-sm text-[#1D2324] placeholder:text-[#B2BEC3] bg-white"
        />
        <button
          type="submit"
          disabled={submitting}
          className="flex-shrink-0 bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:from-[#D4604A] hover:to-[#C5533D] transition-all disabled:opacity-60 whitespace-nowrap"
        >
          {submitting ? '…' : 'Save my list →'}
        </button>
      </form>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      <button onClick={onSkip} className="text-xs text-[#B2BEC3] hover:text-[#636E72] mt-2 block transition">
        No thanks, just browsing
      </button>
    </div>
  );
}

export function HomePlanner() {
  const [householdSize, setHouseholdSize] = useState(2);
  const [started, setStarted] = useState(false);
  const [showGate, setShowGate] = useState(false);
  const [gateDone, setGateDone] = useState(false);
  const [session, setSession] = useState<{ token: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { messages, input, setInput, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/plan',
    body: { householdSize },
    streamProtocol: 'data',
    onFinish: () => {
      // Show signup gate after first result, if not logged in
      if (!session && !gateDone) {
        setTimeout(() => setShowGate(true), 400);
      }
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    },
  });

  useEffect(() => {
    const s = loadSession();
    if (s) { setSession(s); setGateDone(true); }
  }, []);

  useEffect(() => {
    if (isLoading) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [isLoading, messages]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    setStarted(true);
    setShowGate(false);
    handleSubmit(e);
  }

  function onExample(text: string) {
    setInput(text);
    inputRef.current?.focus();
  }

  function onGateSuccess(token: string) {
    if (token) setSession({ token });
    setShowGate(false);
    setGateDone(true);
  }

  const hasResult = messages.some(m => m.role === 'assistant');

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      {messages.length > 0 && (
        <div className="flex-1 space-y-3 mb-4 max-h-80 overflow-y-auto pr-1">
          {messages.map(m => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'assistant' && (
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#E17055] to-[#D4604A] flex items-center justify-center text-white text-[10px] font-bold mr-2 mt-1 flex-shrink-0">S</div>
              )}
              <div className={`max-w-[85%] rounded-2xl px-3 py-2.5 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-[#1D2324] text-white rounded-br-sm'
                  : 'bg-[#F5F0EB] text-[#1D2324] rounded-bl-sm'
              }`}>
                {m.role === 'assistant'
                  ? <FormattedMessage content={m.content} />
                  : <p>{m.content}</p>}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#E17055] to-[#D4604A] flex items-center justify-center text-white text-[10px] font-bold mr-2 mt-1 flex-shrink-0">S</div>
              <div className="bg-[#F5F0EB] rounded-2xl rounded-bl-sm px-3 py-2.5">
                <div className="flex gap-1 items-center h-4">
                  {[0, 150, 300].map(d => (
                    <span key={d} className="w-1.5 h-1.5 bg-[#E17055] rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Signup gate */}
      {showGate && hasResult && !session && (
        <SignupGate onSuccess={onGateSuccess} onSkip={() => { setShowGate(false); setGateDone(true); }} />
      )}

      {/* Logged-in save CTA */}
      {session && hasResult && !isLoading && (
        <div className="mb-3 flex items-center gap-2 text-xs text-[#5D9B8F] font-semibold">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
          List ready · <a href={`/list?token=${session.token}`} className="underline hover:text-[#4A8A7E]">View my saved list →</a>
        </div>
      )}

      {/* Input area */}
      <div>
        {/* Example chips — only before first submit */}
        {!started && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {EXAMPLES.map(e => (
              <button key={e} onClick={() => onExample(e)}
                className="text-xs bg-[#F5F0EB] text-[#636E72] px-2.5 py-1.5 rounded-full hover:bg-[#E17055]/10 hover:text-[#E17055] transition-all border border-transparent hover:border-[#E17055]/20">
                {e.length > 38 ? e.slice(0, 38) + '…' : e}
              </button>
            ))}
          </div>
        )}

        {/* Household size */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-[#636E72]">People:</span>
          <div className="flex gap-1">
            {[1,2,3,4,5,6].map(n => (
              <button key={n} onClick={() => setHouseholdSize(n)}
                className={`w-6 h-6 rounded-md text-xs font-bold transition-all ${householdSize === n ? 'bg-[#E17055] text-white' : 'bg-[#F5F0EB] text-[#636E72] hover:bg-[#E8E2DC]'}`}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={onSubmit} className="relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(e as unknown as React.FormEvent); }}}
            placeholder={started ? "Add a meal, change quantities, go vegetarian…" : "e.g. spaghetti bolognese, chicken stir fry, packed lunches…"}
            rows={2}
            className="w-full px-4 py-3 pr-12 rounded-xl border-2 border-[#E8E2DC] focus:border-[#E17055] focus:outline-none text-sm text-[#1D2324] placeholder:text-[#B2BEC3] resize-none bg-white transition"
          />
          <button type="submit" disabled={isLoading || !input.trim()}
            className="absolute right-2.5 bottom-2.5 w-8 h-8 bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white rounded-lg flex items-center justify-center hover:from-[#D4604A] hover:to-[#C5533D] transition-all disabled:opacity-40">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/>
            </svg>
          </button>
        </form>
        <p className="text-[11px] text-[#B2BEC3] mt-1.5 text-center">Prices from Tesco, Dunnes &amp; SuperValu · Free to use</p>
      </div>
    </div>
  );
}

function FormattedMessage({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <>
      {lines.map((line, i) => {
        if (!line.trim()) return <br key={i} />;
        if (line.startsWith('### ')) return <p key={i} className="font-bold text-[#1D2324] mt-2 mb-0.5 text-sm">{renderInline(line.slice(4))}</p>;
        if (line.startsWith('**') && line.endsWith('**') && line.length > 4) return <p key={i} className="font-semibold text-[#1D2324] mt-2 mb-0.5 text-xs uppercase tracking-wide">{renderInline(line.slice(2, -2))}</p>;
        if (line.startsWith('- ') || line.startsWith('* ')) return <p key={i} className="text-sm leading-snug pl-1">{renderInline(line.slice(2))}</p>;
        if (line.startsWith('---')) return <hr key={i} className="border-[#E8E2DC] my-2" />;
        if (line.startsWith('💡')) return <p key={i} className="mt-2 text-xs text-[#E17055] font-medium">{renderInline(line)}</p>;
        return <p key={i} className="text-sm leading-relaxed">{renderInline(line)}</p>;
      })}
    </>
  );
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
      : part
  );
}
