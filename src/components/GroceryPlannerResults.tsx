'use client';
import { useState, useRef, useEffect } from 'react';
import { storeStyle, storeDisplayName } from '@/lib/store-utils';
import { saveSession, loadSession } from '@/lib/session';

// ─── Animated price (cheapest store total) ──────────────────────────────
function AnimatedPrice({ target, duration = 1000 }: { target: number; duration?: number }) {
  const [current, setCurrent] = useState(0);
  const animatedRef = useRef(false);

  useEffect(() => {
    if (animatedRef.current) return;
    animatedRef.current = true;
    let startTime: number;
    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      setCurrent(target * progress);
      if (progress < 1) requestAnimationFrame(animate);
      else setCurrent(target);
    };
    requestAnimationFrame(animate);
  }, [target, duration]);

  return <span>€{current.toFixed(2)}</span>;
}

// ─── Store totals parser ────────────────────────────────────────────────
interface StoreTotal { store: string; total: number; items?: number; cheapest?: boolean; }

function parseStoreTotals(content: string): StoreTotal[] {
  const lines = content.split('\n');
  const totals: StoreTotal[] = [];
  let inStoreSection = false;

  for (const line of lines) {
    if (line.toLowerCase().includes('store total') || line.toLowerCase().includes('best value')) {
      inStoreSection = true;
      continue;
    }
    if (inStoreSection && line.trim() === '') break;
    if (inStoreSection) {
      const match = line.match(/\*?\*?(tesco|dunnes|supervalu|aldi|lidl)\*?\*?:?\s*€?(\d+(?:\.\d{2})?)\s*(?:\((\d+)\s*items?\))?/i);
      if (match) {
        const store = match[1].toLowerCase();
        const total = parseFloat(match[2]);
        const items = match[3] ? parseInt(match[3], 10) : undefined;
        if (!isNaN(total)) totals.push({ store, total, items });
      }
    }
  }

  if (totals.length > 0) {
    const maxItems = Math.max(...totals.map(t => t.items ?? 0));
    if (maxItems > 0) {
      const threshold = Math.floor(maxItems * 0.7);
      const candidates = totals.filter(t => (t.items ?? 0) >= threshold);
      if (candidates.length > 0) {
        const cheapest = candidates.reduce((min, c) => c.total < min.total ? c : min);
        cheapest.cheapest = true;
      }
    } else {
      const sorted = [...totals].sort((a, b) => b.total - a.total);
      const highest = sorted[0].total;
      const lowest = sorted[sorted.length - 1].total;
      if (lowest / highest >= 0.7) {
        const cheapest = totals.reduce((min, c) => c.total < min.total ? c : min);
        cheapest.cheapest = true;
      } else {
        sorted[0].cheapest = true;
      }
    }
  }
  return totals;
}

