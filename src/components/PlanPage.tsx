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
    <div className="min-h-screen bg-[#f5f6f3]">
      <div className="mx-auto max-w-[1180px] space-y-8 px-4 pb-24 pt-5 sm:px-6 sm:pt-7 lg:px-8">
        <WeeklyCommandCentre />
        <HomeActivity />
      </div>
    </div>
  );
}
