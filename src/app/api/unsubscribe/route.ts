import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json(
        { error: 'Invalid unsubscribe link' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('subscribers')
      .update({
        subscribed: false,
        updated_at: new Date().toISOString(),
      })
      .eq('unsubscribe_token', token)
      .select('email')
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Invalid or expired unsubscribe link' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, email: data.email });
  } catch (error) {
    console.error('Unsubscribe error:', error);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}
