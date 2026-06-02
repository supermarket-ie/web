'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { loadSession } from '@/lib/session';

const HIDDEN_ON = ['/blog', '/compare', '/deals', '/shop', '/store', '/cost-of-weekly-shop', '/privacy', '/terms', '/contact', '/vendor', '/unsubscribe', '/list/request', '/list/share'];

export function AppNavSpacer({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [hasNav, setHasNav] = useState(false);

  useEffect(() => {
    const session = loadSession();
    const hidden = HIDDEN_ON.some(p => pathname.startsWith(p));
    setHasNav(!!session?.token && !hidden);
  }, [pathname]);

  return (
    <div
      className={hasNav ? 'md:pl-52 pb-20 md:pb-0' : ''}
    >
      {children}
    </div>
  );
}
