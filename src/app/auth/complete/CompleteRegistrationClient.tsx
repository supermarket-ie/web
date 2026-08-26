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
    if (isNewRegistration) trackVerifiedSignupInGoogle();
    router.replace('/');
    router.refresh();
  }, [email, familySize, isNewRegistration, router]);

  return <main className="flex min-h-screen items-center justify-center bg-[#F9F6F5] text-[#1D2324]">Confirming your account…</main>;
}
