import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken } from '@/lib/auth';
import { isContinuationId } from '@/lib/registration-continuation';
import { registrationEmailHash } from '@/lib/registration-continuation-store';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const session = verifySessionToken(request.cookies.get('sm_session')?.value);
  if (!session?.email) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!isContinuationId(body?.id)) return NextResponse.json({ error: 'Invalid continuation.' }, { status: 400 });
  const { data, error } = await supabaseAdmin.rpc('claim_registration_continuation', {
    p_id: body.id, p_email_hash: registrationEmailHash(session.email),
    p_email: session.email.trim().toLowerCase(), p_subscriber_id: session.subscriberId,
  });
  if (error || !data?.conversation_id) {
    await supabaseAdmin.from('agent_events').insert({ event_type: 'registration_continuation_failed', subscriber_id: session.subscriberId, metadata: { reason: error ? 'storage_unavailable' : 'unavailable', flow: 'verified_email_continuation' } });
    return NextResponse.json({ error: 'Your account is ready, but we could not restore this shop. Try again, or request a new link from your original conversation.' }, { status: error ? 503 : 410 });
  }
  return NextResponse.json({ conversationId: data.conversation_id }, { headers: { 'Cache-Control': 'no-store' } });
}
