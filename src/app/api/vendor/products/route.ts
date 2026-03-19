import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyVendorToken } from '@/lib/vendor-auth';

function getToken(req: NextRequest) {
  return req.headers.get('x-vendor-token') ?? new URL(req.url).searchParams.get('token') ?? '';
}

export async function GET(request: NextRequest) {
  const payload = verifyVendorToken(getToken(request));
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('vendor_products')
    .select('*, products(id, canonical_name, category)')
    .eq('vendor_id', payload.vendorId)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ products: data ?? [] });
}

export async function POST(request: NextRequest) {
  const payload = verifyVendorToken(getToken(request));
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const body = await request.json();
  const { productId, customName, customDescription, price, compareAtPrice, inStock } = body;

  if (!productId && !customName) {
    return NextResponse.json({ error: 'product_id or custom_name required' }, { status: 400 });
  }
  if (!price || isNaN(Number(price))) {
    return NextResponse.json({ error: 'Valid price required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('vendor_products')
    .insert({
      vendor_id: payload.vendorId,
      product_id: productId ?? null,
      custom_name: customName ?? null,
      custom_description: customDescription ?? null,
      price: Number(price),
      compare_at_price: compareAtPrice ? Number(compareAtPrice) : null,
      in_stock: inStock ?? true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ product: data });
}

export async function PATCH(request: NextRequest) {
  const payload = verifyVendorToken(getToken(request));
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { id, price, compareAtPrice, inStock, customName, customDescription } = await request.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (price !== undefined) update.price = Number(price);
  if (compareAtPrice !== undefined) update.compare_at_price = compareAtPrice ? Number(compareAtPrice) : null;
  if (inStock !== undefined) update.in_stock = inStock;
  if (customName !== undefined) update.custom_name = customName;
  if (customDescription !== undefined) update.custom_description = customDescription;

  const { error } = await supabaseAdmin
    .from('vendor_products')
    .update(update)
    .eq('id', id)
    .eq('vendor_id', payload.vendorId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const payload = verifyVendorToken(getToken(request));
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const { id } = await request.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('vendor_products')
    .delete()
    .eq('id', id)
    .eq('vendor_id', payload.vendorId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
