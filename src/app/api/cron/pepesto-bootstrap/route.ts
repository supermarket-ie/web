import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PEPESTO_BASE = 'https://s.pepesto.com/api';
const PEPESTO_EMAIL = 'colin@supermarket.ie';

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}

async function getStoredKey(): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc('get_pepesto_api_key');
  if (error) throw new Error(`Failed reading Pepesto key from Vault: ${error.message}`);
  return typeof data === 'string' && data.length > 0 ? data : null;
}

async function storeKey(apiKey: string) {
  const { error } = await supabaseAdmin.rpc('set_pepesto_api_key', { p_secret: apiKey });
  if (error) throw new Error(`Failed storing Pepesto key in Vault: ${error.message}`);
}

async function linkPepesto(): Promise<string> {
  const response = await fetch(`${PEPESTO_BASE}/link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: PEPESTO_EMAIL }),
    cache: 'no-store',
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Pepesto link failed (${response.status}): ${text.slice(0, 300)}`);
  const body = JSON.parse(text) as { api_key?: string };
  if (!body.api_key) throw new Error('Pepesto link response did not contain api_key');
  return body.api_key;
}

async function checkCredits(apiKey: string): Promise<number> {
  const response = await fetch(`${PEPESTO_BASE}/credits`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: '{}',
    cache: 'no-store',
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Pepesto credits failed (${response.status}): ${text.slice(0, 300)}`);
  const body = JSON.parse(text) as { euro_cents?: number };
  if (typeof body.euro_cents !== 'number') throw new Error('Pepesto credits response missing euro_cents');
  return body.euro_cents;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    let apiKey = await getStoredKey();
    let linkedNow = false;

    if (!apiKey) {
      apiKey = await linkPepesto();
      await storeKey(apiKey);
      linkedNow = true;
    }

    const euroCents = await checkCredits(apiKey);
    console.log('[pepesto-bootstrap] verified', { linkedNow, euroCents });

    return NextResponse.json({
      ok: true,
      linked_now: linkedNow,
      key_stored_in_vault: true,
      euro_cents: euroCents,
      euro_balance: Number((euroCents / 100).toFixed(2)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[pepesto-bootstrap] failed', message);
    return NextResponse.json({ error: 'Pepesto bootstrap failed', detail: message }, { status: 500 });
  }
}
