'use client';

import { useEffect, useState } from 'react';
import { loadSession } from '@/lib/session';

type Mode = 'important_only' | 'useful_updates' | 'quiet';
type Preferences = { proactivity: Mode; weeklyDigestEnabled: boolean; watchdogEnabled: boolean };

const MODES: Array<{ value: Mode; label: string; description: string }> = [
  { value: 'important_only', label: 'Important only', description: 'Only unusually strong automatic household signals should interrupt you.' },
  { value: 'useful_updates', label: 'Useful updates', description: 'Surface useful household changes more readily.' },
  { value: 'quiet', label: 'Quiet', description: 'Suppress automatic proactive messages. Explicit watches still work.' },
];

export function HouseholdAgentControls() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const token = loadSession()?.token;
    if (!token) return;
    fetch(`/api/agent/preferences?token=${encodeURIComponent(token)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setPrefs(data); })
      .catch(() => {});
  }, []);

  async function patch(next: Partial<Preferences>) {
    const token = loadSession()?.token;
    if (!token || !prefs) return;
    const optimistic = { ...prefs, ...next };
    setPrefs(optimistic);
    setSaving(true);
    try {
      const res = await fetch('/api/agent/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, ...next }),
      });
      if (!res.ok) setPrefs(prefs);
    } catch {
      setPrefs(prefs);
    } finally {
      setSaving(false);
    }
  }

  if (!prefs) return null;

  return (
    <section className="mt-8 space-y-4">
      <div>
        <h2 className="text-base font-bold" style={{ color: 'var(--on-surface)' }}>Updates & monitoring</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--on-surface-variant)' }}>Control how much Supermarket.ie should proactively surface. Explicit watches always remain under your control.</p>
      </div>

      <div className="rounded-2xl p-4 space-y-2" style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
        <p className="text-sm font-semibold mb-2" style={{ color: 'var(--on-surface)' }}>Proactive behaviour</p>
        {MODES.map(mode => (
          <button key={mode.value} type="button" onClick={() => void patch({ proactivity: mode.value })}
            className="w-full text-left rounded-xl px-3 py-3"
            style={{ border: prefs.proactivity === mode.value ? '1.5px solid #00944A' : '1px solid var(--surface-container)', background: prefs.proactivity === mode.value ? 'rgba(0,148,74,0.06)' : 'var(--surface)' }}>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ border: '1.5px solid #00944A', background: prefs.proactivity === mode.value ? '#00944A' : 'transparent' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--on-surface)' }}>{mode.label}</span>
            </div>
            <p className="text-xs mt-1 pl-5" style={{ color: 'var(--on-surface-variant)' }}>{mode.description}</p>
          </button>
        ))}
      </div>

      <div className="rounded-2xl divide-y" style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)', borderColor: 'var(--surface-container)' }}>
        <PreferenceRow title="Weekly email summary" description="A useful recap of changes affecting your household shop." enabled={prefs.weeklyDigestEnabled} onChange={v => void patch({ weeklyDigestEnabled: v })} />
        <PreferenceRow title="Automatic price monitoring" description="Allow Supermarket.ie to notice meaningful changes across your usual products." enabled={prefs.watchdogEnabled} onChange={v => void patch({ watchdogEnabled: v })} />
      </div>
      {saving && <p className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>Saving…</p>}
    </section>
  );
}

function PreferenceRow({ title, description, enabled, onChange }: { title: string; description: string; enabled: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div>
        <p className="text-sm font-semibold" style={{ color: 'var(--on-surface)' }}>{title}</p>
        <p className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>{description}</p>
      </div>
      <button type="button" aria-pressed={enabled} onClick={() => onChange(!enabled)} className="relative w-11 h-6 rounded-full flex-shrink-0" style={{ background: enabled ? '#00944A' : 'var(--surface-container)' }}>
        <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow" style={{ left: enabled ? 22 : 2 }} />
      </button>
    </div>
  );
}
