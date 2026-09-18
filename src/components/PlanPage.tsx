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
    <div className="relative isolate min-h-screen overflow-hidden bg-[#f8faf8]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[720px] bg-[radial-gradient(ellipse_at_42%_0%,rgba(169,236,191,0.38),rgba(225,244,232,0.18)_42%,rgba(248,250,248,0)_76%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 top-0 -z-10 h-[760px] w-[42%] min-w-[320px] bg-[url('/grocery-doodle-pattern.png')] bg-[length:500px_500px] opacity-[0.065] [mask-image:linear-gradient(to_left,black_36%,transparent_100%)]"
      />
      <div className="relative mx-auto max-w-[1180px] space-y-8 px-4 pb-24 pt-5 sm:px-6 sm:pt-7 lg:px-8">
        <WeeklyCommandCentre />
        <HomeActivity />
      </div>
    </div>
  );
}
