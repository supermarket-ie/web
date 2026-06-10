'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export function CookieBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate client-only state after mount
    if (!localStorage.getItem('cookieConsent')) setShow(true);
  }, []);

  if (!show) return null;

  function accept() {
    localStorage.setItem('cookieConsent', 'accepted');
    setShow(false);
  }

  function decline() {
    localStorage.setItem('cookieConsent', 'declined');
    setShow(false);
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 p-4 z-50"
      style={{
        background: 'rgba(14,14,14,0.96)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        <p className="text-sm" style={{ color: 'rgba(249,246,245,0.7)' }}>
          We use cookies to improve your experience and remember your preferences.{' '}
          <Link
            href="/privacy"
            className="underline hover:opacity-80"
            style={{ color: 'var(--primary-container)' }}
          >
            Privacy Policy
          </Link>
        </p>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={decline}
            className="px-4 py-2 text-sm rounded-full transition-opacity hover:opacity-80"
            style={{ color: 'rgba(249,246,245,0.6)', border: '1px solid rgba(249,246,245,0.2)' }}
          >
            Decline
          </button>
          <button
            onClick={accept}
            className="btn-primary px-5 py-2 text-sm whitespace-nowrap"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
