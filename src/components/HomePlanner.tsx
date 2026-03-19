'use client';
import { useState, useRef, useEffect } from 'react';
import { saveSession, loadSession } from '@/lib/session';

const EXAMPLES = [
  "Spaghetti bolognese, chicken stir fry, packed lunches",
  "Sunday roast, midweek pasta, fish on Friday",
  "Healthy week — salads, grilled chicken, overnight oats",
  "Quick & easy — stir fries, soup, toasties",
];

interface Message { role: 'user' | 'assistant'; content: string; }

function SignupGate({ onSuccess, onSkip }: { onSuccess: (token: string) => void; onSkip: () => void }) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true); setError('');
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), familySize: '2' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
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
    <div className="mt-3 bg-gradient-to-br from-[#FEF3E2] to-[#FFFBF7] border-2 border-[#E17055]/20 rounded-2xl p-4">
      <div className="flex items-start gap-2.5 mb-3">
        <span className="text-xl flex-shrink-0">🎉</span>
        <div>
          <div className="font-bold text-[#1D2324] text-sm">Your list is ready!</div>
          <div className="text-xs text-[#636E72] mt-0.5">Save it free — we&apos;ll track prices and update it every week.</div>
        </div>
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
          placeholder="your@email.com"
          className="flex-1 px-3 py-2 rounded-xl border-2 border-[#E8E2DC] focus:border-[#E17055] focus:outline-none text-sm text-[#1D2324] placeholder:text-[#B2BEC3] bg-white min-w-0" />
        <button type="submit" disabled={submitting}
          className="flex-shrink-0 bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white px-3 py-2 rounded-xl text-xs font-semibold hover:from-[#D4604A] hover:to-[#C5533D] transition-all disabled:opacity-60 whitespace-nowrap">
          {submitting ? '…' : 'Save →'}
        </button>
      </form>
      {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
      <button onClick={onSkip} className="text-xs text-[#B2BEC3] hover:text-[#636E72] mt-1.5 block transition">No thanks</button>
    </div>
  );
}

