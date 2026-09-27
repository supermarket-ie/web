import 'server-only';
import { createHmac } from 'node:crypto';
import { supabaseAdmin } from './supabase';
import { CONTINUATION_TTL_MS, registrationContinuation } from './registration-continuation';

export function registrationEmailHash(email: string) {
  const secret = process.env.MAGIC_LINK_SECRET;
  if (!secret) throw new Error('Registration is unavailable');
  return createHmac('sha256', secret).update(`registration:${email.trim().toLowerCase()}`).digest('hex');
}

export async function stageRegistrationContinuation(email: string, value: unknown, analyticsSessionId: string | null) {
  const payload = { ...registrationContinuation(value), analyticsSessionId };
  const { data, error } = await supabaseAdmin.from('registration_continuations').insert({
    email_hash: registrationEmailHash(email), payload,
    expires_at: new Date(Date.now() + CONTINUATION_TTL_MS).toISOString(),
  }).select('id').single();
  if (error || !data) throw new Error('We could not keep your shop ready for verification. Please try again.');
  return { id: data.id as string, kind: payload.kind, familySize: payload.familySize };
}

export async function cleanupRegistrationContinuations() {
  const { error } = await supabaseAdmin.from('registration_continuations').delete().lt('expires_at', new Date().toISOString());
  if (error) console.error('[registration] Expired handoff cleanup failed:', error.code);
}

export async function resumeRegistrationContinuation(email: string, id: string) {
  const { data, error } = await supabaseAdmin.from('registration_continuations')
    .select('id,payload').eq('id', id).eq('email_hash', registrationEmailHash(email))
    .gt('expires_at', new Date().toISOString()).maybeSingle();
  if (error || !data) throw new Error('This saved continuation is unavailable. Request a link from your original conversation.');
  return { id: data.id as string, kind: data.payload?.kind === 'shop' ? 'shop' as const : 'conversation' as const, familySize: data.payload?.familySize as string | undefined };
}
