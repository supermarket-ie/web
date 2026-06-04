import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import jwt from 'jsonwebtoken';

const SECRET = process.env.MAGIC_LINK_SECRET;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const { productId } = await params;
  const token = req.nextUrl.searchParams.get('token');

  const payload = token ? (() => { try { return jwt.verify(token, SECRET!) as { subscriberId: string }; } catch { return null; } })() : null;
  if (!payload) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get store_product IDs for this product
  const { data: storeProducts } = await supabaseAdmin
    .from('store_products')
    .select('id, store')
    .eq('product_id', productId);

  if (!storeProducts?.length) {
    return NextResponse.json({ prices: [] });
  }

  const spIds = storeProducts.map(sp => sp.id);

  // Get latest prices from view
  const { data: latest } = await supabaseAdmin
    .from('latest_prices')
    .select('store_product_id, price, on_promotion, store')
    .in('store_product_id', spIds);

  if (!latest) return NextResponse.json({ prices: [] });

  // Get observed_at from price_observations (most recent per store_product)
  const { data: observations } = await supabaseAdmin
    .from('price_observations')
    .select('store_product_id, observed_at')
    .in('store_product_id', spIds)
    .order('observed_at', { ascending: false });

  // Build observed_at map (first hit per store_product = most recent)
  const observedMap = new Map<string, string>();
  for (const obs of observations ?? []) {
    if (!observedMap.has(obs.store_product_id)) {
      observedMap.set(obs.store_product_id, obs.observed_at);
    }
  }

  // One price per store — take cheapest if multiple store_products per store
  const byStore = new Map<string, { store: string; price: number; on_promotion: boolean; observed_at: string }>();
  for (const row of latest) {
    const observed_at = observedMap.get(row.store_product_id) ?? new Date(0).toISOString();
    const existing = byStore.get(row.store);
    if (!existing || row.price < existing.price) {
      byStore.set(row.store, {
        store: row.store,
        price: row.price,
        on_promotion: row.on_promotion ?? false,
        observed_at,
      });
    }
  }

  return NextResponse.json({ prices: Array.from(byStore.values()) });
}
