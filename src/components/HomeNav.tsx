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
        className="hidden md:inline-block bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:from-[#D4604A] hover:to-[#C5533D] transition-all shadow-sm"
      >
        View my list →
      </Link>
    );
  }

  return (
    <a
      href="/list/request"
      className="hidden md:inline-block bg-gradient-to-b from-[#E17055] to-[#D4604A] text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:from-[#D4604A] hover:to-[#C5533D] transition-all shadow-sm"
    >
      Get started free
    </a>
  );
}