export function HomePlanner() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [householdSize, setHouseholdSize] = useState(2);
  const [showGate, setShowGate] = useState(false);
  const [gateDone, setGateDone] = useState(false);
  const [session, setSession] = useState<{ token: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const s = loadSession();
    if (s) { setSession(s); setGateDone(true); }
  }, []);

  useEffect(() => {
    if (messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  async function sendMessage(userText: string) {
    if (!userText.trim() || isLoading) return;
    setStarted(true);
    setShowGate(false);

    const newMessages: Message[] = [...messages, { role: 'user', content: userText }];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    abortRef.current = new AbortController();

    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, householdSize }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error('Request failed');
      if (!res.body) throw new Error('No stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

      // Add placeholder
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          // Data stream format: 0:"text chunk"
          const match = line.match(/^0:"(.*)"$/);
          if (match) {
            // Unescape the JSON string content
            try {
              const text = JSON.parse(`"${match[1]}"`);
              assistantContent += text;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: assistantContent };
                return updated;
              });
            } catch {}
          }
        }
      }

      // Show signup gate after first result
      if (!session && !gateDone) {
        setTimeout(() => setShowGate(true), 500);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }]);
      }
    } finally {
      setIsLoading(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      {messages.length > 0 && (
        <div className="flex-1 space-y-3 mb-3 max-h-72 overflow-y-auto pr-1">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'assistant' && (
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#E17055] to-[#D4604A] flex items-center justify-center text-white text-[10px] font-bold mr-2 mt-1 flex-shrink-0">S</div>
              )}
              <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                m.role === 'user'
                  ? 'bg-[#1D2324] text-white rounded-br-sm'
                  : 'bg-[#F5F0EB] text-[#1D2324] rounded-bl-sm'
              }`}>
                {m.role === 'assistant' ? <FormattedMessage content={m.content} /> : <p>{m.content}</p>}
              </div>
            </div>
          ))}
          {isLoading && messages[messages.length - 1]?.content === '' && (
            <div className="flex justify-start">
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#E17055] to-[#D4604A] flex items-center justify-center text-white text-[10px] font-bold mr-2 mt-1 flex-shrink-0">S</div>
              <div className="bg-[#F5F0EB] rounded-2xl rounded-bl-sm px-3 py-2">
                <div className="flex gap-1 items-center h-4">
                  {[0,150,300].map(d => <span key={d} className="w-1.5 h-1.5 bg-[#E17055] rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />)}
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Signup gate */}
      {showGate && !session && (
        <SignupGate onSuccess={t => { if (t) setSession({ token: t }); setShowGate(false); setGateDone(true); }} onSkip={() => { setShowGate(false); setGateDone(true); }} />
      )}

      {/* Logged-in save link */}
      {session && messages.some(m => m.role === 'assistant' && m.content) && !isLoading && (
        <div className="mb-2 text-xs text-[#5D9B8F] font-semibold flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
          <a href={`/list?token=${session.token}`} className="underline hover:text-[#4A8A7E]">View my saved list →</a>
        </div>
      )}

      {/* Input */}
      <div>
        {!started && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {EXAMPLES.map(e => (
              <button key={e} type="button" onClick={() => { setInput(e); inputRef.current?.focus(); }}
                className="text-xs bg-[#F5F0EB] text-[#636E72] px-2.5 py-1.5 rounded-full hover:bg-[#E17055]/10 hover:text-[#E17055] transition-all border border-transparent hover:border-[#E17055]/20">
                {e.length > 38 ? e.slice(0, 38) + '…' : e}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-[#636E72]">People:</span>
          <div className="flex gap-1">
            {[1,2,3,4,5,6].map(n => (
              <button key={n} type="button" onClick={() => setHouseholdSize(n)}
                className={`w-6 h-6 rounded-md text-xs font-bold transition-all ${householdSize === n ? 'bg-[#E17055] text-white' : 'bg-[#F5F0EB] text-[#636E72] hover:bg-[#E8E2DC]'}`}>
                {n}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={onSubmit} className="relative">
          <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }}}
            placeholder={started ? "Add a meal, go vegetarian, change quantities…" : "e.g. spaghetti bolognese, chicken stir fry, packed lunches…"}
            rows={2}
            className="w-full px-4 py-3 pr-12 rounded-xl border-2 border-[#E8E2DC] focus:border-[#E17055] focus:outline-none text-sm text-[#1D2324] placeholder:text-[#B2BEC3] resize-none bg-white transition"
          />
          <button type="submit" disabled={isLoading || !input.trim()}
            className="absolute right-2.5 bottom-2.5 w-8 h-8 bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white rounded-lg flex items-center justify-center hover:from-[#D4604A] hover:to-[#C5533D] transition-all disabled:opacity-40">
            {isLoading
              ? <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
              : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/></svg>
            }
          </button>
        </form>
        <p className="text-[11px] text-[#B2BEC3] mt-1.5 text-center">Prices from Tesco, Dunnes &amp; SuperValu · Free to use</p>
      </div>
    </div>
  );
}

function FormattedMessage({ content }: { content: string }) {
  if (!content) return null;
  return (
    <>
      {content.split('\n').map((line, i) => {
        if (!line.trim()) return <br key={i} />;
        if (line.startsWith('### ')) return <p key={i} className="font-bold text-[#1D2324] mt-2 mb-0.5 text-sm">{ri(line.slice(4))}</p>;
        if (line.startsWith('**') && line.endsWith('**') && line.length > 4) return <p key={i} className="font-semibold text-[#1D2324] mt-2 mb-0.5 text-xs uppercase tracking-wide">{ri(line.slice(2,-2))}</p>;
        if (line.startsWith('- ') || line.startsWith('* ')) return <p key={i} className="text-sm leading-snug pl-1">{ri(line.slice(2))}</p>;
        if (line.startsWith('---')) return <hr key={i} className="border-[#E8E2DC] my-2" />;
        if (line.startsWith('💡')) return <p key={i} className="mt-2 text-xs text-[#E17055] font-medium">{ri(line)}</p>;
        return <p key={i} className="text-sm leading-relaxed">{ri(line)}</p>;
      })}
    </>
  );
}

function ri(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={i} className="font-semibold">{p.slice(2,-2)}</strong> : p
  );
}
