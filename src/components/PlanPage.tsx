'use client';

import { useEffect, useState } from 'react';
import { loadSession } from '@/lib/session';
import { WeeklyCommandCentre } from '@/components/WeeklyCommandCentre';

export function PlanPage() {
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const session = loadSession();
    const signedIn = !!session?.token;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate client-only state after mount
    setIsSignedIn(signedIn);
    setReady(true);

    if (signedIn) {
      const el = document.getElementById('homepage-marketing');
      if (el) el.style.display = 'none';
    }
  }, []);

  if (!ready || !isSignedIn) return null;

  return (
    <div className="min-h-screen relative overflow-hidden noise-bg" style={{ background: 'var(--surface)' }}>
      {/* Background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="gradient-blob" style={{
          width: 500, height: 500,
          background: 'linear-gradient(135deg, rgba(0,106,53,0.10), rgba(107,254,156,0.07))',
          top: -200, left: -100,
        }} />
        <div className="gradient-blob" style={{
          width: 400, height: 400,
          background: 'linear-gradient(135deg, rgba(0,220,255,0.07), rgba(107,254,156,0.04))',
          top: '40%', right: -150,
        }} />
        <div className="absolute inset-0 dot-grid opacity-40" />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto px-4 pt-6 pb-24">
        {/* Header card */}
        <div className="rounded-2xl overflow-hidden mb-6"
          style={{ background: 'var(--surface-container-lowest)', border: '1px solid var(--surface-container)' }}>
          <div className="px-5 py-4 relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #006A35 0%, #00944A 60%, #00a854 100%)' }}>
            <div className="absolute pointer-events-none" style={{
              width: 200, height: 200, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(0,220,255,0.12) 0%, transparent 70%)',
              top: -60, right: -40,
            }} />
            <div className="relative">
              <h1 className="font-bold text-xl leading-tight" style={{
                background: 'linear-gradient(135deg, #ffffff, #6BFE9C)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              }}>Planner</h1>
              <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
                Plan your weekly shop — prices tracked across every major Irish supermarket.
              </p>
            </div>
          </div>
        </div>

        <WeeklyCommandCentre />
      </div>
    </div>
  );
}
