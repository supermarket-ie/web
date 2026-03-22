'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { loadSession } from '@/lib/session';

export function HomeNav() {
  const [listUrl, setListUrl] = useState<string | null>(null);

  useEffect(() => {
    const session = loadSession();
    if (session?.token) {
      setListUrl(`/list?token=${session.token}`);
    }
  }, []);

  if (listUrl) {
    return (
      <Link
        href={listUrl}
        className="hidden md:inline-block px-5 py-2.5 rounded-full text-sm font-semibold transition-all text-[#004a23]"
        style={{ background: 'linear-gradient(135deg, #006A35, #6BFE9C)' }}
      >
        View my list →
      </Link>
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
