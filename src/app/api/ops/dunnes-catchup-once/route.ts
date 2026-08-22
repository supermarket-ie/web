import { createHash, timingSafeEqual } from 'crypto';

const TOKEN_HASH = 'e5440e5a68e3e618543b295c3d850e8754ed1050d2d6247c4ed2c11421caa5d4';

function validToken(token: string | null) {
  if (!token) return false;
  const actual = createHash('sha256').update(token).digest();
  const expected = Buffer.from(TOKEN_HASH, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!validToken(url.searchParams.get('token'))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json({ error: 'CRON_SECRET missing' }, { status: 503 });
  }

  const target = new URL('/api/workers/dunnes-scrape-trigger?limit=275', request.url);
  const response = await fetch(target, {
    headers: { Authorization: `Bearer ${cronSecret}` },
    cache: 'no-store',
  });

  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' },
  });
}
