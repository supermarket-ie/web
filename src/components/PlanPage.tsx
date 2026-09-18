'use client';

import { useEffect, useState } from 'react';
import { loadSession } from '@/lib/session';
import { WeeklyCommandCentre } from '@/components/WeeklyCommandCentre';
import { HomeActivity } from '@/components/HomeActivity';

export function PlanPage({ visualPreviewState }: { visualPreviewState?: 'new' | 'progress' | 'ready' }) {
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const session = loadSession();
      const signedIn = !!session?.token || Boolean(visualPreviewState);
      setIsSignedIn(signedIn);
      setReady(true);
      if (signedIn) {
        const el = document.getElementById('homepage-marketing');
        if (el) el.style.display = 'none';
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [visualPreviewState]);

  if (!ready || !isSignedIn) return null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f6faf7]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_42%_0%,rgba(178,239,198,0.44),rgba(236,248,240,0.28)_38%,rgba(248,250,248,0)_72%)]" />
      <div aria-hidden="true" className="pointer-events-none absolute right-0 top-0 h-[760px] w-[52%] bg-[url('/grocery-doodle-pattern.png')] bg-[length:500px_500px] opacity-[0.055] [mask-image:linear-gradient(to_left,black_20%,transparent_100%)]" />
      <div className="relative mx-auto max-w-[1320px] space-y-8 px-4 pb-24 pt-5 sm:px-6 sm:pt-7 lg:px-8">
        <WeeklyCommandCentre visualPreviewState={visualPreviewState} />
        <HomeActivity />
      </div>
    </div>
  );
}
