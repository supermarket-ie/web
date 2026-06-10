'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { loadSession } from '@/lib/session';

export function SessionLink() {
  const [listUrl, setListUrl] = useState<string | null>(null);

  useEffect(() => {
    const session = loadSession();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate client-only state after mount
    if (session?.token) setListUrl(`/list?token=${session.token}`);
  }, []);

  if (!listUrl) return null;

  return (
    <Link
      href="/dashboard"
      className="btn-secondary px-8 py-4 text-lg inline-flex gap-2 hover:scale-[1.02] active:scale-[0.98] transition-transform"
    >
      Open my agent <ArrowRight className="size-5" />
    </Link>
  );
}
