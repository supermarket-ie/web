import { NextResponse } from 'next/server';
import { buildMarketStarters } from '@/lib/market-starters';
import { getAllLatestPrices } from '@/lib/price-data';

export const revalidate = 300;

export async function GET(request: Request) {
  const requestedWindow = Number(new URL(request.url).searchParams.get('window'));
  const currentWindow = Math.floor(Date.now() / (10 * 60 * 1000));
  const rotationWindow = Number.isSafeInteger(requestedWindow) && Math.abs(requestedWindow - currentWindow) <= 1
    ? requestedWindow
    : currentWindow;

  try {
    const prices = await getAllLatestPrices();
    return NextResponse.json({ starters: buildMarketStarters(prices, rotationWindow), rotationWindow }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    console.error('[/api/agent/starter-prompts] Error:', error);
    return NextResponse.json({ starters: buildMarketStarters([]), rotationWindow }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  }
}
