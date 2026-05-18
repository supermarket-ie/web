'use client';

import { useState, useEffect } from 'react';
import { loadSession } from '@/lib/session';

interface HouseholdProfile {
  adults: number;
  children: number;
  child_ages: string[];
  weekly_budget: number | null;
  preferred_stores: string[];
  dietary: string[];
  dislikes: string | null;
  meals: { breakfast: boolean; lunch: boolean; dinner: boolean; snacks: boolean };
  batch_cooking: boolean;
  skip_days: string | null;
  extra_context: string | null;
}

const STORES = ['tesco', 'dunnes', 'supervalu', 'aldi'];
const DIETARY_OPTIONS = ['vegetarian', 'vegan', 'gluten-free', 'dairy-free', 'halal', 'kosher', 'nut-free', 'low-carb'];

export function HouseholdEditor({ onSaved }: { onSaved?: () => void }) {
  const [profile, setProfile] = useState<HouseholdProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const session = loadSession();
    if (!session?.token) { setLoading(false); return; }

    fetch(`/api/household?token=${session.token}`)
      .then(r => r.json())
      .then(d => {
        setProfile(d.household ?? {
          adults: 2,
          children: 0,
          child_ages: [],
          weekly_budget: null,
          preferred_stores: ['all'],
          dietary: [],
          dislikes: null,
          meals: { breakfast: true, lunch: true, dinner: true, snacks: true },
          batch_cooking: false,
          skip_days: null,
          extra_context: null,
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave() {
    const session = loadSession();
    if (!session?.token || !profile) return;
    setSaving(true);

    // Map to PlannerProfile format for the API
    const body = {
      token: session.token,
      adults: profile.adults,
      children: profile.children,
      childAges: profile.child_ages,
      weeklyBudget: profile.weekly_budget,
      preferredStores: profile.preferred_stores,
      dietary: profile.dietary,
      dislikes: profile.dislikes,
      meals: profile.meals,
      batchCooking: profile.batch_cooking,
      skipDays: profile.skip_days,
      extraContext: profile.extra_context,
    };

    try {
      const res = await fetch('/api/household', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        onSaved?.();
      }
    } catch {}
    setSaving(false);
  }

  if (loading) return <div className="animate-pulse h-32 rounded-xl" style={{ background: 'var(--surface-container-lowest)' }} />;
  if (!profile) return null;

  function toggleStore(store: string) {
    setProfile(p => {
      if (!p) return p;
      const current = p.preferred_stores;
      if (store === 'all') return { ...p, preferred_stores: ['all'] };
      const without = current.filter(s => s !== 'all' && s !== store);
      const has = current.includes(store);
      const next = has ? without : [...without, store];
      return { ...p, preferred_stores: next.length === 0 ? ['all'] : next };
    });
  }

  function toggleDietary(item: string) {
    setProfile(p => {
      if (!p) return p;
      const has = p.dietary.includes(item);
      return { ...p, dietary: has ? p.dietary.filter(d => d !== item) : [...p.dietary, item] };
    });
  }

  function toggleMeal(meal: keyof HouseholdProfile['meals']) {
    setProfile(p => {
      if (!p) return p;
      return { ...p, meals: { ...p.meals, [meal]: !p.meals[meal] } };
    });
  }

  return (
    <div className="rounded-2xl p-5" style={{ background: 'var(--surface-container-lowest)' }}>
      <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--on-background)' }}>🏠 Household Profile</h3>

      {/* People */}
      <div className="mb-4">
        <label className="text-sm font-semibold block mb-1.5" style={{ color: 'var(--on-surface-variant)' }}>Household</label>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>Adults:</span>
            <select
              value={profile.adults}
              onChange={e => setProfile(p => p ? { ...p, adults: parseInt(e.target.value) } : p)}
              className="rounded-lg px-2 py-1 text-sm border"
              style={{ background: 'var(--surface-container)', color: 'var(--on-background)', borderColor: 'var(--outline-variant)' }}
            >
              {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>Children:</span>
            <select
              value={profile.children}
              onChange={e => setProfile(p => p ? { ...p, children: parseInt(e.target.value) } : p)}
              className="rounded-lg px-2 py-1 text-sm border"
              style={{ background: 'var(--surface-container)', color: 'var(--on-background)', borderColor: 'var(--outline-variant)' }}
            >
              {[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Budget */}
      <div className="mb-4">
        <label className="text-sm font-semibold block mb-1.5" style={{ color: 'var(--on-surface-variant)' }}>Weekly budget (optional)</label>
        <div className="flex items-center gap-2">
          <span className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>€</span>
          <input
            type="number"
            value={profile.weekly_budget ?? ''}
            onChange={e => setProfile(p => p ? { ...p, weekly_budget: e.target.value ? parseFloat(e.target.value) : null } : p)}
            placeholder="No limit"
            className="rounded-lg px-3 py-1.5 text-sm border w-24"
            style={{ background: 'var(--surface-container)', color: 'var(--on-background)', borderColor: 'var(--outline-variant)' }}
          />
          <span className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>per week</span>
        </div>
      </div>

      {/* Preferred stores */}
      <div className="mb-4">
        <label className="text-sm font-semibold block mb-1.5" style={{ color: 'var(--on-surface-variant)' }}>Preferred stores</label>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => toggleStore('all')}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${profile.preferred_stores.includes('all') ? 'text-white' : ''}`}
            style={{
              background: profile.preferred_stores.includes('all') ? 'var(--primary)' : 'transparent',
              borderColor: profile.preferred_stores.includes('all') ? 'var(--primary)' : 'var(--outline-variant)',
              color: profile.preferred_stores.includes('all') ? '#fff' : 'var(--on-surface-variant)',
            }}
          >
            All stores
          </button>
          {STORES.map(store => {
            const active = profile.preferred_stores.includes(store);
            return (
              <button
                key={store}
                onClick={() => toggleStore(store)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${active ? 'text-white' : ''}`}
                style={{
                  background: active ? 'var(--primary)' : 'transparent',
                  borderColor: active ? 'var(--primary)' : 'var(--outline-variant)',
                  color: active ? '#fff' : 'var(--on-surface-variant)',
                }}
              >
                {store.charAt(0).toUpperCase() + store.slice(1)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Dietary */}
      <div className="mb-4">
        <label className="text-sm font-semibold block mb-1.5" style={{ color: 'var(--on-surface-variant)' }}>Dietary requirements</label>
        <div className="flex flex-wrap gap-2">
          {DIETARY_OPTIONS.map(item => {
            const active = profile.dietary.includes(item);
            return (
              <button
                key={item}
                onClick={() => toggleDietary(item)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${active ? 'text-white' : ''}`}
                style={{
                  background: active ? 'var(--primary)' : 'transparent',
                  borderColor: active ? 'var(--primary)' : 'var(--outline-variant)',
                  color: active ? '#fff' : 'var(--on-surface-variant)',
                }}
              >
                {item}
              </button>
            );
          })}
        </div>
      </div>

      {/* Dislikes */}
      <div className="mb-4">
        <label className="text-sm font-semibold block mb-1.5" style={{ color: 'var(--on-surface-variant)' }}>Dislikes / avoid (optional)</label>
        <input
          type="text"
          value={profile.dislikes ?? ''}
          onChange={e => setProfile(p => p ? { ...p, dislikes: e.target.value || null } : p)}
          placeholder="e.g. mushrooms, olives, liver"
          className="rounded-lg px-3 py-1.5 text-sm border w-full"
          style={{ background: 'var(--surface-container)', color: 'var(--on-background)', borderColor: 'var(--outline-variant)' }}
        />
      </div>

      {/* Meals */}
      <div className="mb-4">
        <label className="text-sm font-semibold block mb-1.5" style={{ color: 'var(--on-surface-variant)' }}>Meals to plan</label>
        <div className="flex flex-wrap gap-2">
          {(['breakfast', 'lunch', 'dinner', 'snacks'] as const).map(meal => {
            const active = profile.meals[meal];
            return (
              <button
                key={meal}
                onClick={() => toggleMeal(meal)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition ${active ? 'text-white' : ''}`}
                style={{
                  background: active ? 'var(--primary)' : 'transparent',
                  borderColor: active ? 'var(--primary)' : 'var(--outline-variant)',
                  color: active ? '#fff' : 'var(--on-surface-variant)',
                }}
              >
                {meal.charAt(0).toUpperCase() + meal.slice(1)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Batch cooking */}
      <div className="mb-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={profile.batch_cooking}
            onChange={e => setProfile(p => p ? { ...p, batch_cooking: e.target.checked } : p)}
            className="rounded"
          />
          <span className="text-sm" style={{ color: 'var(--on-background)' }}>Batch cooking (cook once, eat twice)</span>
        </label>
      </div>

      {/* Extra context */}
      <div className="mb-5">
        <label className="text-sm font-semibold block mb-1.5" style={{ color: 'var(--on-surface-variant)' }}>Anything else?</label>
        <input
          type="text"
          value={profile.extra_context ?? ''}
          onChange={e => setProfile(p => p ? { ...p, extra_context: e.target.value || null } : p)}
          placeholder="e.g. eating out Tuesday, already have rice"
          className="rounded-lg px-3 py-1.5 text-sm border w-full"
          style={{ background: 'var(--surface-container)', color: 'var(--on-background)', borderColor: 'var(--outline-variant)' }}
        />
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full py-2.5 rounded-xl font-bold text-sm transition text-white"
        style={{ background: saved ? '#16a34a' : 'var(--primary)' }}
      >
        {saving ? 'Saving...' : saved ? '✓ Saved!' : 'Save profile'}
      </button>
    </div>
  );
}
