'use client';
import { useState } from 'react';
import type { PlannerProfile } from '@/lib/session';

const DIETARY_OPTIONS = [
  'Vegetarian', 'Vegan', 'Gluten-free', 'Dairy-free',
  'Halal', 'Low-carb', 'Diabetic-friendly', 'Nut-free',
];

const BUDGET_PRESETS = [50, 70, 100, 120];
type ChildAge = 'toddler' | 'young' | 'older' | 'teen';
const CHILD_AGE_OPTIONS: { value: ChildAge; label: string }[] = [
  { value: 'toddler', label: '1-3 yrs' },
  { value: 'young', label: '4-8 yrs' },
  { value: 'older', label: '9-12 yrs' },
  { value: 'teen', label: '13-17 yrs' },
];

const MEAL_PRESETS = [
  { label: 'Full week — all meals', meals: { breakfast: true, lunch: true, dinner: true, snacks: true } },
  { label: 'Dinners only', meals: { breakfast: false, lunch: false, dinner: true, snacks: false } },
  { label: 'Weekday lunches + dinners', meals: { breakfast: false, lunch: true, dinner: true, snacks: false } },
  { label: 'School week (B+L+D Mon-Fri)', meals: { breakfast: true, lunch: true, dinner: true, snacks: true } },
];

const CONTEXT_SUGGESTIONS = [
  "We have leftover chicken in the fridge",
  "Already have rice, pasta, and tinned tomatoes",
  "Include toilet roll and bin bags",
  "Birthday party Saturday — need cake stuff",
];

function Stepper({ value, onChange, min = 0, max = 8, label }: {
  value: number; onChange: (n: number) => void; min?: number; max?: number; label: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm font-medium w-20" style={{ color: 'var(--on-surface)' }}>{label}</span>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-lg transition"
        style={{ background: 'var(--surface-container)', color: 'var(--on-surface)' }}
        disabled={value <= min}
      >−</button>
      <span className="w-6 text-center font-bold" style={{ color: 'var(--on-background)' }}>{value}</span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-lg transition"
        style={{ background: 'var(--surface-container)', color: 'var(--on-surface)' }}
        disabled={value >= max}
      >+</button>
    </div>
  );
}

function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 rounded-full text-sm font-medium transition-all"
      style={selected
        ? { background: 'var(--primary)', color: 'var(--on-primary)' }
        : { background: 'var(--surface-container)', color: 'var(--on-surface)' }
      }
    >{label}</button>
  );
}

interface Props {
  initialProfile?: PlannerProfile | null;
  onSubmit: (profile: PlannerProfile) => void;
}

