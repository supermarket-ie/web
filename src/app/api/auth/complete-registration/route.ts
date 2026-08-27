import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '@/lib/supabase';

const SECRET = process.env.MAGIC_LINK_SECRET;
if (!SECRET) throw new Error('MAGIC_LINK_SECRET environment variable is required');

type VerificationPayload = {
  purpose?: string;
  email?: string;
  familySize?: string;
  analyticsSessionId?: string | null;
};

function failed(request: NextRequest) {
  return NextResponse.redirect(new URL('/list/request?error=expired', request.url));
}

export async function GET(request: NextRequest) {
  const verificationToken = request.nextUrl.searchParams.get('token');
  if (!verificationToken) return failed(request);

  let verification: VerificationPayload;
  try {
    verification = jwt.verify(verificationToken, SECRET!) as VerificationPayload;
  } catch {
    return failed(request);
  }

  if (verification.purpose !== 'registration_verification' || !verification.email) {
    return failed(request);
  }

  const email = verification.email.toLowerCase().trim();
  const familySize = verification.familySize || '2';
  const unsubscribeToken = crypto.randomBytes(32).toString('hex');

  const { error: openedEventError } = await supabaseAdmin.from('agent_events').insert({
    event_type: 'verification_link_opened',
    session_id: verification.analyticsSessionId ?? null,
    metadata: { method: 'email', flow: 'verified_email_continuation' },
  });
  if (openedEventError) console.error('[complete-registration] verification-open analytics insert failed:', openedEventError);

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('subscribers')
    .select('id, family_size')
    .eq('email', email)
    .maybeSingle();

  if (lookupError) {
    console.error('[complete-registration] lookup failed:', lookupError);
    return failed(request);
  }

  let subscriberId: string;
  if (existing) {
    const { error } = await supabaseAdmin
      .from('subscribers')
      .update({
        subscribed: true,
        family_size: familySize || existing.family_size || null,
        unsubscribe_token: unsubscribeToken,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (error) {
      console.error('[complete-registration] update failed:', error);
      return failed(request);
    }
    subscriberId = existing.id;
  } else {
    const { data, error } = await supabaseAdmin
      .from('subscribers')
      .insert({ email, family_size: familySize, unsubscribe_token: unsubscribeToken, subscribed: true })
      .select('id')
      .single();
    if (error || !data) {
      console.error('[complete-registration] insert failed:', error);
      return failed(request);
    }
    subscriberId = data.id;
  }

  const sessionToken = jwt.sign(
    { email, subscriberId, familySize },
    SECRET!,
    { expiresIn: '7d' },
  );

  if (!existing) {
    const { error } = await supabaseAdmin.from('agent_events').insert({
      event_type: 'signup_completed',
      session_id: verification.analyticsSessionId ?? null,
      subscriber_id: subscriberId,
      metadata: { method: 'email', flow: 'verified_email_continuation', verified: true },
    });
    if (error) console.error('[complete-registration] analytics insert failed:', error);
  }

  const target = new URL('/auth/complete', request.url);
  target.searchParams.set('new', existing ? '0' : '1');
  const response = NextResponse.redirect(target);
  response.cookies.set({
    name: 'sm_session',
    value: sessionToken,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