// ─── Formatted message renderer ─────────────────────────────────────────
function FormattedMessage({ content }: { content: string }) {
  if (!content) return null;
  const storeTotals = parseStoreTotals(content);
  const lines = content.split('\n');

  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        if (!line.trim()) return <br key={i} />;
        if (line.startsWith('### '))
          return <h4 key={i} className="font-bold text-base mt-4 mb-2" style={{ color: 'var(--on-background)' }}>{line.slice(4)}</h4>;
        if (line.startsWith('**') && line.endsWith('**') && line.length > 4)
          return <h5 key={i} className="type-label mt-3 mb-1" style={{ color: 'var(--on-background)' }}>{line.slice(2, -2)}</h5>;
        if (line.startsWith('- ') || line.startsWith('* '))
          return <p key={i} className="text-sm leading-relaxed pl-4" style={{ color: 'var(--on-surface)' }}>{line.slice(2)}</p>;
        if (line.startsWith('---'))
          return <hr key={i} className="my-3" style={{ borderColor: 'var(--outline-variant)' }} />;
        if (line.startsWith('💡'))
          return (
            <div key={i} className="mt-3 p-3 rounded-xl" style={{ background: 'var(--primary-fixed)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--on-primary-container)' }}>{line}</p>
            </div>
          );
        return <p key={i} className="text-sm leading-relaxed" style={{ color: 'var(--on-surface)' }}>{line}</p>;
      })}

      {storeTotals.length > 0 && (
        <div className="mt-4 space-y-2">
          <h5 className="type-label" style={{ color: 'var(--on-background)' }}>STORE TOTALS</h5>
          <div className="flex flex-wrap gap-2">
            {storeTotals.map((total, i) => (
              <div key={i} className="px-3 py-2 rounded-xl text-white text-sm font-bold flex items-center gap-2"
                style={{ background: storeStyle(total.store).bg }}>
                <span>{storeDisplayName(total.store)}</span>
                {total.cheapest ? <AnimatedPrice target={total.total} /> : <span className="price">€{total.total.toFixed(2)}</span>}
                {total.cheapest && <span className="text-xs bg-white/20 px-1.5 py-0.5 rounded-full">Cheapest</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Share button ───────────────────────────────────────────────────────
function ShareButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function handleShare() {
    try {
      const plain = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1');
      await navigator.clipboard.writeText(plain);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }
  return (
    <button onClick={handleShare} className="btn-secondary px-4 py-2 text-sm font-semibold rounded-xl flex items-center gap-2"
      style={{ opacity: copied ? 0.6 : 1 }}>
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
      </svg>
      {copied ? 'Copied!' : 'Share list'}
    </button>
  );
}

// ─── Email capture card ─────────────────────────────────────────────────
function EmailCaptureCard({ householdSize, onSuccess, onDismiss, session }: {
  householdSize: number; onSuccess: () => void; onDismiss: () => void; session: { token: string } | null;
}) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSubmitting(true); setError('');
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), familySize: String(householdSize) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      if (data.token) {
        saveSession({ token: data.token, familySize: String(householdSize), expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
        onSuccess();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setSubmitting(false);
    }
  }

  async function handleSaveToList() {
    if (!session?.token) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/lists/save-from-planner', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: session.token }),
      });
      if (res.ok) onSuccess();
    } catch { setError('Failed to save list'); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="mt-4 rounded-2xl p-4" style={{ background: 'var(--primary-fixed)', border: '1px solid rgba(0, 106, 53, 0.1)' }}>
      <div className="flex items-start gap-3">
        <span className="text-xl flex-shrink-0">📩</span>
        <div className="flex-1">
          <div className="font-bold text-sm mb-1" style={{ color: 'var(--on-primary-container)' }}>
            Get this list emailed to you — we'll update your prices every Monday.
          </div>
          {session ? (
            <button onClick={handleSaveToList} disabled={submitting}
              className="btn-primary px-4 py-2 text-sm font-semibold rounded-xl disabled:opacity-60">
              {submitting ? 'Saving...' : 'Save to my list →'}
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="flex gap-2 mt-2">
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="flex-1 px-3 py-2 rounded-xl focus:outline-none text-sm min-w-0"
                style={{ background: 'var(--surface-container-lowest)', color: 'var(--on-background)', border: '1px solid var(--surface-container)' }} />
              <button type="submit" disabled={submitting}
                className="btn-primary flex-shrink-0 px-4 py-2 text-sm whitespace-nowrap disabled:opacity-60">
                {submitting ? 'Saving...' : 'Save my list →'}
              </button>
            </form>
          )}
          {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
          <button onClick={onDismiss} className="text-xs mt-2 transition" style={{ color: 'var(--on-surface-variant)' }}>No thanks</button>
        </div>
      </div>
    </div>
  );
}

// ─── Progress messages ──────────────────────────────────────────────────
const PROGRESS_MESSAGES = [
  "Checking this week's promotions...",
  "Scanning categories...",
  "Comparing prices across stores...",
  "Building your grocery list...",
  "Finding the best deals for your household...",
];

function StreamingIndicator({ message }: { message: string }) {
  return (
    <div className="flex justify-start">
      <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold mr-2 mt-1 flex-shrink-0"
        style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))' }}>S</div>
      <div className="rounded-2xl rounded-bl-sm px-3 py-2 text-sm"
        style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {[0, 150, 300].map(delay => (
              <span key={delay} className="w-1.5 h-1.5 rounded-full animate-bounce"
                style={{ background: 'var(--primary)', animationDelay: `${delay}ms` }} />
            ))}
          </div>
          <span style={{ color: 'var(--on-surface)' }}>{message}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Main results component ─────────────────────────────────────────────
interface Props {
  resultContent: string;
  isLoading: boolean;
  progressIndex: number;
  householdSize: number;
  onEditPlan: () => void;
}

export function GroceryPlannerResults({ resultContent, isLoading, progressIndex, householdSize, onEditPlan }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<{ token: string } | null>(null);
  const [showEmailCapture, setShowEmailCapture] = useState(false);
  const [emailCaptured, setEmailCaptured] = useState(false);

  useEffect(() => {
    const s = loadSession();
    if (s) { setSession(s); setEmailCaptured(true); }
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [resultContent]);

  // Show email capture after substantial response
  useEffect(() => {
    if (!isLoading && resultContent.length > 200 && !session && !emailCaptured) {
      setTimeout(() => setShowEmailCapture(true), 800);
    }
  }, [isLoading, resultContent, session, emailCaptured]);

  const showShareButton = !isLoading && resultContent && (resultContent.includes('🛒') || resultContent.length > 100);

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 mb-4" style={{ maxHeight: '65vh' }}>
        {/* AI response */}
        {resultContent && (
          <div className="flex justify-start">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold mr-2 mt-1 flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-container))' }}>S</div>
            <div className="max-w-[95%] rounded-2xl rounded-bl-sm px-4 py-3 text-sm"
              style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
              <FormattedMessage content={resultContent} />
            </div>
          </div>
        )}

        {/* Loading */}
        {isLoading && <StreamingIndicator message={PROGRESS_MESSAGES[progressIndex % PROGRESS_MESSAGES.length]} />}
      </div>

      {/* Email capture */}
      {showEmailCapture && !emailCaptured && (
        <EmailCaptureCard
          householdSize={householdSize}
          session={session}
          onSuccess={() => { setEmailCaptured(true); setShowEmailCapture(false); const s = loadSession(); if (s) setSession(s); }}
          onDismiss={() => { setShowEmailCapture(false); setEmailCaptured(true); }}
        />
      )}

      {/* Actions */}
      {!isLoading && resultContent && (
        <div className="flex items-center gap-2 mt-2">
          <button onClick={onEditPlan}
            className="btn-secondary px-4 py-2 text-sm font-semibold rounded-xl flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Edit my plan
          </button>
          {showShareButton && <ShareButton text={resultContent} />}
        </div>
      )}
    </div>
  );
}
