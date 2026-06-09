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

const STORES = [
  { id: 'tesco',     label: 'Tesco',     color: '#003A8C' },
  { id: 'dunnes',    label: 'Dunnes',    color: '#7B0017' },
  { id: 'supervalu', label: 'SuperValu', color: '#D4400F' },
  { id: 'aldi',      label: 'Aldi',      color: '#00616A' },
];

const DIETARY_OPTIONS = [
  { id: 'vegetarian', label: 'Vegetarian', emoji: '🥦' },
  { id: 'vegan',      label: 'Vegan',      emoji: '🌱' },
  { id: 'gluten-free', label: 'Gluten-free', emoji: '🌾' },
  { id: 'dairy-free', label: 'Dairy-free',  emoji: '🥛' },
  { id: 'halal',      label: 'Halal',      emoji: '☪️' },
  { id: 'kosher',     label: 'Kosher',     emoji: '✡️' },
  { id: 'nut-free',   label: 'Nut-free',   emoji: '🥜' },
  { id: 'low-carb',   label: 'Low-carb',   emoji: '🥩' },
];

const MEALS = [
  { id: 'breakfast', label: 'Breakfast', emoji: '🍳' },
  { id: 'lunch',     label: 'Lunch',     emoji: '🥪' },
  { id: 'dinner',    label: 'Dinner',    emoji: '🍽️' },
  { id: 'snacks',    label: 'Snacks',    emoji: '🍎' },
] as const;

// ─── Reusable sub-components ─────────────────────────────────────────────────

function FieldSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: '#00DCFF', textShadow: '0 0 10px rgba(0,220,255,0.3)' }}>
          {title}
        </h3>
        {subtitle && <p className="text-xs mt-0.5" style={{ color: 'var(--on-surface-variant)' }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 rounded-xl"
      style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
      <span className="text-sm font-medium" style={{ color: 'var(--on-background)' }}>{label}</span>
      <div className="flex items-center gap-3">
        <button
          onClick={() => onChange(Math.max(min, value - 1))}
          className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-lg transition-opacity hover:opacity-80"
          style={{ background: 'var(--surface-container)', color: 'var(--on-surface)' }}>
          −
        </button>
        <span className="text-lg font-bold w-5 text-center" style={{ color: 'var(--on-background)' }}>{value}</span>
        <button
          onClick={() => onChange(Math.min(max, value + 1))}
          className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-lg transition-opacity hover:opacity-80"
          style={{ background: '#00944A', color: '#fff' }}>
          +
        </button>
      </div>
    </div>
  );
}

function ToggleChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className="px-3.5 py-2 rounded-xl text-sm font-semibold transition-all"
      style={{
        background: active ? '#00944A' : 'var(--surface-container-lowest)',
        color: active ? '#fff' : 'var(--on-surface)',
        border: active ? '1.5px solid #00944A' : '1.5px solid var(--surface-container)',
      }}>
      {children}
    </button>
  );
}

