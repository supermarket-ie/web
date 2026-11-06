import { NextResponse } from 'next/server';
import { fallbackStarters, MARKET_STARTER_VERSION } from '@/lib/market-starter-options';

export const revalidate = 3600;

export async function GET() {
  return NextResponse.json(
    { starters: fallbackStarters(), starterVersion: MARKET_STARTER_VERSION },
    { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } },
  );
}
