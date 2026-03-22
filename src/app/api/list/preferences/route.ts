import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '@/lib/supabase';

const SECRET = process.env.MAGIC_LINK_SECRET;
if (!SECRET) throw new Error('MAGIC_LINK_SECRET environment variable is required');
const VALID_FAMILY_SIZES = new Set(['1', '2', '3-4', '5+']);

interface MagicLinkPayload {
  email: string;
  subscriberId: string;
  familySize: string;
}

export async function POST(request: NextRequest) {
  try {
    const { token, familySize, removedItems, addedItems, storeOverrides } = await request.json();

    if (!token) {
      return NextResponse.json({ error: 'Token required' }, { status: 400 });
    }

    let payload: MagicLinkPayload;
    try {
      payload = jwt.verify(token, SECRET) as MagicLinkPayload;
    } catch {
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
