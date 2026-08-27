import { NextRequest, NextResponse } from 'next/server';
import { resend } from '@/lib/resend';
import { supabaseAdmin } from '@/lib/supabase';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const SECRET = process.env.MAGIC_LINK_SECRET;
if (!SECRET) throw new Error('MAGIC_LINK_SECRET environment variable is required');

const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS_PER_IP = 5;
const MAX_REQUESTS_PER_EMAIL = 3;
const MAX_SESSION_ID_LENGTH = 128;
const buckets = new Map<string, { count: number; resetAt: number }>();

function clientIp(request: NextRequest) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'unknown';
}

function bucketKey(value: string) {
  return crypto.createHmac('sha256', SECRET!).update(value).digest('hex');
}

function consumeLimit(key: string, maximum: number) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > maximum;
}

function verificationEmail(verificationUrl: string) {
  return {
    subject: 'Confirm your email for Supermarket.ie',
    text: `Confirm your email to continue with Supermarket.ie:\n\n${verificationUrl}\n\nThis link is valid for 15 minutes. If you did not request it, you can ignore this email.\n\n— supermarket.ie`,
    html: `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#F6F2EA;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#183126;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background:#F6F2EA;">
    <tr><td align="center" style="padding:36px 16px;">
      <table width="560" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;max-width:560px;">
        <tr><td style="padding:0 4px 18px;font-size:22px;font-weight:800;color:#173827;">supermarket<span style="color:#0A7A3E;">.ie</span></td></tr>
        <tr><td style="background:#0F6B3B;border-radius:22px 22px 0 0;padding:34px 32px;color:#FFFFFF;">
          <div style="font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#D9F0DE;margin-bottom:10px;">Ireland’s household shopping agent</div>
          <div style="font-size:30px;line-height:1.15;font-weight:800;">Confirm your email</div>
          <div style="font-size:16px;line-height:1.6;color:#E7F4EA;margin-top:14px;">Use the secure link below to continue and protect your household information.</div>
        </td></tr>
        <tr><td style="background:#FFFFFF;border:1px solid #E8E2D8;border-top:0;border-radius:0 0 22px 22px;padding:30px 32px;">
          <a href="${verificationUrl}" style="display:inline-block;background:#13271D;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:800;padding:14px 22px;border-radius:999px;">Confirm and continue →</a>
          <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#8A918C;">This link is valid for 15 minutes. If you did not request it, you can ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null) as {
      email?: unknown;
      familySize?: unknown;
      sessionId?: unknown;
    } | null;

    if (typeof body?.email !== 'string' || !body.email.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const normalizedEmail = body.email.toLowerCase().trim();
    const familySize = typeof body.familySize === 'string' ? body.familySize : '2';
    const sessionId = typeof body.sessionId === 'string' && body.sessionId.length <= MAX_SESSION_ID_LENGTH
      ? body.sessionId
      : null;

    const ipLimited = consumeLimit(bucketKey(`ip:${clientIp(request)}`), MAX_REQUESTS_PER_IP);
    const emailLimited = consumeLimit(bucketKey(`email:${normalizedEmail}`), MAX_REQUESTS_PER_EMAIL);
    if (ipLimited || emailLimited) {
      return NextResponse.json({ error: 'Too many requests. Please wait before trying again.' }, { status: 429 });
    }

    const verificationToken = jwt.sign(
      {
        purpose: 'registration_verification',
        email: normalizedEmail,
        familySize,
        analyticsSessionId: sessionId,
      },
      SECRET!,
      { expiresIn: '15m' },
    );

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    const verificationUrl = `${siteUrl}/api/auth/complete-registration?token=${encodeURIComponent(verificationToken)}`;
    const email = verificationEmail(verificationUrl);
    const { error } = await resend.emails.send({
      from: 'supermarket.ie <hello@mail.supermarket.ie>',
      to: normalizedEmail,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    if (error) {
      console.error('[subscribe] verification email failed:', error);
      return NextResponse.json({ error: 'We could not send the verification email.' }, { status: 502 });
    }

    const { error: analyticsError } = await supabaseAdmin.from('agent_events').insert({
      event_type: 'verification_email_sent',
      session_id: sessionId,
      metadata: { method: 'email', flow: 'verified_email_continuation' },
    });
    if (analyticsError) console.error('[subscribe] analytics insert failed:', analyticsError);

    return NextResponse.json({ success: true, verification_required: true });
  } catch (error) {
    console.error('[subscribe] error:', error);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
