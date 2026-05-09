import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import jwt from 'jsonwebtoken';

const SECRET = process.env.MAGIC_LINK_SECRET;
if (!SECRET) throw new Error('MAGIC_LINK_SECRET environment variable is required');

interface PlannerItem {
  name: string;
  store: string;
  price: number;
}

interface RequestBody {
  token: string;
  items: PlannerItem[];
  prompt: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: RequestBody = await request.json();

    if (!body.token || !body.items || !Array.isArray(body.items)) {
      return NextResponse.json(
        { error: 'Missing required fields: token, items' },
        { status: 400 }
      );
    }

    // Verify JWT token
    let decoded;
    try {
      decoded = jwt.verify(body.token, SECRET!) as {
        subscriberId: string;
        email: string;
        familySize: string;
      };
    } catch (jwtError) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    const subscriberId = decoded.subscriberId;

    // Map items to list_items format
    const listItems = body.items.map(item => ({
      subscriber_id: subscriberId,
      canonical_name: item.name,
      category: null, // We don't have category info from planner
      store: item.store,
      price_paid: item.price,
      quantity: 1,
      observed_at: new Date().toISOString()
    }));

    // Insert items into list_items table
    const { error: insertError } = await supabaseAdmin
      .from('list_items')
      .insert(listItems);

    if (insertError) {
      console.error('[save-from-planner] Error inserting list items:', insertError);
      return NextResponse.json(
        { error: 'Failed to save list items' },
        { status: 500 }
      );
    }

    console.log(`[save-from-planner] Saved ${listItems.length} items for subscriber ${subscriberId}`);

    return NextResponse.json({
      ok: true,
      count: listItems.length
    });

  } catch (error) {
    console.error('[save-from-planner] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}