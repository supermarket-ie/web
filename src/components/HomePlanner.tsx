'use client';
import { useState, useRef, useEffect } from 'react';
import { loadSession, loadProfile, saveProfile, type PlannerProfile } from '@/lib/session';
import { GroceryPlannerSetup } from './GroceryPlannerSetup';
import { GroceryPlannerResults } from './GroceryPlannerResults';

type Stage = 'welcome-back' | 'setup' | 'loading' | 'results';

interface HistoryItem {
  name: string;
  store: string;
  last_date: string;
}

// ─── Welcome back card for returning users ──────────────────────────────
function WelcomeBackCard({ profile, historyItems, onSameAgain, onUpdate }: {
  profile: PlannerProfile;
  historyItems: HistoryItem[];
  onSameAgain: () => void;
  onUpdate: () => void;
}) {
  const people = profile.adults + profile.children;
  const mealsDesc = [
    profile.meals.breakfast && 'breakfast',
    profile.meals.lunch && 'lunch',
    profile.meals.dinner && 'dinner',
    profile.meals.snacks && 'snacks',
  ].filter(Boolean).join(', ');

  return (
    <div className="rounded-2xl p-5" style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
      <div className="flex items-start gap-3">
        <span className="text-2xl">👋</span>
        <div className="flex-1">
          <h3 className="font-bold mb-1" style={{ color: 'var(--on-background)' }}>Welcome back!</h3>
          <p className="text-sm mb-1" style={{ color: 'var(--on-surface)' }}>
            Last time: {people} people, {mealsDesc}
            {profile.weeklyBudget && `, €${profile.weeklyBudget} budget`}
          </p>
          {historyItems.length > 0 && (
            <p className="text-xs mb-3" style={{ color: 'var(--on-surface-variant)' }}>
              You bought: {historyItems.slice(0, 4).map(i => i.name).join(', ')}...
            </p>
          )}
          <div className="flex gap-2">
            <button onClick={onSameAgain} className="btn-primary px-5 py-2.5 text-sm font-semibold rounded-xl">
              Same again →
            </button>
            <button onClick={onUpdate} className="btn-secondary px-5 py-2.5 text-sm font-semibold rounded-xl">
              Update plan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main orchestrator ──────────────────────────────────────────────────
export function HomePlanner() {
  const [stage, setStage] = useState<Stage>('setup');
  const [profile, setProfile] = useState<PlannerProfile | null>(null);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [resultContent, setResultContent] = useState('');
  const [progressIndex, setProgressIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // On mount: check for returning user
  useEffect(() => {
    const savedProfile = loadProfile();
    const session = loadSession();

    if (savedProfile) {
      setProfile(savedProfile);

      // Fetch history for returning users
      if (session?.token) {
        fetch(`/api/list/history?token=${session.token}`)
          .then(res => res.json())
          .then(data => {
            if (data.items?.length > 0) {
              setHistoryItems(data.items);
              setStage('welcome-back');
            } else {
              setStage('welcome-back'); // still show welcome back with saved profile
            }
          })
          .catch(() => setStage('welcome-back'));
      } else {
        setStage('welcome-back');
      }
    }
    // else: stage stays 'setup' (new user)
  }, []);

  // Rotate progress messages during loading
  useEffect(() => {
    if (isLoading) {
      const interval = setInterval(() => setProgressIndex(i => i + 1), 3000);
      return () => clearInterval(interval);
    }
  }, [isLoading]);

  // ─── Generate grocery list from profile ─────────────────────────────
  async function generateList(p: PlannerProfile) {
    setProfile(p);
    saveProfile(p);
    setStage('loading');
    setResultContent('');
    setProgressIndex(0);
    setIsLoading(true);

    abortRef.current = new AbortController();

    try {
      const session = loadSession();
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: p,
          token: session?.token,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error('Request failed');
      if (!res.body) throw new Error('No stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let content = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('0:"') && trimmed.endsWith('"')) {
            try {
              const text = JSON.parse(trimmed.slice(2));
              content += text;
              setResultContent(content);
            } catch {}
          }
        }
      }

      setStage('results');
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setResultContent('Sorry, something went wrong building your list. Please try again.');
        setStage('results');
      }
    } finally {
      setIsLoading(false);
    }
  }

  // ─── Render based on stage ──────────────────────────────────────────
  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto">
      {stage === 'welcome-back' && profile && (
        <WelcomeBackCard
          profile={profile}
          historyItems={historyItems}
          onSameAgain={() => generateList(profile)}
          onUpdate={() => setStage('setup')}
        />
      )}

      {stage === 'setup' && (
        <GroceryPlannerSetup
          initialProfile={profile}
          onSubmit={generateList}
        />
      )}

      {(stage === 'loading' || stage === 'results') && (
        <GroceryPlannerResults
          resultContent={resultContent}
          isLoading={isLoading}
          progressIndex={progressIndex}
          householdSize={(profile?.adults ?? 2) + (profile?.children ?? 0)}
          onEditPlan={() => setStage('setup')}
        />
      )}
    </div>
  );
}
