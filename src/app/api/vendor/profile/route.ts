import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifyVendorToken } from '@/lib/vendor-auth';

function getToken(req: NextRequest) {
  return req.headers.get('x-vendor-token') ?? '';
}

export async function PATCH(request: NextRequest) {
  const payload = verifyVendorToken(getToken(request));
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const body = await request.json();
  const allowed = ['name','description','address','eircode','delivery_radius_km','min_order_value','click_and_collect','categories','logo_url'];
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  for (const key of allowed) {
    if (body[key] !== undefined) update[key] = body[key];
  }

  const { error } = await supabaseAdmin
    .from('vendors')
    .update(update)
    .eq('id', payload.vendorId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
