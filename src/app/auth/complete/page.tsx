import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySessionToken } from '@/lib/auth';
import CompleteRegistrationClient from './CompleteRegistrationClient';
import { isContinuationId } from '@/lib/registration-continuation';

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function CompleteRegistrationPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; continuation?: string }>;
}) {
  const cookieStore = await cookies();
  const payload = verifySessionToken(cookieStore.get('sm_session')?.value);
  if (!payload) redirect('/list/request?error=expired');
  const params = await searchParams;
  return (
    <CompleteRegistrationClient
      email={payload.email ?? ''}
      familySize={payload.familySize ?? '2'}
      isNewRegistration={params.new === '1'}
      continuationId={isContinuationId(params.continuation) ? params.continuation : undefined}
    />
  );
}
