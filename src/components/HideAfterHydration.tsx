'use client';

import { useState, useEffect, type ReactNode } from 'react';

/**
 * Renders children in the server HTML (for crawlers/SEO),
 * then hides them after client-side hydration completes.
 */
export function HideAfterHydration({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate client-only state after mount
    setHydrated(true);
  }, []);

  if (hydrated) return null;

  return <>{children}</>;
}
