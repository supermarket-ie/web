'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { saveSession } from '@/lib/session';
import { trackVerifiedSignupInGoogle } from '@/lib/analytics';

export default function CompleteRegistrationClient({
  email,
  familySize,
  isNewRegistration,
}: {
  email: string;
  familySize: string;
  isNewRegistration: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    saveSession({
      token: '__cookie__',
      email,
      familySize,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    let navigated = false;
    const navigate = () => {
      if (navigated) return;
      navigated = true;
      router.replace('/');
      router.refresh();
    };
    if (isNewRegistration) {
      // The completion event is sent from this short-lived redirect page.
      // Give the tag a bounded chance to process it before navigation.
      const fallback = window.setTimeout(navigate, 1200);
      trackVerifiedSignupInGoogle(() => { window.clearTimeout(fallback); navigate(); });
    } else {
      navigate();
    }
  }, [email, familySize, isNewRegistration, router]);

  return <main className="flex min-h-screen items-center justify-center bg-[#F9F6F5] text-[#1D2324]">Confirming your account…</main>;
}
