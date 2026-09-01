import { NextResponse } from 'next/server';
import { buildMarketStarters } from '@/lib/market-starters';
import { getAllLatestPrices } from '@/lib/price-data';

export const revalidate = 900;

export async function GET() {
  try {
    const prices = await getAllLatestPrices();
    return NextResponse.json({ starters: buildMarketStarters(prices) }, {
      headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' },
    });
  } catch (error) {
    console.error('[/api/agent/starter-prompts] Error:', error);
    return NextResponse.json({ starters: buildMarketStarters([]) }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  }
}
