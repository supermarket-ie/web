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
        style={{ background: '#00944A' }}>
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
      <div className="px-4 py-8 max-w-2xl mx-auto">
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-28 rounded-2xl animate-pulse" style={{ background: 'var(--surface-container-low)' }} />)}
        </div>
      </div>
    );
  }

  const mealAgent = userAgents.find(a => a.agent_type === 'meal_planner') ?? null;
  const lunchAgent = userAgents.find(a => a.agent_type === 'lunch_planner') ?? null;

  return (
    <div className="px-4 py-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--on-background)' }}>Your agents</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--on-surface-variant)' }}>
        Agents that work for you — planning meals, watching prices, and keeping you informed.
      </p>

      {/* Main agents */}
      <MealPlannerCard token={token!} agent={mealAgent || lunchAgent} />

      {/* Background agents */}
      <h2 className="text-xs font-bold uppercase tracking-wider mt-8 mb-3" style={{ color: 'var(--on-surface-variant)' }}>
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

      {/* Custom agent input */}
      <div className="mt-8 rounded-2xl px-4 py-4"
        style={{ background: 'var(--surface-container-low)', border: '1px dashed var(--surface-container)' }}>
        <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--on-surface-variant)' }}>
          Add an agent
        </p>
        <p className="text-sm mb-3" style={{ color: 'var(--on-surface-variant)' }}>
          Tell me what you want and I'll set it up — alerts, reminders, recurring plans, anything.
        </p>
        <div className="flex gap-2">
          <input
            value={customInput}
            onChange={e => setCustomInput(e.target.value)}
            placeholder="e.g. Alert me when butter drops below €2.50"
            className="flex-1 px-3 py-2.5 rounded-xl text-sm border-0 outline-none"
            style={{ background: 'var(--surface-container-lowest)', color: 'var(--on-surface)' }}
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
              style={{ background: 'var(--surface-container)', color: 'var(--on-surface-variant)' }}>
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
