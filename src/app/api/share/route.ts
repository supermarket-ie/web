import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

function randomId(len = 8) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let id = '';
  // Use crypto for randomness
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  for (const b of arr) id += chars[b % chars.length];
  return id;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { items, store_totals, family_size, generated_at } = body;

    if (!items?.length || !store_totals || !family_size) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const id = randomId(8);

    const { error } = await supabaseAdmin
      .from('shared_lists')
      .insert({
        id,
        family_size,
        items,
        store_totals,
        generated_at: generated_at ?? new Date().toISOString(),
      });

    if (error) {
      console.error('Share insert error:', error);
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
    }

    return NextResponse.json({ id, url: `/list/share/${id}` });
  } catch (err) {
    console.error('Share error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
