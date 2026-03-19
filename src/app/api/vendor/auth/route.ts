import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resend } from '@/lib/resend';
import { signVendorToken } from '@/lib/vendor-auth';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });

    const { data: vendor } = await supabaseAdmin
      .from('vendors')
      .select('id, name, email, status')
      .eq('email', email.toLowerCase().trim())
      .single();

    // Always return success to prevent email enumeration
    if (!vendor) return NextResponse.json({ success: true });

    const token = signVendorToken({ vendorId: vendor.id, email: vendor.email, name: vendor.name });
    const link = `${process.env.NEXT_PUBLIC_SITE_URL}/vendor/dashboard?token=${token}`;

    await resend.emails.send({
      from: 'supermarket.ie <hello@supermarket.ie>',
      to: vendor.email,
      subject: 'Sign in to your supermarket.ie vendor dashboard',
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
          <h1 style="font-size:24px;font-weight:800;color:#1D2324;margin-bottom:8px">Sign in to your dashboard</h1>
          <p style="color:#636E72;margin-bottom:32px">Hi ${vendor.name}, click below to access your vendor dashboard.</p>
          <a href="${link}" style="display:inline-block;background:#E17055;color:white;padding:14px 28px;border-radius:12px;font-weight:700;text-decoration:none;font-size:16px">Open my dashboard →</a>
          <p style="color:#B2BEC3;font-size:13px;margin-top:24px">This link expires in 7 days. If you didn't request this, ignore this email.</p>
        </div>`,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Vendor auth error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
