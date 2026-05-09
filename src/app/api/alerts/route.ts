import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import jwt from 'jsonwebtoken';

const SECRET = process.env.MAGIC_LINK_SECRET;
if (!SECRET) throw new Error('MAGIC_LINK_SECRET environment variable is required');

interface CreateAlertRequest {
  token: string;
  product_id: string;
  target_price: number;
}

interface DeleteAlertRequest {
  token: string;
  alert_id: string;
}

function verifyToken(token: string): { subscriberId: string; email: string; familySize: string } {
  try {
    return jwt.verify(token, SECRET!) as {
      subscriberId: string;
      email: string;
      familySize: string;
    };
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

// POST - Create a new price alert
export async function POST(request: NextRequest) {
  try {
    const body: CreateAlertRequest = await request.json();

    if (!body.token || !body.product_id || !body.target_price) {
      return NextResponse.json(
        { error: 'Missing required fields: token, product_id, target_price' },
        { status: 400 }
      );
    }

    if (body.target_price <= 0) {
      return NextResponse.json(
        { error: 'Target price must be greater than 0' },
        { status: 400 }
      );
    }

    // Verify JWT token
    let decoded;
    try {
      decoded = verifyToken(body.token);
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    // Check if product exists
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .select('id, canonical_name')
      .eq('id', body.product_id)
      .single();

    if (productError || !product) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      );
    }

    // Check if alert already exists for this user/product combination
    const { data: existingAlert, error: checkError } = await supabaseAdmin
      .from('price_alerts')
      .select('id')
      .eq('subscriber_id', decoded.subscriberId)
      .eq('product_id', body.product_id)
      .eq('active', true)
      .single();

    if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows returned
      return NextResponse.json(
        { error: 'Error checking existing alerts' },
        { status: 500 }
      );
    }

    if (existingAlert) {
      return NextResponse.json(
        { error: 'Alert already exists for this product' },
        { status: 409 }
      );
    }

    // Create new alert
    const { data: alert, error: insertError } = await supabaseAdmin
      .from('price_alerts')
      .insert({
        subscriber_id: decoded.subscriberId,
        product_id: body.product_id,
        target_price: body.target_price
      })
      .select('id, product_id, target_price, active, created_at')
      .single();

    if (insertError) {
      console.error('[alerts] Error creating alert:', insertError);
      return NextResponse.json(
        { error: 'Failed to create alert' },
        { status: 500 }
      );
    }

    console.log(`[alerts] Created alert for subscriber ${decoded.subscriberId}, product ${body.product_id}`);

    return NextResponse.json({
      alert: {
        ...alert,
        product_name: product.canonical_name
      }
    });

  } catch (error) {
    console.error('[alerts] POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET - List active alerts for user
export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token');

    if (!token) {
      return NextResponse.json(
        { error: 'Missing token parameter' },
        { status: 400 }
      );
    }

    // Verify JWT token
    let decoded;
    try {
      decoded = verifyToken(token);
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    // Fetch active alerts for this user
    const { data: alerts, error: alertsError } = await supabaseAdmin
      .from('price_alerts')
      .select(`
        id,
        product_id,
        target_price,
        created_at,
        products!inner(
          canonical_name
        )
      `)
      .eq('subscriber_id', decoded.subscriberId)
      .eq('active', true)
      .order('created_at', { ascending: false });

    if (alertsError) {
      console.error('[alerts] Error fetching alerts:', alertsError);
      return NextResponse.json(
        { error: 'Failed to fetch alerts' },
        { status: 500 }
      );
    }

    const formattedAlerts = (alerts || []).map(alert => {
      const product = alert.products as any;
      return {
        id: alert.id,
        product_id: alert.product_id,
        product_name: product.canonical_name,
        target_price: alert.target_price,
        created_at: alert.created_at
      };
    });

    return NextResponse.json({ alerts: formattedAlerts });

  } catch (error) {
    console.error('[alerts] GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// DELETE - Deactivate an alert
export async function DELETE(request: NextRequest) {
  try {
    const body: DeleteAlertRequest = await request.json();

    if (!body.token || !body.alert_id) {
      return NextResponse.json(
        { error: 'Missing required fields: token, alert_id' },
        { status: 400 }
      );
    }

    // Verify JWT token
    let decoded;
    try {
      decoded = verifyToken(body.token);
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    // Deactivate the alert (only if it belongs to this user)
    const { data: updatedAlert, error: updateError } = await supabaseAdmin
      .from('price_alerts')
      .update({ active: false })
      .eq('id', body.alert_id)
      .eq('subscriber_id', decoded.subscriberId)
      .eq('active', true) // Only update if currently active
      .select('id')
      .single();

    if (updateError && updateError.code === 'PGRST116') {
      return NextResponse.json(
        { error: 'Alert not found or already inactive' },
        { status: 404 }
      );
    }

    if (updateError) {
      console.error('[alerts] Error deactivating alert:', updateError);
      return NextResponse.json(
        { error: 'Failed to deactivate alert' },
        { status: 500 }
      );
    }

    console.log(`[alerts] Deactivated alert ${body.alert_id} for subscriber ${decoded.subscriberId}`);

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('[alerts] DELETE error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}