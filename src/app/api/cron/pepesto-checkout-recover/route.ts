import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BASE = 'https://s.pepesto.com/api';
const SOURCE_RUN = 'pepesto_checkout_protocol_v2_20260821';
const RUN_ID = 'pepesto_checkout_recover_20260821';

function authorized(r: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && r.headers.get('authorization') === `Bearer ${secret}`);
}

async function apiKey() {
  const { data, error } = await supabaseAdmin.rpc('get_pepesto_api_key');
  if (error || typeof data !== 'string' || !data) throw new Error('Pepesto API key unavailable');
  return data;
}

async function postCheckout(body: unknown) {
  const key = await apiKey();
  const r = await fetch(`${BASE}/checkout`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const text = await r.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!r.ok) throw new Error(`Pepesto /checkout failed (${r.status}): ${text.slice(0, 1000)}`);
  return { json, charged: Number(r.headers.get('Pepesto-Eurocents-Charged') || 0) };
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: existing } = await supabaseAdmin.from('scrape_runs').select('id,status,error_summary').eq('run_id', RUN_ID).maybeSingle();
  if (existing?.id) return Response.json({ status: 'already_ran', summary: existing.error_summary });

  const { data: source, error: sourceError } = await supabaseAdmin.from('scrape_runs').select('error_summary').eq('run_id', SOURCE_RUN).single();
  if (sourceError || !source?.error_summary) return Response.json({ error: 'Source checkout run unavailable' }, { status: 500 });
  const parsed = JSON.parse(source.error_summary);
  const sessionId = String(parsed?.session_id || '');
  if (!sessionId) return Response.json({ error: 'Source session_id unavailable' }, { status: 500 });

  const { data: run, error: runError } = await supabaseAdmin.from('scrape_runs').insert({
    run_id: RUN_ID, store: 'tesco', retrieval_method: 'pepesto_checkout_recover', started_at: new Date().toISOString(), status: 'running',
    target_count: 1, attempted_count: 0, fetched: 0, extracted: 0, inserted: 0, unchanged_count: 0, failed: 0,
    silently_skipped_count: 0, threshold_breached: false, scrapingbee_requests: 0, scrapingbee_credits: 0
  }).select('id').single();
  if (runError || !run?.id) return Response.json({ error: runError?.message || 'failed to open run' }, { status: 500 });

  try {
    const response = await postCheckout({
      continue_session_id: sessionId,
      prev_turn_response: { error: 'Client did not retain the previous RunJs payload; please issue a fresh instruction.' }
    });
    const summary = { session_id: sessionId, charged_cents: response.charged, checkout_response: response.json };
    await supabaseAdmin.from('scrape_runs').update({
      status: 'success', finished_at: new Date().toISOString(), attempted_count: 1, fetched: 1, extracted: 1, unchanged_count: 1, failed: 0, coverage_pct: 100,
      error_summary: JSON.stringify(summary)
    }).eq('id', run.id);
    return Response.json({ status: 'success', charged_cents: response.charged });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabaseAdmin.from('scrape_runs').update({ status: 'failed', finished_at: new Date().toISOString(), failed: 1, error_summary: message.slice(0, 3000) }).eq('id', run.id);
    return Response.json({ error: message }, { status: 500 });
  }
}
