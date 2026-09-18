'use client';

import { useEffect, useState } from 'react';
import { loadSession } from '@/lib/session';
import { WeeklyCommandCentre } from '@/components/WeeklyCommandCentre';
import { HomeActivity } from '@/components/HomeActivity';
import { isSignedInVisualPreview } from '@/lib/visual-preview';

export function PlanPage() {
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const session = loadSession();
      const signedIn = !!session?.token || isSignedInVisualPreview();
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
    <div className="relative isolate min-h-screen overflow-hidden bg-[#f5f6f3]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[url('/grocery-doodle-pattern.png')] bg-[length:500px_500px] opacity-[0.045] [mask-image:linear-gradient(to_bottom,black_0%,rgba(0,0,0,0.72)_58%,transparent_100%)]"
      />
      <div className="relative mx-auto max-w-[1180px] space-y-8 px-4 pb-24 pt-5 sm:px-6 sm:pt-7 lg:px-8">
        <WeeklyCommandCentre />
        <HomeActivity />
      </div>
    </div>
  );
}
