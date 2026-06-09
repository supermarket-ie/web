'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { loadSession } from '@/lib/session';

interface AgentStatus {
  weeklyDigest: { enabled: boolean; schedule: string };
  watchdog: { enabled: boolean; lastSent: string | null; schedule: string };
  priceAlerts: Array<{ id: string; product_name: string; target_price: number }>;
}

interface UserAgent {
  agent_type: string;
  enabled: boolean;
  last_run: string | null;
  last_output: string | null;
  config: Record<string, unknown>;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-IE', { month: 'short', day: 'numeric' });
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!enabled)}
      className="relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors duration-200"
      style={{ background: enabled ? '#00944A' : 'var(--surface-container)' }}>
      <span className="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 mt-0.5"
        style={{ marginLeft: enabled ? '22px' : '2px' }} />
    </button>
  );
}

// ── Agent Cards ──

function MealPlannerCard({ token, agent }: { token: string; agent: UserAgent | null }) {
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<string | null>(agent?.last_output ?? null);
  const [expanded, setExpanded] = useState(false);

  async function run(type: 'dinners' | 'lunches') {
    setLoading(true);
    setOutput(null);
    const res = await fetch('/api/agents/meal-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, config: { type } }),
    });
    const data = await res.json();
    setOutput(data.plan ?? 'Failed to generate plan');
    setLoading(false);
  }

  return (
    <div className="rounded-2xl overflow-hidden mb-4"
      style={{ border: '1px solid var(--surface-container)', background: 'var(--surface-container-lowest)' }}>
      <div className="px-4 py-3 flex items-center justify-between"
        style={{ background: 'linear-gradient(135deg, #006A35, #00944A)' }}>
        <div className="flex items-center gap-2">
          <span className="text-lg">🍽️</span>
          <span className="text-white text-sm font-bold">Meal planner</span>
        </div>
        {agent?.last_run && (
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.7)' }}>
            Last run: {timeAgo(agent.last_run)}
          </span>
        )}
      </div>
      <div className="px-4 py-4">
        <p className="text-sm mb-3" style={{ color: 'var(--on-surface)' }}>
          Generates dinner or lunch plans built around this week's cheapest items and promotions at Irish supermarkets. Uses your household profile.
        </p>

        {!output && !loading && (
          <div className="flex gap-2">
            <button onClick={() => run('dinners')}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
              style={{ background: '#00944A' }}>
              Plan 7 dinners →
            </button>
            <button onClick={() => run('lunches')}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
              style={{ background: 'var(--surface-container)', color: 'var(--on-surface)', border: '1px solid var(--outline-variant)' }}>
              Plan 5 lunches →
            </button>
          </div>
        )}

        {loading && (
          <div className="py-6 text-center">
            <div className="inline-block w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: '#00944A', borderTopColor: 'transparent' }} />
            <p className="text-xs mt-2" style={{ color: 'var(--on-surface-variant)' }}>
              Analysing this week's prices and building your plan...
            </p>
          </div>
        )}

        {output && (
          <div className="mt-2">
            <div className={`text-sm whitespace-pre-wrap leading-relaxed ${expanded ? '' : 'max-h-48 overflow-hidden relative'}`}
              style={{ color: 'var(--on-surface)' }}>
              {output.split('\n').map((line, i) => {
                if (line.startsWith('###')) return <h4 key={i} className="font-bold text-base mt-3 mb-1">{line.replace(/^###\s*/, '')}</h4>;
                if (line.startsWith('**') && line.endsWith('**')) return <p key={i} className="font-bold mt-2">{line.replace(/\*\*/g, '')}</p>;
                if (line.startsWith('- ')) return <p key={i} className="pl-3">{line}</p>;
                if (!line.trim()) return <br key={i} />;
                return <p key={i}>{line}</p>;
              })}
              {!expanded && (
                <div className="absolute bottom-0 left-0 right-0 h-16" style={{ background: 'linear-gradient(transparent, var(--surface-container-lowest))' }} />
              )}
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={() => setExpanded(!expanded)}
                className="text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ color: '#00944A' }}>
                {expanded ? 'Show less' : 'Show full plan'}
              </button>
              <button onClick={() => setOutput(null)}
                className="text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ color: 'var(--on-surface-variant)' }}>
                Run again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BackgroundAgentCard({ title, emoji, description, schedule, enabled, lastSent, onToggle }: {
  title: string;
  emoji: string;
  description: string;
  schedule: string;
  enabled: boolean;
  lastSent?: string | null;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div className="rounded-2xl overflow-hidden mb-3"
      style={{ border: '1px solid var(--surface-container)', background: 'var(--surface-container-lowest)', opacity: enabled ? 1 : 0.6 }}>
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">{emoji}</span>
          <div>
            <span className="font-bold text-sm" style={{ color: 'var(--on-background)' }}>{title}</span>
            <p className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>{schedule}{lastSent ? ` · Last: ${timeAgo(lastSent)}` : ''}</p>
          </div>
        </div>
        <Toggle enabled={enabled} onChange={onToggle} />
      </div>
      <div className="px-4 pb-3">
        <p className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>{description}</p>
      </div>
    </div>
  );
}

// ── Main Page ──

export default function AgentsPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [userAgents, setUserAgents] = useState<UserAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [customInput, setCustomInput] = useState('');

  useEffect(() => {
    const session = loadSession();
    if (!session?.token) { router.push('/'); return; }
    setToken(session.token);

    Promise.all([
      fetch(`/api/agents?token=${encodeURIComponent(session.token)}`).then(r => r.json()),
      fetch(`/api/agents/user?token=${encodeURIComponent(session.token)}`).then(r => r.ok ? r.json() : { agents: [] }),
    ]).then(([statusData, userData]) => {
      setStatus(statusData);
      setUserAgents(userData.agents ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [router]);

  async function toggleAgent(field: 'weeklyDigestEnabled' | 'watchdogEnabled', value: boolean) {
    if (!token) return;
    await fetch('/api/agents', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, [field]: value }),
    });
    setStatus(prev => prev ? {
      ...prev,
      weeklyDigest: field === 'weeklyDigestEnabled' ? { ...prev.weeklyDigest, enabled: value } : prev.weeklyDigest,
      watchdog: field === 'watchdogEnabled' ? { ...prev.watchdog, enabled: value } : prev.watchdog,
    } : prev);
  }

  if (loading) {
    return (
      <div className="min-h-screen relative overflow-hidden noise-bg" style={{ background: 'var(--surface)' }}>
        <div className="relative z-10 max-w-2xl mx-auto px-4 pt-6 pb-24 space-y-3">
          <div className="h-24 rounded-2xl animate-pulse" style={{ background: 'var(--surface-container-lowest)' }} />
          <div className="h-40 rounded-2xl animate-pulse" style={{ background: 'var(--surface-container-lowest)' }} />
          <div className="h-20 rounded-2xl animate-pulse" style={{ background: 'var(--surface-container-lowest)' }} />
        </div>
      </div>
    );
  }

  const mealAgent = userAgents.find(a => a.agent_type === 'meal_planner') ?? null;
  const lunchAgent = userAgents.find(a => a.agent_type === 'lunch_planner') ?? null;

  return (
    <div className="min-h-screen relative overflow-hidden noise-bg" style={{ background: 'var(--surface)' }}>
      {/* Background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="gradient-blob" style={{
          width: 500, height: 500,
          background: 'linear-gradient(135deg, rgba(0,106,53,0.10), rgba(107,254,156,0.07))',
          top: -200, left: -100,
        }} />
        <div className="gradient-blob" style={{
          width: 350, height: 350,
          background: 'linear-gradient(135deg, rgba(0,220,255,0.06), rgba(107,254,156,0.04))',
          top: '50%', right: -120,
        }} />
        <div className="absolute inset-0 dot-grid opacity-40" />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto px-4 pt-6 pb-24">
        {/* Header card */}
        <div className="rounded-2xl overflow-hidden mb-6"
          style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
          <div className="px-5 py-4 relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #006A35 0%, #00944A 60%, #00a854 100%)' }}>
            <div className="absolute pointer-events-none" style={{
              width: 200, height: 200, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(0,220,255,0.12) 0%, transparent 70%)',
              top: -60, right: -40,
            }} />
            <div className="relative">
              <h1 className="font-bold text-xl leading-tight" style={{
                background: 'linear-gradient(135deg, #ffffff, #6BFE9C)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              }}>Automations</h1>
              <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
                Agents that work in the background — planning meals, watching prices, keeping you informed.
              </p>
            </div>
          </div>
        </div>

        {/* Section label */}
        <h2 className="text-xs font-bold uppercase tracking-wider mb-3"
          style={{ color: '#00DCFF', textShadow: '0 0 10px rgba(0,220,255,0.3)' }}>
          On demand
        </h2>

        <MealPlannerCard token={token!} agent={mealAgent || lunchAgent} />

        <h2 className="text-xs font-bold uppercase tracking-wider mt-8 mb-3"
          style={{ color: '#00DCFF', textShadow: '0 0 10px rgba(0,220,255,0.3)' }}>
          Background agents
        </h2>

        {status && (
          <>
            <BackgroundAgentCard
              title="Weekly digest"
              emoji="📧"
              description="Personalised email with price changes, deals, and a one-click 'same again' link."
              schedule="Sunday 09:00"
              enabled={status.weeklyDigest.enabled}
              onToggle={v => toggleAgent('weeklyDigestEnabled', v)}
            />
            <BackgroundAgentCard
              title="Price watchdog"
              emoji="📊"
              description="Monitors your usual items daily. Alerts you when your basket gets meaningfully cheaper."
              schedule="Daily 08:30"
              enabled={status.watchdog.enabled}
              lastSent={status.watchdog.lastSent}
              onToggle={v => toggleAgent('watchdogEnabled', v)}
            />
          </>
        )}

        {/* Add an agent */}
        <h2 className="text-xs font-bold uppercase tracking-wider mt-8 mb-3"
          style={{ color: '#00DCFF', textShadow: '0 0 10px rgba(0,220,255,0.3)' }}>
          Add an agent
        </h2>
        <div className="rounded-2xl px-4 py-4"
          style={{ background: 'var(--surface-container-lowest)', border: '1px solid rgba(0,220,255,0.2)' }}>
          <p className="text-sm mb-3" style={{ color: 'var(--on-surface-variant)' }}>
            Tell me what you want and I&apos;ll set it up — alerts, reminders, recurring plans, anything.
          </p>
          <div className="flex gap-2">
            <input
              value={customInput}
              onChange={e => setCustomInput(e.target.value)}
              placeholder="e.g. Alert me when butter drops below €2.50"
              className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ background: 'var(--surface-container)', color: 'var(--on-surface)', border: '1px solid var(--surface-container-high)' }}
            />
            <button className="px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
              style={{ background: '#00944A' }}>
              Go
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {['Alert when eggs drop below €3', 'Thursday planning reminder', 'Cheapest basket this week'].map(s => (
              <button key={s} onClick={() => setCustomInput(s)}
                className="text-xs px-3 py-1.5 rounded-full transition-opacity hover:opacity-80"
                style={{ background: 'rgba(0,220,255,0.07)', color: 'var(--on-surface)', border: '1px solid rgba(0,220,255,0.25)' }}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
