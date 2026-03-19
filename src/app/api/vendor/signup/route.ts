import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resend } from '@/lib/resend';
import { signVendorToken, slugify } from '@/lib/vendor-auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, description, address, eircode, phone,
            deliveryRadiusKm, minOrderValue, clickAndCollect, categories } = body;

    if (!name?.trim() || !email?.trim()) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
    }

    // Check existing
    const { data: existing } = await supabaseAdmin
      .from('vendors').select('id').eq('email', email.toLowerCase().trim()).single();
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
    }

    // Generate unique slug
    let slug = slugify(name);
    const { data: slugExists } = await supabaseAdmin
      .from('vendors').select('id').eq('slug', slug).single();
    if (slugExists) slug = `${slug}-${Date.now().toString(36)}`;

    const { data: vendor, error } = await supabaseAdmin
      .from('vendors')
      .insert({
        name: name.trim(),
        slug,
        email: email.toLowerCase().trim(),
        description: description?.trim() ?? null,
        address: address?.trim() ?? null,
        eircode: eircode?.trim()?.toUpperCase() ?? null,
        delivery_radius_km: deliveryRadiusKm ?? 0,
        min_order_value: minOrderValue ?? 0,
        click_and_collect: clickAndCollect ?? false,
        categories: categories ?? [],
        status: 'pending',
      })
      .select()
      .single();

    if (error || !vendor) {
      console.error('Vendor signup error:', error);
      return NextResponse.json({ error: 'Failed to create account' }, { status: 500 });
    }

    // Send welcome + magic link
    const token = signVendorToken({ vendorId: vendor.id, email: vendor.email, name: vendor.name });
    const dashboardLink = `${process.env.NEXT_PUBLIC_SITE_URL}/vendor/dashboard?token=${token}`;

    await resend.emails.send({
      from: 'supermarket.ie <hello@supermarket.ie>',
      to: vendor.email,
      subject: 'Welcome to supermarket.ie — your vendor account is being reviewed',
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px 24px">
          <h1 style="font-size:24px;font-weight:800;color:#1D2324;margin-bottom:8px">Welcome, ${vendor.name}! 🎉</h1>
          <p style="color:#636E72;margin-bottom:16px">Your vendor account has been created and is now under review. We typically approve new vendors within 1 business day.</p>
          <p style="color:#636E72;margin-bottom:32px">In the meantime, you can set up your product catalogue so you're ready to go live immediately after approval.</p>
          <a href="${dashboardLink}" style="display:inline-block;background:#E17055;color:white;padding:14px 28px;border-radius:12px;font-weight:700;text-decoration:none;font-size:16px">Set up my catalogue →</a>
          <p style="color:#B2BEC3;font-size:13px;margin-top:24px">Questions? Reply to this email and we'll get back to you.</p>
        </div>`,
    });

    // Notify team
    await resend.emails.send({
      from: 'supermarket.ie <hello@supermarket.ie>',
      to: 'team@supermarket.ie',
      subject: `New vendor signup: ${vendor.name}`,
      html: `<p><strong>${vendor.name}</strong> (${vendor.email}) just signed up as a vendor.</p><p>Eircode: ${vendor.eircode ?? 'not provided'}<br>Categories: ${(categories ?? []).join(', ') || 'none selected'}</p><p><a href="${process.env.NEXT_PUBLIC_SITE_URL}/vendor/dashboard?token=${token}">View their dashboard</a></p>`,
    });

    return NextResponse.json({ success: true, vendorId: vendor.id, token });
  } catch (err) {
    console.error('Vendor signup error:', err);
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
