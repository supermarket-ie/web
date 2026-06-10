'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { loadSession } from '@/lib/session';

const HIDDEN_ON = ['/blog', '/compare', '/deals', '/shop', '/store', '/cost-of-weekly-shop', '/privacy', '/terms', '/contact', '/vendor', '/unsubscribe', '/list/request', '/list/share'];

export function AppNavSpacer({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [hasNav, setHasNav] = useState(false);

  useEffect(() => {
    const session = loadSession();
    const hidden = HIDDEN_ON.some(p => pathname.startsWith(p));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate client-only state after mount
    setHasNav(!!session?.token && !hidden);
  }, [pathname]);

  return (
    <div className={hasNav ? 'md:pl-[220px] pb-20 md:pb-0' : ''}>
      {children}
    </div>
  );
}
