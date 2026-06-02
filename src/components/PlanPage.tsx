'use client';

import { useEffect, useState } from 'react';
import { loadSession } from '@/lib/session';
import { HomePlanner } from '@/components/HomePlanner';
import { PlannerSSRShell } from '@/components/PlannerSSRShell';
import { HideAfterHydration } from '@/components/HideAfterHydration';

export function PlanPage() {
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const session = loadSession();
    const signedIn = !!session?.token;
    setIsSignedIn(signedIn);
    setReady(true);

    // Hide marketing content for signed-in users
    if (signedIn) {
      const el = document.getElementById('homepage-marketing');
      if (el) el.style.display = 'none';
    }
  }, []);

  if (!ready || !isSignedIn) return null;

  return (
    <div className="flex flex-col" style={{ background: 'var(--surface)', height: 'calc(100vh - 57px)' }}>
      <div className="flex-1 flex items-stretch justify-center px-4 py-4 overflow-hidden">
        <div className="w-full max-w-2xl flex flex-col">
          <HideAfterHydration>
            <PlannerSSRShell />
          </HideAfterHydration>
          <HomePlanner />
        </div>
      </div>
    </div>
  );
}
