'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { loadSession, clearSession } from '@/lib/session';

export function HomeNav() {
  const [listUrl, setListUrl] = useState<string | null>(null);

  useEffect(() => {
    const session = loadSession();
    if (session?.token) {
      setListUrl(`/list?token=${session.token}`);
    }
  }, []);

  function signOut() {
    clearSession();
    window.location.href = '/';
  }

  if (listUrl) {
    return (
      <div className="hidden md:flex items-center gap-3">
        <Link
          href={listUrl}
          className="px-5 py-2.5 rounded-full text-sm font-semibold transition-all text-[#004a23]"
          style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}
        >
          View my list →
        </Link>
        <button
          onClick={signOut}
          className="text-sm font-medium transition-colors"
          style={{ color: 'var(--on-surface-variant)' }}
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <a
      href="/list/request"
      className="hidden md:inline-block px-5 py-2.5 rounded-full text-sm font-semibold transition-all text-[#004a23]"
      style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}
    >
      Get started free
    </a>
  );
}
