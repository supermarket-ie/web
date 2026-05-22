import type { Metadata } from 'next';
import RequestLinkClient from './RequestLinkClient';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://supermarket.ie';

export const metadata: Metadata = {
  title: 'Sign in to your list · supermarket.ie',
  description: 'Enter your email to get a link to your personalised grocery shopping list.',
  alternates: { canonical: `${BASE_URL}/list/request` },
};

export default function RequestLinkPage() {
  return <RequestLinkClient />;
}
