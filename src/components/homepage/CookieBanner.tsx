'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export function CookieBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('cookieConsent')) setShow(true);
  }, []);

  if (!show) return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 p-4 z-50"
      style={{
        background: 'rgba(14,14,14,0.94)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
    >
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <p className="text-sm" style={{ color: 'rgba(249,246,245,0.7)' }}>
          We use cookies to improve your experience.{' '}
          <Link
            href="/privacy"
            className="underline hover:opacity-80"
            style={{ color: 'var(--primary-container)' }}
          >
            Privacy Policy
          </Link>
        </p>
        <button
          onClick={() => {
            localStorage.setItem('cookieConsent', 'accepted');
            setShow(false);
          }}
          className="btn-primary px-5 py-2 text-sm whitespace-nowrap"
        >
          Accept
        </button>
      </div>
    </div>
  );
}