export function GroceryPlannerSetup({ initialProfile, onSubmit }: Props) {
  const [adults, setAdults] = useState(initialProfile?.adults ?? 2);
  const [children, setChildren] = useState(initialProfile?.children ?? 0);
  const [childAges, setChildAges] = useState<PlannerProfile['childAges']>(initialProfile?.childAges ?? []);
  const [weeklyBudget, setWeeklyBudget] = useState<number | undefined>(initialProfile?.weeklyBudget);
  const [customBudget, setCustomBudget] = useState('');
  const [preferredStores, setPreferredStores] = useState<string[]>(initialProfile?.preferredStores ?? ['all']);
  const [dietary, setDietary] = useState<string[]>(initialProfile?.dietary ?? []);
  const [dislikes, setDislikes] = useState(initialProfile?.dislikes ?? '');
  const [meals, setMeals] = useState(initialProfile?.meals ?? { breakfast: true, lunch: true, dinner: true, snacks: false });
  const [batchCooking, setBatchCooking] = useState(initialProfile?.batchCooking ?? false);
  const [skipDays, setSkipDays] = useState(initialProfile?.skipDays ?? '');
  const [extraContext, setExtraContext] = useState(initialProfile?.extraContext ?? '');
  const [showDietary, setShowDietary] = useState((initialProfile?.dietary?.length ?? 0) > 0);

  function toggleStore(store: string) {
    if (store === 'all') {
      setPreferredStores(['all']);
      return;
    }
    const next = preferredStores.filter(s => s !== 'all');
    if (next.includes(store)) {
      const filtered = next.filter(s => s !== store);
      setPreferredStores(filtered.length === 0 ? ['all'] : filtered);
    } else {
      setPreferredStores([...next, store]);
    }
  }

  function toggleDietary(d: string) {
    setDietary(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  }

  function toggleChildAge(age: ChildAge) {
    setChildAges(prev => {
      if (!prev) return [age];
      return prev.includes(age) ? prev.filter(a => a !== age) : [...prev, age];
    });
  }

  function applyPreset(preset: typeof MEAL_PRESETS[0]) {
    setMeals(preset.meals);
  }

  function handleSubmit() {
    const profile: PlannerProfile = {
      adults,
      children,
      childAges: children > 0 ? childAges : undefined,
      weeklyBudget,
      preferredStores,
      dietary,
      dislikes: dislikes.trim() || undefined,
      meals,
      batchCooking,
      skipDays: skipDays.trim() || undefined,
      extraContext: extraContext.trim() || undefined,
    };
    onSubmit(profile);
  }

  return (
    <div className="space-y-6">
      {/* ── Household ─────────────────────────────────── */}
      <div>
        <h3 className="type-label mb-3" style={{ color: 'var(--on-background)' }}>👨‍👩‍👧‍👦 Your household</h3>
        <div className="space-y-2">
          <Stepper label="Adults" value={adults} onChange={setAdults} min={1} max={6} />
          <Stepper label="Children" value={children} onChange={setChildren} min={0} max={6} />
          {children > 0 && (
            <div className="pl-[5.25rem]">
              <p className="text-xs mb-1.5" style={{ color: 'var(--on-surface)' }}>Ages:</p>
              <div className="flex flex-wrap gap-1.5">
                {CHILD_AGE_OPTIONS.map(opt => (
                  <Chip
                    key={opt.value}
                    label={opt.label}
                    selected={childAges?.includes(opt.value) ?? false}
                    onClick={() => toggleChildAge(opt.value)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Budget ────────────────────────────────────── */}
      <div>
        <h3 className="type-label mb-3" style={{ color: 'var(--on-background)' }}>💶 Weekly budget <span className="font-normal" style={{ color: 'var(--on-surface)' }}>(optional)</span></h3>
        <div className="flex flex-wrap gap-2">
          {BUDGET_PRESETS.map(b => (
            <Chip
              key={b}
              label={`€${b}`}
              selected={weeklyBudget === b}
              onClick={() => setWeeklyBudget(weeklyBudget === b ? undefined : b)}
            />
          ))}
          <div className="flex items-center gap-1">
            <span className="text-sm" style={{ color: 'var(--on-surface)' }}>€</span>
            <input
              type="number"
              placeholder="Other"
              value={customBudget}
              onChange={e => {
                setCustomBudget(e.target.value);
                const n = parseInt(e.target.value);
                setWeeklyBudget(isNaN(n) ? undefined : n);
              }}
              className="w-16 px-2 py-1.5 rounded-lg text-sm focus:outline-none"
              style={{
                background: 'var(--surface-container)',
                color: 'var(--on-background)',
                border: weeklyBudget && !BUDGET_PRESETS.includes(weeklyBudget) ? '2px solid var(--primary)' : '2px solid transparent',
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Preferred stores ─────────────────────────── */}
      <div>
        <h3 className="type-label mb-3" style={{ color: 'var(--on-background)' }}>🏪 Preferred stores</h3>
        <div className="flex flex-wrap gap-2">
          {['all', 'tesco', 'dunnes', 'supervalu'].map(store => (
            <Chip
              key={store}
              label={store === 'all' ? "Don't mind" : store.charAt(0).toUpperCase() + store.slice(1)}
              selected={store === 'all' ? preferredStores.includes('all') : preferredStores.includes(store)}
              onClick={() => toggleStore(store)}
            />
          ))}
        </div>
      </div>

      {/* ── Dietary ───────────────────────────────────── */}
      <div>
        <button
          type="button"
          onClick={() => setShowDietary(!showDietary)}
          className="type-label flex items-center gap-2 mb-3"
          style={{ color: 'var(--on-background)' }}
        >
          🥗 Dietary requirements
          <svg className={`w-4 h-4 transition-transform ${showDietary ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          {dietary.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}>
              {dietary.length}
            </span>
          )}
        </button>
        {showDietary && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {DIETARY_OPTIONS.map(d => (
                <Chip key={d} label={d} selected={dietary.includes(d)} onClick={() => toggleDietary(d)} />
              ))}
            </div>
            <input
              type="text"
              value={dislikes}
              onChange={e => setDislikes(e.target.value)}
              placeholder="Anything to avoid? e.g. no fish, kids hate mushrooms"
              className="w-full px-3 py-2 rounded-xl text-sm focus:outline-none"
              style={{ background: 'var(--surface-container)', color: 'var(--on-background)' }}
            />
          </div>
        )}
      </div>

      {/* ── Meals ─────────────────────────────────────── */}
      <div>
        <h3 className="type-label mb-3" style={{ color: 'var(--on-background)' }}>🍽️ What to plan for</h3>

        {/* Presets */}
        <div className="flex flex-wrap gap-2 mb-3">
          {MEAL_PRESETS.map(preset => {
            const isActive = JSON.stringify(preset.meals) === JSON.stringify({ ...meals, snacks: preset.meals.snacks });
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset)}
                className="text-xs px-3 py-1.5 rounded-full transition-all"
                style={isActive
                  ? { background: 'var(--primary)', color: 'var(--on-primary)' }
                  : { background: 'var(--surface-container)', color: 'var(--on-surface)' }
                }
              >{preset.label}</button>
            );
          })}
        </div>

        {/* Toggles */}
        <div className="grid grid-cols-2 gap-2">
          {(['breakfast', 'lunch', 'dinner', 'snacks'] as const).map(meal => (
            <button
              key={meal}
              type="button"
              onClick={() => setMeals(prev => ({ ...prev, [meal]: !prev[meal] }))}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all"
              style={meals[meal]
                ? { background: 'var(--primary-fixed)', color: 'var(--on-primary-container)', border: '2px solid var(--primary)' }
                : { background: 'var(--surface-container)', color: 'var(--on-surface)', border: '2px solid transparent' }
              }
            >
              <span>{meals[meal] ? '✓' : '○'}</span>
              <span className="capitalize">{meal === 'lunch' ? 'Lunch / Packed lunches' : meal}</span>
            </button>
          ))}
        </div>

        {/* Batch cooking toggle */}
        <button
          type="button"
          onClick={() => setBatchCooking(!batchCooking)}
          className="mt-3 flex items-center gap-2 text-sm font-medium transition"
          style={{ color: batchCooking ? 'var(--primary)' : 'var(--on-surface)' }}
        >
          <span className="w-5 h-5 rounded flex items-center justify-center text-xs"
            style={batchCooking
              ? { background: 'var(--primary)', color: 'var(--on-primary)' }
              : { background: 'var(--surface-container)', color: 'var(--on-surface)' }
            }
          >{batchCooking ? '✓' : ''}</span>
          Batch cooking (cook once, eat twice)
        </button>

        {/* Skip days */}
        <input
          type="text"
          value={skipDays}
          onChange={e => setSkipDays(e.target.value)}
          placeholder="Eating out any days? e.g. Friday dinner, Sunday lunch"
          className="mt-3 w-full px-3 py-2 rounded-xl text-sm focus:outline-none"
          style={{ background: 'var(--surface-container)', color: 'var(--on-background)' }}
        />
      </div>

      {/* ── Anything else ─────────────────────────────── */}
      <div>
        <h3 className="type-label mb-2" style={{ color: 'var(--on-background)' }}>💬 Anything else?</h3>
        <textarea
          value={extraContext}
          onChange={e => setExtraContext(e.target.value)}
          placeholder="What you already have, special occasions, household items needed..."
          rows={3}
          className="w-full px-3 py-2 rounded-xl text-sm focus:outline-none resize-none"
          style={{ background: 'var(--surface-container)', color: 'var(--on-background)' }}
        />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {CONTEXT_SUGGESTIONS.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setExtraContext(prev => prev ? `${prev}\n${s}` : s)}
              className="text-xs px-2 py-1 rounded-full transition"
              style={{ background: 'var(--surface-container-low)', color: 'var(--on-surface)' }}
            >{s.length > 35 ? s.slice(0, 35) + '…' : s}</button>
          ))}
        </div>
      </div>

      {/* ── Submit ─────────────────────────────────────── */}
      <div className="sticky bottom-0 pt-4 pb-2 z-10" style={{ background: 'var(--surface-container-lowest)' }}>
        <button
          type="button"
          onClick={handleSubmit}
          className="btn-primary w-full px-6 py-4 text-lg font-bold"
        >
          Build my grocery list →
        </button>
        <p className="text-xs mt-2 text-center" style={{ color: 'var(--on-surface-variant)' }}>
          Prices from Tesco, Dunnes & SuperValu · Free to use
        </p>
      </div>
    </div>
  );
}
