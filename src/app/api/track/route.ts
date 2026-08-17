import { NextResponse } from 'next/server';

// Legacy tracking endpoint. Production traffic uses /api/events, which has an
// explicit event allowlist, payload bounds and rate limiting. Keeping this
// unrestricted service-role write path would create an unnecessary poisoning
// surface, so fail closed rather than accepting arbitrary legacy events.
export async function POST() {
  return NextResponse.json(
    { ok: false, error: 'Legacy tracking endpoint disabled' },
    { status: 410 }
  );
}
