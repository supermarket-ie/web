'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { loadSession } from '@/lib/session';

interface AgentData {
  weeklyDigest: { enabled: boolean; schedule: string };
  watchdog: { enabled: boolean; lastSent: string | null; schedule: string };
  priceAlerts: Array<{ id: string; product_id: string; product_name: string; target_price: number; created_at: string }>;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(dateStr).toLocaleDateString('en-IE', { month: 'short', day: 'numeric' });
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className="relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors duration-200"
      style={{ background: enabled ? '#00944A' : 'var(--surface-container)' }}
    >
      <span
        className="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 mt-0.5"
        style={{ marginLeft: enabled ? '22px' : '2px' }}
      />
    </button>
  );
}

function AgentCard({ title, description, schedule, lastSent, enabled, onToggle, children }: {
  title: string;
  description: string;
  schedule: string;
  lastSent?: string | null;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl overflow-hidden mb-4"
      style={{ border: '1px solid var(--surface-container)', background: 'var(--surface-container-lowest)', opacity: enabled ? 1 : 0.6 }}>
      <div className="px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--surface-container)' }}>
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full" style={{ background: enabled ? '#00944A' : 'var(--on-surface-variant)' }} />
          <span className="font-bold text-sm" style={{ color: 'var(--on-background)' }}>{title}</span>
        </div>
        <Toggle enabled={enabled} onChange={onToggle} />
      </div>
      <div className="px-4 py-3">
        <p className="text-sm mb-2" style={{ color: 'var(--on-surface)' }}>{description}</p>
        <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--on-surface-variant)' }}>
          <span>🕐 {schedule}</span>
          {lastSent && <span>Last sent: {timeAgo(lastSent)}</span>}
        </div>
        {children}
      </div>
    </div>
  );
}

export default function AgentsPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<AgentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    const session = loadSession();
    if (!session?.token) { router.push('/'); return; }
    setToken(session.token);
    fetch(`/api/agents?token=${encodeURIComponent(session.token)}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [router]);

  async function toggle(field: 'weeklyDigestEnabled' | 'watchdogEnabled', value: boolean) {
    if (!token || !data) return;
    setSaving(field);
    await fetch('/api/agents', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, [field]: value }),
    });
    setData(prev => prev ? {
      ...prev,
      weeklyDigest: field === 'weeklyDigestEnabled' ? { ...prev.weeklyDigest, enabled: value } : prev.weeklyDigest,
      watchdog: field === 'watchdogEnabled' ? { ...prev.watchdog, enabled: value } : prev.watchdog,
    } : prev);
    setSaving(null);
  }

  async function deleteAlert(alertId: string) {
    if (!token) return;
    await fetch('/api/alerts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, alert_id: alertId }),
    });
    setData(prev => prev ? { ...prev, priceAlerts: prev.priceAlerts.filter(a => a.id !== alertId) } : prev);
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

  if (!data) return null;

  return (
    <div className="px-4 py-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--on-background)' }}>Your agents</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--on-surface-variant)' }}>
        Background agents working on your behalf — toggle them on or off anytime.
      </p>

      <AgentCard
        title="Weekly digest"
        description="A personalised email every week with price changes on your usual items, top deals, and a one-click 'same again' link."
        schedule={data.weeklyDigest.schedule}
        enabled={data.weeklyDigest.enabled}
        onToggle={v => toggle('weeklyDigestEnabled', v)}
      />

      <AgentCard
        title="Price watchdog"
        description="Monitors your usual items daily. Alerts you when your basket gets meaningfully cheaper — or when it's worth switching stores."
        schedule={data.watchdog.schedule}
        lastSent={data.watchdog.lastSent}
        enabled={data.watchdog.enabled}
        onToggle={v => toggle('watchdogEnabled', v)}
      />

      {/* Price alerts */}
      <div className="rounded-2xl overflow-hidden mb-4"
        style={{ border: '1px solid var(--surface-container)', background: 'var(--surface-container-lowest)' }}>
        <div className="px-4 py-3 flex items-center gap-3"
          style={{ borderBottom: '1px solid var(--surface-container)' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: data.priceAlerts.length > 0 ? '#00944A' : 'var(--surface-container)' }} />
          <span className="font-bold text-sm" style={{ color: 'var(--on-background)' }}>Price alerts</span>
          {data.priceAlerts.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{ background: 'var(--primary-container)', color: 'var(--on-primary-container)' }}>
              {data.priceAlerts.length} active
            </span>
          )}
        </div>
        <div className="px-4 py-3">
          {data.priceAlerts.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>
              No active price alerts. You can set these from your grocery list.
            </p>
          ) : (
            <div className="space-y-2">
              {data.priceAlerts.map(alert => (
                <div key={alert.id} className="flex items-center justify-between py-1.5">
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--on-background)' }}>{alert.product_name}</p>
                    <p className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>
                      Alert when below €{alert.target_price.toFixed(2)}
                    </p>
                  </div>
                  <button onClick={() => deleteAlert(alert.id)}
                    className="text-xs px-3 py-1.5 rounded-lg transition-opacity hover:opacity-70"
                    style={{ color: '#dc2626', background: '#fef2f2' }}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Coming soon */}
      <div className="rounded-2xl px-4 py-4"
        style={{ background: 'var(--surface-container-low)', border: '1px dashed var(--surface-container)' }}>
        <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--on-surface-variant)' }}>Coming soon</p>
        <div className="space-y-1.5">
          {['Shopping reminder (Thursday nudge if you haven\'t planned)', 'Deal hunter — alerts when items on your list go on promotion', 'Budget tracker — weekly spend vs your target'].map(item => (
            <p key={item} className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>· {item}</p>
          ))}
        </div>
      </div>
    </div>
  );
}
