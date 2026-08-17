import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resend } from '@/lib/resend';
import { signVendorToken, slugify } from '@/lib/vendor-auth';

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
    const body = await request.json();
    const {
      name,
      email,
      description,
      address,
      eircode,
      deliveryRadiusKm,
      minOrderValue,
      clickAndCollect,
      categories,
    } = body;

    if (!name?.trim() || !email?.trim()) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    const normalizedCategories = Array.isArray(categories)
      ? categories.filter((category): category is string => typeof category === 'string').slice(0, 20)
      : [];

    const { data: existing } = await supabaseAdmin
      .from('vendors')
      .select('id')
      .eq('email', normalizedEmail)
      .single();
    if (existing) {
      return NextResponse.json({ success: true, emailVerificationRequired: true });
    }

    let slug = slugify(name);
    const { data: slugExists } = await supabaseAdmin
      .from('vendors')
      .select('id')
      .eq('slug', slug)
      .single();
    if (slugExists) slug = `${slug}-${Date.now().toString(36)}`;

    const { data: vendor, error } = await supabaseAdmin
      .from('vendors')
      .insert({
        name: name.trim(),
        slug,
        email: normalizedEmail,
        description: description?.trim() ?? null,
        address: address?.trim() ?? null,
        eircode: eircode?.trim()?.toUpperCase() ?? null,
        delivery_radius_km: deliveryRadiusKm ?? 0,
        min_order_value: minOrderValue ?? 0,
        click_and_collect: clickAndCollect ?? false,
        categories: normalizedCategories,
        status: 'pending',
      })
      .select()
      .single();

    if (error || !vendor) {
      console.error('Vendor signup error:', error);
      return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
    }

    // The browser never receives the credential. The email link exchanges the
    // short-lived bearer credential for an HttpOnly session cookie before the
    // vendor reaches the dashboard, so the dashboard URL itself stays clean.
    const token = signVendorToken({ vendorId: vendor.id, email: vendor.email, name: vendor.name });
    const dashboardLink = `${process.env.NEXT_PUBLIC_SITE_URL}/api/vendor/session?token=${encodeURIComponent(token)}`;
    const safeName = escapeHtml(vendor.name);
    const safeEmail = escapeHtml(vendor.email);
    const safeEircode = escapeHtml(vendor.eircode ?? 'not provided');
    const safeCategories = normalizedCategories.map(escapeHtml).join(', ') || 'none selected';

    await resend.emails.send({
      from: 'supermarket.ie <hello@supermarket.ie>',
      to: vendor.email,
      subject: 'Confirm your supermarket.ie vendor account',
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
          <h1 style="font-size:24px;font-weight:800;color:#1D2324;margin-bottom:8px">Confirm your email</h1>
          <p style="color:#636E72;margin-bottom:16px">Hi ${safeName}, your vendor application has been created and is now under review.</p>
          <p style="color:#636E72;margin-bottom:32px">Confirm this email address to access your dashboard and set up your catalogue.</p>
          <a href="${dashboardLink}" style="display:inline-block;background:#E17055;color:white;padding:14px 28px;border-radius:12px;font-weight:700;text-decoration:none;font-size:16px">Confirm email &amp; open dashboard →</a>
          <p style="color:#B2BEC3;font-size:13px;margin-top:24px">This link expires in 7 days. If you did not create this application, ignore this email.</p>
        </div>`,
    });

    await resend.emails.send({
      from: 'supermarket.ie <hello@supermarket.ie>',
      to: 'team@supermarket.ie',
      subject: `New vendor signup: ${vendor.name}`,
      html: `<p><strong>${safeName}</strong> (${safeEmail}) just signed up as a vendor.</p><p>Eircode: ${safeEircode}<br>Categories: ${safeCategories}</p><p>Vendor ID: ${escapeHtml(vendor.id)}</p>`,
    });

    return NextResponse.json({
      success: true,
      emailVerificationRequired: true,
    });
  } catch (err) {
    console.error('Vendor signup error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
