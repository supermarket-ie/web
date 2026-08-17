import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resend } from '@/lib/resend';
import { signVendorToken } from '@/lib/vendor-auth';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const { data: vendor } = await supabaseAdmin
      .from('vendors')
      .select('id, name, email, status')
      .eq('email', normalizedEmail)
      .single();

    // Always return success for valid-looking addresses to prevent account enumeration.
    if (!vendor) return NextResponse.json({ success: true });

    const token = signVendorToken({ vendorId: vendor.id, email: vendor.email, name: vendor.name });
    const link = `${process.env.NEXT_PUBLIC_SITE_URL}/vendor/dashboard?token=${token}`;
    const safeName = escapeHtml(vendor.name);

    await resend.emails.send({
      from: 'supermarket.ie <hello@supermarket.ie>',
      to: vendor.email,
      subject: 'Sign in to your supermarket.ie vendor dashboard',
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
          <h1 style="font-size:24px;font-weight:800;color:#1D2324;margin-bottom:8px">Sign in to your dashboard</h1>
          <p style="color:#636E72;margin-bottom:32px">Hi ${safeName}, click below to access your vendor dashboard.</p>
          <a href="${link}" style="display:inline-block;background:#E17055;color:white;padding:14px 28px;border-radius:12px;font-weight:700;text-decoration:none;font-size:16px">Open my dashboard →</a>
          <p style="color:#B2BEC3;font-size:13px;margin-top:24px">This link expires in 7 days. If you didn&apos;t request this, ignore this email.</p>
        </div>`,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Vendor auth error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
