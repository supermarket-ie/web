'use client';

import { useEffect } from 'react';
import { saveSession } from '@/lib/session';

const CLIENT_SESSION_TOKEN = '__cookie__';

export function TokenPersist({ token: _token, familySize, email }: { token: string; familySize: string; email: string }) {
  useEffect(() => {
    saveSession({
      token: CLIENT_SESSION_TOKEN,
      familySize,
      email,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    window.dispatchEvent(new CustomEvent('sm:session-ready', { detail: { token: CLIENT_SESSION_TOKEN } }));
  }, [familySize, email]);

  return null;
}
