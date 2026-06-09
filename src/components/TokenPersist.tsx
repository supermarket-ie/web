'use client';

import { useEffect } from 'react';
import { saveSession } from '@/lib/session';

export function TokenPersist({ token, familySize, email }: { token: string; familySize: string; email: string }) {
  useEffect(() => {
    // Persist the token to localStorage
    saveSession({
      token,
      familySize,
      email,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    // Notify AppShell — it may have already mounted and read localStorage
    // before this component wrote the token. The event lets it re-check.
    window.dispatchEvent(new CustomEvent('sm:session-ready', { detail: { token } }));
  }, [token, familySize, email]);

  return null;
}
