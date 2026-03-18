'use client';

import { useEffect } from 'react';
import { saveSession } from '@/lib/session';

export function TokenPersist({ token, familySize, email }: { token: string; familySize: string; email: string }) {
  useEffect(() => {
    // Token is a 7-day JWT — store with matching expiry
    saveSession({
      token,
      familySize,
      email,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
  }, [token, familySize, email]);

  return null;
}
