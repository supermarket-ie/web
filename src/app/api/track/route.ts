import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: Request) {
  try {
    const { event, properties } = await req.json();
    if (!event) return NextResponse.json({ ok: false }, { status: 400 });

    await supabaseAdmin.from('events').insert({
      event,
      properties: properties ?? {},
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true });
  } catch {
    // Never fail the caller — tracking is best-effort
    return NextResponse.json({ ok: false });
  }
}
