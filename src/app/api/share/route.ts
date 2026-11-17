import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
// 16 chars × 5 bits (32-char alphabet) = 80 bits of entropy
function randomId(len = 16) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let id = '';
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  for (const b of arr) id += chars[b % chars.length];
  return id;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { items, family_size, generated_at } = body;

    if (!Array.isArray(items) || !items.length || !family_size) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const id = randomId();

    const { error } = await supabaseAdmin
      .from('shared_lists')
      .insert({
        id,
        family_size,
        // A client-claimed "verified_exact" item label is not re-verified here, so it is stored as indicative.
        items: (items as unknown[]).map(item => item && typeof item === 'object' && (item as { price_comparison?: unknown }).price_comparison === 'verified_exact'
          ? { ...item, price_comparison: 'indicative' } : item),
        // This route is public and unauthenticated: client-supplied totals cannot be trusted, and the share page
        // labels the first one "best value". No totals are persisted from client input.
        store_totals: [],
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
