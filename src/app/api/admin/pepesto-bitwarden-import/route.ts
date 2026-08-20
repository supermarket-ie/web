import { NextRequest, NextResponse } from 'next/server';
import { createDecipheriv, createHmac, hkdfSync, timingSafeEqual, createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const EXPECTED_SEND_SHA256 = 'dcf320f9cc317fa4f116a105d49975fa6761e1d6f9fc6b51e2c6c0aa02d7278d';
const PEPESTO_BASE = 'https://s.pepesto.com/api';

function fromUrlBase64(value: string): Buffer {
  let s = value.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function decryptEncString(encString: string, key: Buffer): string {
  const [typePart, payload] = encString.split('.', 2);
  if (typePart !== '2' || !payload) throw new Error('Unsupported Bitwarden encryption type');

  const parts = payload.split('|');
  if (parts.length !== 3) throw new Error('Invalid Bitwarden encrypted payload');

  const iv = Buffer.from(parts[0], 'base64');
  const ciphertext = Buffer.from(parts[1], 'base64');
  const mac = Buffer.from(parts[2], 'base64');

  const encKey = key.subarray(0, 32);
  const macKey = key.subarray(32, 64);
  const calculatedMac = createHmac('sha256', macKey).update(Buffer.concat([iv, ciphertext])).digest();
  if (calculatedMac.length !== mac.length || !timingSafeEqual(calculatedMac, mac)) {
    throw new Error('Bitwarden MAC validation failed');
  }

  const decipher = createDecipheriv('aes-256-cbc', encKey, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

async function storePepestoKey(apiKey: string) {
  const { error } = await supabaseAdmin.rpc('set_pepesto_api_key', { p_secret: apiKey });
  if (error) throw new Error(`Failed storing Pepesto key in Vault: ${error.message}`);
}

async function getStoredPepestoKey(): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc('get_pepesto_api_key');
  if (error) throw new Error(`Failed reading Pepesto key from Vault: ${error.message}`);
  return typeof data === 'string' && data.length > 0 ? data : null;
}

async function checkCredits(apiKey: string) {
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
  if (!response.ok) throw new Error(`Pepesto credits failed (${response.status})`);
  const body = JSON.parse(text) as { euro_cents?: number };
  if (typeof body.euro_cents !== 'number') throw new Error('Pepesto credits response missing euro_cents');
  return body.euro_cents;
}

export async function GET(request: NextRequest) {
  try {
    const existing = await getStoredPepestoKey();
    if (existing) {
      const euroCents = await checkCredits(existing);
      return NextResponse.json({ ok: true, already_stored: true, euro_cents: euroCents, euro_balance: euroCents / 100 });
    }

    const sendUrl = request.nextUrl.searchParams.get('send');
    if (!sendUrl) return NextResponse.json({ error: 'Missing send' }, { status: 400 });

    const digest = createHash('sha256').update(sendUrl).digest('hex');
    if (digest !== EXPECTED_SEND_SHA256) return NextResponse.json({ error: 'Invalid send' }, { status: 403 });

    const parsed = new URL(sendUrl);
    const [accessId, sendKeyB64] = parsed.hash.slice(1).split('/').slice(-2);
    if (!accessId || !sendKeyB64) throw new Error('Invalid Bitwarden Send URL');

    const accessResponse = await fetch(`https://api.bitwarden.com/sends/access/${encodeURIComponent(accessId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      cache: 'no-store',
    });
    const accessText = await accessResponse.text();
    if (!accessResponse.ok) throw new Error(`Bitwarden Send access failed (${accessResponse.status})`);

    const send = JSON.parse(accessText) as { type?: number; text?: { text?: string } };
    if (send.type !== 0 || typeof send.text?.text !== 'string') throw new Error('Bitwarden Send did not contain text');

    const material = fromUrlBase64(sendKeyB64);
    const derived = Buffer.from(hkdfSync('sha256', material, Buffer.from('bitwarden-send'), Buffer.from('send'), 64));
    const apiKey = decryptEncString(send.text.text, derived).trim();
    if (apiKey.length < 16 || apiKey.length > 512) throw new Error('Recovered Pepesto key had an unexpected length');

    await storePepestoKey(apiKey);
    const euroCents = await checkCredits(apiKey);

    console.log('[pepesto-bitwarden-import] key stored and credits verified', { euroCents });
    return NextResponse.json({
      ok: true,
      key_stored_in_vault: true,
      euro_cents: euroCents,
      euro_balance: euroCents / 100,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[pepesto-bitwarden-import] failed', message);
    return NextResponse.json({ error: 'Import failed', detail: message }, { status: 500 });
  }
}
