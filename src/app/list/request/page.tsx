import type { Metadata } from 'next';
import RequestLinkClient from './RequestLinkClient';
import { isContinuationId } from '@/lib/registration-continuation';

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL ?? 'https://www.supermarket.ie').trim();

export const metadata: Metadata = {
  title: 'Sign in · supermarket.ie',
  description: 'Sign in to your supermarket.ie account to access your grocery lists and preferences.',
  alternates: { canonical: `${BASE_URL}/list/request` },
};

export default async function RequestLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; continuation?: string }>;
}) {
  const params = await searchParams;
  return <RequestLinkClient expired={params.error === 'expired'} continuationId={isContinuationId(params.continuation) ? params.continuation : undefined} />;
}
