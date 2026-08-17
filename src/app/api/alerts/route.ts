import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { verifySessionToken } from '@/lib/auth';

function sessionPayload(request: NextRequest, explicit?: unknown) {
  const token = request.cookies.get('sm_session')?.value ??
    (typeof explicit === 'string' && explicit !== '__cookie__' ? explicit : '');
  return verifySessionToken(token);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { token?: unknown; product_id?: unknown; target_price?: unknown };
    const decoded = sessionPayload(request, body.token);
    if (!decoded) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    if (typeof body.product_id !== 'string' || typeof body.target_price !== 'number' || body.target_price <= 0) {
      return NextResponse.json({ error: 'Valid product_id and target_price are required' }, { status: 400 });
    }

    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .select('id, canonical_name')
      .eq('id', body.product_id)
      .single();
    if (productError || !product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const { data: existingAlert, error: checkError } = await supabaseAdmin
      .from('price_alerts')
      .select('id')
      .eq('subscriber_id', decoded.subscriberId)
      .eq('product_id', body.product_id)
      .eq('active', true)
      .maybeSingle();
    if (checkError) return NextResponse.json({ error: 'Error checking existing alerts' }, { status: 500 });
    if (existingAlert) return NextResponse.json({ error: 'Alert already exists for this product' }, { status: 409 });

    const { data: alert, error: insertError } = await supabaseAdmin
      .from('price_alerts')
      .insert({ subscriber_id: decoded.subscriberId, product_id: body.product_id, target_price: body.target_price })
      .select('id, product_id, target_price, active, created_at')
      .single();
    if (insertError) return NextResponse.json({ error: 'Failed to create alert' }, { status: 500 });

    return NextResponse.json({ alert: { ...alert, product_name: product.canonical_name } });
  } catch (error) {
    console.error('[alerts] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const decoded = sessionPayload(request, request.nextUrl.searchParams.get('token'));
    if (!decoded) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const { data: alerts, error } = await supabaseAdmin
      .from('price_alerts')
      .select('id, product_id, target_price, created_at, products!inner(canonical_name)')
      .eq('subscriber_id', decoded.subscriberId)
      .eq('active', true)
      .order('created_at', { ascending: false });
    if (error) return NextResponse.json({ error: 'Failed to fetch alerts' }, { status: 500 });

    return NextResponse.json({
      alerts: (alerts ?? []).map(alert => ({
        id: alert.id,
        product_id: alert.product_id,
        product_name: (alert.products as unknown as { canonical_name: string }).canonical_name,
        target_price: alert.target_price,
        created_at: alert.created_at,
      })),
    });
  } catch (error) {
    console.error('[alerts] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json() as { token?: unknown; alert_id?: unknown };
    const decoded = sessionPayload(request, body.token);
    if (!decoded) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (typeof body.alert_id !== 'string') return NextResponse.json({ error: 'alert_id required' }, { status: 400 });

    const { data, error } = await supabaseAdmin
      .from('price_alerts')
      .update({ active: false })
      .eq('id', body.alert_id)
      .eq('subscriber_id', decoded.subscriberId)
      .eq('active', true)
      .select('id')
      .maybeSingle();
    if (error) return NextResponse.json({ error: 'Failed to deactivate alert' }, { status: 500 });
    if (!data) return NextResponse.json({ error: 'Alert not found or already inactive' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[alerts] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
