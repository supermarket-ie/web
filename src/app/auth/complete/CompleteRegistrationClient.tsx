'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { saveSession } from '@/lib/session';
import { trackVerifiedSignupInGoogle } from '@/lib/analytics';

export default function CompleteRegistrationClient({
  email,
  familySize,
  isNewRegistration,
  continuationId,
}: {
  email: string;
  familySize: string;
  isNewRegistration: boolean;
  continuationId?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const tracked = useRef(false);

  useEffect(() => {
    saveSession({
      token: '__cookie__',
      email,
      familySize,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    // Verification already succeeded, even if restoring the shop later fails.
    const analytics = isNewRegistration && !tracked.current ? new Promise<void>(resolve => {
      tracked.current = true;
      const fallback = window.setTimeout(resolve, 1200);
      trackVerifiedSignupInGoogle(() => { window.clearTimeout(fallback); resolve(); });
    }) : Promise.resolve();
    async function complete() {
      try {
        let destination = '/';
        if (continuationId) {
          const response = await fetch('/api/auth/restore-continuation', {
            method: 'POST', credentials: 'same-origin', signal: controller.signal,
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: continuationId }),
          });
          const result = await response.json();
          if (!response.ok || !result.conversationId) throw new Error(result.error || 'We could not restore your conversation. Please try again.');
          destination = `/?chat=${encodeURIComponent(result.conversationId)}`;
        }
        await analytics;
        if (active) { router.replace(destination); router.refresh(); }
      } catch (cause) {
        if (active) setError(cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'Restoring your conversation took too long. Please try again.');
      } finally { window.clearTimeout(timeout); }
    }
    void complete();
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [email, familySize, isNewRegistration, continuationId, router, attempt]);

  return <main className="flex min-h-screen items-center justify-center bg-[#F9F6F5] px-6 text-[#1D2324]">
    <div className="max-w-md rounded-2xl border border-[#dce6de] bg-white p-8">
      <h1 className="text-xl font-bold">{error ? 'Your account is ready' : continuationId ? 'Bringing your conversation with you…' : 'Signing you in…'}</h1>
      {error ? <>
        <p role="alert" className="mt-3 text-sm leading-6">{error}</p>
        <button onClick={() => { setError(''); setAttempt(value => value + 1); }} className="mt-5 rounded-full bg-[#21603b] px-5 py-3 font-semibold text-white">Try restoring again</button>
        <Link href="/" className="mt-4 block text-sm underline">Continue to my account</Link>
      </> : <p role="status" className="mt-3 text-sm leading-6">{continuationId ? 'Your shop and conversation will open here so you can pick up where you left off.' : 'Opening your household agent.'}</p>}
    </div>
  </main>;
}
