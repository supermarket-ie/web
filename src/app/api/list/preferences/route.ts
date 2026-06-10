import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, type SessionPayload } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';

const VALID_FAMILY_SIZES = new Set(['1', '2', '3-4', '5+']);

export async function POST(request: NextRequest) {
  try {
    const { token, familySize, removedItems, addedItems, storeOverrides } = await request.json();

    if (!token) {
      return NextResponse.json({ error: 'Token required' }, { status: 400 });
    }

    const payload: SessionPayload | null = verifySessionToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (familySize && VALID_FAMILY_SIZES.has(familySize)) {
      update.family_size = familySize;
    }
    if (Array.isArray(removedItems)) {
      update.removed_items = removedItems;
    }
    if (Array.isArray(addedItems)) {
      update.added_items = addedItems;
    }
    if (storeOverrides && typeof storeOverrides === 'object' && !Array.isArray(storeOverrides)) {
      update.store_overrides = storeOverrides;
    }

    const { error } = await supabaseAdmin
      .from('subscribers')
      .update(update)
      .eq('id', payload.subscriberId);

    if (error) {
      console.error('Preferences update error:', error.message);
      return NextResponse.json({ success: true, warning: error.message });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Preferences error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