function StoreChip({ store, active, onClick }: { store: typeof STORES[0]; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="px-3.5 py-2 rounded-xl text-sm font-semibold transition-all"
      style={{
        background: active ? store.color : 'var(--surface-container-lowest)',
        color: active ? '#fff' : 'var(--on-surface)',
        border: active ? `1.5px solid ${store.color}` : '1.5px solid var(--surface-container)',
      }}>
      {store.label}
    </button>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

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
          adults: 2, children: 0, child_ages: [],
          weekly_budget: null, preferred_stores: ['all'], dietary: [],
          dislikes: null,
          meals: { breakfast: true, lunch: true, dinner: true, snacks: true },
          batch_cooking: false, skip_days: null, extra_context: null,
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave() {
    const session = loadSession();
    if (!session?.token || !profile) return;
    setSaving(true);
    try {
      const res = await fetch('/api/household', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: session.token,
          adults: profile.adults, children: profile.children,
          childAges: profile.child_ages, weeklyBudget: profile.weekly_budget,
          preferredStores: profile.preferred_stores, dietary: profile.dietary,
          dislikes: profile.dislikes, meals: profile.meals,
          batchCooking: profile.batch_cooking, skipDays: profile.skip_days,
          extraContext: profile.extra_context,
        }),
      });
      if (res.ok) { setSaved(true); setTimeout(() => setSaved(false), 2500); onSaved?.(); }
    } catch {}
    setSaving(false);
  }

  function toggleStore(store: string) {
    setProfile(p => {
      if (!p) return p;
      if (store === 'all') return { ...p, preferred_stores: ['all'] };
      const without = p.preferred_stores.filter(s => s !== 'all' && s !== store);
      const has = p.preferred_stores.includes(store);
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
    setProfile(p => p ? { ...p, meals: { ...p.meals, [meal]: !p.meals[meal] } } : p);
  }

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-14 rounded-2xl animate-pulse" style={{ background: 'var(--surface-container-lowest)' }} />
        ))}
      </div>
    );
  }
  if (!profile) return null;

  const totalPeople = profile.adults + profile.children;

  return (
    <div className="space-y-1">

      {/* ── Household size ── */}
      <FieldSection title="Household" subtitle="Who are you shopping for?">
        <div className="space-y-2">
          <Stepper label="Adults" value={profile.adults} min={1} max={8}
            onChange={n => setProfile(p => p ? { ...p, adults: n } : p)} />
          <Stepper label="Children" value={profile.children} min={0} max={8}
            onChange={n => setProfile(p => p ? { ...p, children: n } : p)} />
        </div>
        {totalPeople > 0 && (
          <p className="text-xs mt-2 pl-1" style={{ color: 'var(--on-surface-variant)' }}>
            {totalPeople} {totalPeople === 1 ? 'person' : 'people'} total
          </p>
        )}
      </FieldSection>

      {/* ── Weekly budget ── */}
      <FieldSection title="Weekly Budget" subtitle="The agent will try to stay within this.">
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
          style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
          <span className="text-lg font-bold" style={{ color: 'var(--on-surface-variant)' }}>€</span>
          <input
            type="number"
            value={profile.weekly_budget ?? ''}
            onChange={e => setProfile(p => p ? { ...p, weekly_budget: e.target.value ? parseFloat(e.target.value) : null } : p)}
            placeholder="No limit"
            className="flex-1 bg-transparent text-base font-semibold outline-none"
            style={{ color: 'var(--on-background)' }}
          />
          <span className="text-sm" style={{ color: 'var(--on-surface-variant)' }}>per week</span>
        </div>
      </FieldSection>

      {/* ── Preferred stores ── */}
      <FieldSection title="Preferred Stores" subtitle="Which supermarkets do you want to shop at?">
        <div className="flex flex-wrap gap-2">
          <ToggleChip active={profile.preferred_stores.includes('all')} onClick={() => toggleStore('all')}>
            All stores
          </ToggleChip>
          {STORES.map(store => (
            <StoreChip key={store.id} store={store}
              active={profile.preferred_stores.includes(store.id)}
              onClick={() => toggleStore(store.id)} />
          ))}
        </div>
      </FieldSection>

      {/* ── Dietary ── */}
      <FieldSection title="Dietary Requirements" subtitle="The agent will only suggest compliant products.">
        <div className="flex flex-wrap gap-2">
          {DIETARY_OPTIONS.map(opt => (
            <ToggleChip key={opt.id} active={profile.dietary.includes(opt.id)} onClick={() => toggleDietary(opt.id)}>
              {opt.emoji} {opt.label}
            </ToggleChip>
          ))}
        </div>
      </FieldSection>

      {/* ── Meals ── */}
      <FieldSection title="Meals to Plan">
        <div className="flex flex-wrap gap-2">
          {MEALS.map(meal => (
            <ToggleChip key={meal.id} active={profile.meals[meal.id]} onClick={() => toggleMeal(meal.id)}>
              {meal.emoji} {meal.label}
            </ToggleChip>
          ))}
        </div>
        <label className="flex items-center gap-3 mt-3 px-4 py-3 rounded-xl cursor-pointer"
          style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
          <div className="relative flex-shrink-0">
            <input type="checkbox" className="sr-only" checked={profile.batch_cooking}
              onChange={e => setProfile(p => p ? { ...p, batch_cooking: e.target.checked } : p)} />
            <div className="w-10 h-6 rounded-full transition-all"
              style={{ background: profile.batch_cooking ? '#00944A' : 'var(--surface-container)' }} />
            <div className="absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all"
              style={{ left: profile.batch_cooking ? '1.25rem' : '0.25rem' }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--on-background)' }}>Batch cooking</p>
            <p className="text-xs" style={{ color: 'var(--on-surface-variant)' }}>Cook once, eat twice — doubles up quantities</p>
          </div>
        </label>
      </FieldSection>

      {/* ── Dislikes ── */}
      <FieldSection title="Dislikes / Avoid" subtitle="The agent won't suggest these.">
        <input
          type="text"
          value={profile.dislikes ?? ''}
          onChange={e => setProfile(p => p ? { ...p, dislikes: e.target.value || null } : p)}
          placeholder="e.g. mushrooms, olives, liver"
          className="w-full px-4 py-3 rounded-xl text-sm outline-none"
          style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)', color: 'var(--on-background)' }}
        />
      </FieldSection>

      {/* ── Anything else ── */}
      <FieldSection title="Anything else?" subtitle="Extra context the agent should know.">
        <textarea
          value={profile.extra_context ?? ''}
          onChange={e => setProfile(p => p ? { ...p, extra_context: e.target.value || null } : p)}
          placeholder="e.g. eating out on Tuesday, already have rice and pasta, school lunches Mon–Fri"
          rows={3}
          className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-none"
          style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)', color: 'var(--on-background)' }}
        />
      </FieldSection>

      {/* ── Save ── */}
      <button onClick={handleSave} disabled={saving}
        className="w-full py-3.5 rounded-2xl font-bold text-base transition-all text-white"
        style={{ background: saved ? '#16a34a' : 'linear-gradient(135deg, #006A35, #00944A)' }}>
        {saving ? 'Saving…' : saved ? '✓ Saved!' : 'Save household'}
      </button>
    </div>
  );
}
