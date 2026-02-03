import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resend } from '@/lib/resend';
import crypto from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const { email, familySize } = await request.json();

    if (!email || !familySize) {
      return NextResponse.json(
        { error: 'Email and family size are required' },
        { status: 400 }
      );
    }

    // Generate unsubscribe token
    const unsubscribeToken = crypto.randomBytes(32).toString('hex');

    // Check if email already exists
    const { data: existing } = await supabaseAdmin
      .from('subscribers')
      .select('id, subscribed')
      .eq('email', email.toLowerCase())
      .single();

    if (existing) {
      if (existing.subscribed) {
        return NextResponse.json(
          { error: 'This email is already subscribed' },
          { status: 409 }
        );
      } else {
        // Re-subscribe
        const { error: updateError } = await supabaseAdmin
          .from('subscribers')
          .update({
            subscribed: true,
            family_size: familySize,
            unsubscribe_token: unsubscribeToken,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);

        if (updateError) throw updateError;
      }
    } else {
      // Insert new subscriber
      const { error: insertError } = await supabaseAdmin
        .from('subscribers')
        .insert({
          email: email.toLowerCase(),
          family_size: familySize,
          unsubscribe_token: unsubscribeToken,
          subscribed: true,
        });

      if (insertError) throw insertError;
    }

    // Send welcome email
    const unsubscribeUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/unsubscribe?token=${unsubscribeToken}`;
    
    await resend.emails.send({
      from: 'supermarket.ie <hello@mail.supermarket.ie>',
      to: email,
      subject: 'Welcome to supermarket.ie! 🛒',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1A1A1A; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #1B4D3E; margin: 0;">supermarket<span style="color: #FF6B5B;">.ie</span></h1>
          </div>
          
          <h2 style="color: #1B4D3E;">Welcome aboard! 🎉</h2>
          
          <p>Thanks for signing up to supermarket.ie — you've just made grocery shopping in Ireland a whole lot easier.</p>
          
          <p>Here's what happens next:</p>
          
          <ul style="padding-left: 20px;">
            <li><strong>We're building something special</strong> — personalised weekly shopping lists tailored to your household of ${familySize === '5+' ? '5+' : familySize} ${familySize === '1' ? 'person' : 'people'}.</li>
            <li><strong>You'll be first to know</strong> when we launch. Early subscribers get priority access.</li>
            <li><strong>No spam, ever</strong> — just helpful updates about deals and savings.</li>
          </ul>
          
          <p>In the meantime, keep an eye on your inbox. We'll be in touch soon with your first personalised list.</p>
          
          <p style="margin-top: 30px;">
            Cheers,<br>
            <strong>The supermarket.ie Team</strong>
          </p>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          
          <p style="font-size: 12px; color: #666; text-align: center;">
            You're receiving this because you signed up at supermarket.ie.<br>
            <a href="${unsubscribeUrl}" style="color: #666;">Unsubscribe</a> | 
            <a href="https://www.supermarket.ie/privacy" style="color: #666;">Privacy Policy</a>
          </p>
        </body>
        </html>
      `,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Subscribe error:', error);
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    );
  }
}
