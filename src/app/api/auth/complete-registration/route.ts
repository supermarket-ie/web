import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '@/lib/supabase';
import { isContinuationId } from '@/lib/registration-continuation';

const SECRET = process.env.MAGIC_LINK_SECRET;
if (!SECRET) throw new Error('MAGIC_LINK_SECRET environment variable is required');

type VerificationPayload = {
  purpose?: string;
  email?: string;
  familySize?: string;
  analyticsSessionId?: string | null;
  source?: 'signup' | 'sign_in';
  continuationId?: string;
};

async function notifyTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    if (!response.ok) {
      console.error('[complete-registration] Telegram notification failed:', response.status, await response.text());
    }
  } catch (error) {
    console.error('[complete-registration] Telegram notification failed:', error);
  }
}

function failed(request: NextRequest, continuationId?: string) {
  const target = new URL('/list/request?error=expired', request.url);
  if (isContinuationId(continuationId)) target.searchParams.set('continuation', continuationId);
  const response = NextResponse.redirect(target);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function GET(request: NextRequest) {
  const verificationToken = request.nextUrl.searchParams.get('token');
  if (!verificationToken) return failed(request);

  let verification: VerificationPayload;
  try {
    verification = jwt.verify(verificationToken, SECRET!) as VerificationPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      // Rechecking the signature allows a new email request for the same draft;
      // the expired token itself never authenticates or restores anything.
      try {
        const expired = jwt.verify(verificationToken, SECRET!, { ignoreExpiration: true }) as VerificationPayload;
        if (expired.purpose === 'registration_verification') {
          await supabaseAdmin.from('agent_events').insert({ event_type: 'verification_link_expired', session_id: expired.analyticsSessionId ?? null, metadata: { flow: 'verified_email_continuation' } });
          return failed(request, expired.continuationId);
        }
      } catch {}
    }
    return failed(request);
  }

  if (verification.purpose !== 'registration_verification' || !verification.email) {
    return failed(request);
  }

  const email = verification.email.toLowerCase().trim();
  let familySize = verification.familySize || '2';
  const source = verification.source === 'sign_in' ? 'sign_in' : 'signup';
  const acquisitionSource = source === 'sign_in' ? 'direct_account' : 'inline_agent_continuation';
  const unsubscribeToken = crypto.randomBytes(32).toString('hex');

  const { error: openedEventError } = await supabaseAdmin.from('agent_events').insert({
    event_type: 'verification_link_opened',
    session_id: verification.analyticsSessionId ?? null,
    metadata: { method: 'email', flow: 'verified_email_continuation', source, acquisition_source: acquisitionSource },
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
  let newlyCreated = false;
  if (existing) {
    // Signing in must not overwrite an existing household with the form's default.
    familySize = existing.family_size || familySize;
    const { error } = await supabaseAdmin
      .from('subscribers')
      .update({
        subscribed: true,
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
    if (error?.code === '23505') {
      const { data: concurrent } = await supabaseAdmin.from('subscribers').select('id,family_size').eq('email', email).maybeSingle();
      if (!concurrent) return failed(request, verification.continuationId);
      subscriberId = concurrent.id;
      familySize = concurrent.family_size || familySize;
    } else if (error || !data) {
      console.error('[complete-registration] insert failed:', error);
      return failed(request);
    } else {
      subscriberId = data.id;
      newlyCreated = true;
    }
  }

  const sessionToken = jwt.sign(
    { email, subscriberId, familySize },
    SECRET!,
    { expiresIn: '7d' },
  );

  if (newlyCreated) {
    const { error } = await supabaseAdmin.from('agent_events').insert({
      event_type: 'signup_completed',
      session_id: verification.analyticsSessionId ?? null,
      subscriber_id: subscriberId,
      metadata: {
        method: 'email',
        flow: 'verified_email_continuation',
        verified: true,
        source,
        acquisition_source: acquisitionSource,
      },
    });
    if (error) console.error('[complete-registration] analytics insert failed:', error);

    const { count } = await supabaseAdmin
      .from('subscribers')
      .select('*', { count: 'exact', head: true })
      .eq('subscribed', true);
    const familyLabel: Record<string, string> = {
      '1': '1 person',
      '2': '2 people',
      '3-4': '3–4 people',
      '5+': '5+ people',
    };
    await notifyTelegram(
      `🆕 New verified subscriber on supermarket.ie!\n\n📧 ${email}\n👥 ${familyLabel[familySize] ?? familySize ?? 'Not set'}\n📊 Total subscribers: ${count ?? '?'}`,
    );
  }

  const target = new URL('/auth/complete', request.url);
  target.searchParams.set('new', newlyCreated ? '1' : '0');
  if (isContinuationId(verification.continuationId)) target.searchParams.set('continuation', verification.continuationId);
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
