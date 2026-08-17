import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_PROPERTIES_BYTES = 8 * 1024;
const MAX_EVENT_LENGTH = 64;
const EVENT_NAME = /^[a-z0-9_.:-]+$/i;

export async function POST(req: Request) {
  try {
    const contentLength = Number(req.headers.get('content-length') ?? '0');
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false }, { status: 413 });
    }

    const raw = await req.text();
    if (!raw || Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false }, { status: raw ? 413 : 400 });
    }

    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const { event, properties } = body as { event?: unknown; properties?: unknown };
    if (typeof event !== 'string' || event.length === 0 || event.length > MAX_EVENT_LENGTH || !EVENT_NAME.test(event)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    if (properties !== undefined &&
        (!properties || typeof properties !== 'object' || Array.isArray(properties) ||
         Buffer.byteLength(JSON.stringify(properties), 'utf8') > MAX_PROPERTIES_BYTES)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const { error } = await supabaseAdmin.from('events').insert({
      event,
      properties: properties ?? {},
      created_at: new Date().toISOString(),
    });

    if (error) {
      console.error('[track] insert error:', error.message);
      return NextResponse.json({ ok: false }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
