import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import jwt from 'jsonwebtoken';
import { parseMarkdownList } from '@/lib/parse-planner-markdown';

const SECRET = process.env.MAGIC_LINK_SECRET;
if (!SECRET) throw new Error('MAGIC_LINK_SECRET environment variable is required');

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      token: string;
      markdown: string;          // full AI-generated list content
      name?: string;             // optional list name
      family_size?: string;
    };

    if (!body.token || !body.markdown) {
      return NextResponse.json({ error: 'Missing required fields: token, markdown' }, { status: 400 });
    }

    // Verify JWT
    let decoded: { subscriberId: string; email: string; familySize?: string };
    try {
      decoded = jwt.verify(body.token, SECRET!) as typeof decoded;
    } catch {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const subscriberId = decoded.subscriberId;

    // Parse the markdown into structured items + store totals
    const { items, storeTotals } = parseMarkdownList(body.markdown);

    if (items.length === 0) {
      return NextResponse.json({ error: 'Could not parse any items from list content' }, { status: 422 });
    }

    // Cap at 10 lists — delete oldest if needed
    const { data: existingLists } = await supabaseAdmin
      .from('saved_lists')
      .select('id, created_at')
      .eq('subscriber_id', subscriberId)
      .order('created_at', { ascending: true });

    if (existingLists && existingLists.length >= 10) {
      const toDelete = existingLists.slice(0, existingLists.length - 9);
      await supabaseAdmin.from('saved_lists').delete().in('id', toDelete.map(r => r.id));
    }

    // Clear is_default on existing lists
    await supabaseAdmin
      .from('saved_lists')
      .update({ is_default: false })
      .eq('subscriber_id', subscriberId);

    // Build the list name from first line of content if not provided
    const listName = body.name
      ?? body.markdown.split('\n').find(l => l.startsWith('# '))?.slice(2).trim()
      ?? 'Weekly grocery list';

    // Insert saved_list with structured items
    const { data: savedList, error: listError } = await supabaseAdmin
      .from('saved_lists')
      .insert({
        subscriber_id: subscriberId,
        name: listName.slice(0, 80),
        family_size: body.family_size ?? decoded.familySize ?? '2',
        items: items.map(i => ({
          canonical_name: i.canonical_name,
          category: i.category,
          store: i.store,
          price: i.price,
          quantity: i.quantity,
          on_promotion: i.on_promotion,
        })),
        store_totals: storeTotals,
        is_default: true,
        generated_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (listError || !savedList) {
      console.error('[save-from-planner] saved_lists insert error:', listError);
      return NextResponse.json({ error: 'Failed to save list' }, { status: 500 });
    }

    const listId = savedList.id as string;

    // Write list_items for history/memory
    await supabaseAdmin.from('list_items').insert(
      items.map(i => ({
        subscriber_id: subscriberId,
        list_id: listId,
        canonical_name: i.canonical_name,
        category: i.category,
        store: i.store,
        price_paid: i.price,
        quantity: i.quantity,
        observed_at: new Date().toISOString(),
      }))
    );

    // Invalidate refresh cache
    supabaseAdmin
      .from('subscribers')
      .update({ refresh_cache: null, refresh_cache_at: null })
      .eq('id', subscriberId)
      .then(() => {});

    return NextResponse.json({ ok: true, list_id: listId, item_count: items.length });
  } catch (err) {
    console.error('[save-from-planner] unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
