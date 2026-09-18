'use client';

import { useEffect, useState } from 'react';
import { loadSession } from '@/lib/session';
import { WeeklyCommandCentre } from '@/components/WeeklyCommandCentre';
import { HomeActivity } from '@/components/HomeActivity';

export function PlanPage() {
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const session = loadSession();
      const signedIn = !!session?.token;
      setIsSignedIn(signedIn);
      setReady(true);
      if (signedIn) {
        const el = document.getElementById('homepage-marketing');
        if (el) el.style.display = 'none';
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!ready || !isSignedIn) return null;

  return (
    <div className="min-h-screen bg-[#f7f5ef]">
      <div className="mx-auto max-w-[1180px] space-y-8 px-4 pb-24 pt-7 sm:px-6 sm:pt-10 lg:px-8">
        <div className="flex items-end justify-between gap-6">
          <div>
            <p className="text-sm font-semibold text-[#168049]">Your household shop</p>
            <h1 className="mt-1 text-[clamp(1.75rem,4vw,2.55rem)] font-extrabold tracking-[-0.045em] text-[#17251c]">Ready for the week?</h1>
          </div>
          <p className="hidden max-w-sm text-right text-sm leading-6 text-[#68746c] sm:block">
            Plan with Eve, keep an eye on the week and pick up any shop without starting over.
          </p>
        </div>
        <WeeklyCommandCentre />
        <HomeActivity />
      </div>
    </div>
  );
}
