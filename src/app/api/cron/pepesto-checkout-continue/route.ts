import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BASE = 'https://s.pepesto.com/api';
const SOURCE_RUN_ID = 'pepesto_checkout_protocol_v2_20260821';
const RUN_ID = 'pepesto_checkout_continue_20260821';

function authorized(r: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && r.headers.get('authorization') === `Bearer ${secret}`);
}

async function apiKey() {
  const { data, error } = await supabaseAdmin.rpc('get_pepesto_api_key');
  if (error || typeof data !== 'string' || !data) throw new Error('Pepesto API key unavailable');
  return data;
}

async function checkout(sessionId: string) {
  const key = await apiKey();
  const r = await fetch(`${BASE}/checkout`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ continue_session_id: sessionId }),
    cache: 'no-store',
  });
  const text = await r.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 1000) }; }
  if (!r.ok) throw new Error(`Pepesto /checkout failed (${r.status}): ${text.slice(0, 1000)}`);
  return { json, charged: Number(r.headers.get('Pepesto-Eurocents-Charged') || 0) };
}

function summarizeInstruction(payload: any) {
  const root = payload?.proto ?? payload;
  const instruction = root?.Instruction ?? root?.instruction ?? root;
  if (!instruction || typeof instruction !== 'object') return { type: 'unknown', root_keys: Object.keys(root || {}), instruction: null };
  const keys = Object.keys(instruction);
  const preferred = ['load_page','await_element','run_js','prompt_user_action','await_js_out_change','done'];
  const type = preferred.find((k) => instruction[k] != null) || keys.find((k) => instruction[k] != null) || 'unknown';
  const value = type !== 'unknown' ? instruction[type] : null;
  const safe: any = { type, root_keys: Object.keys(root || {}), instruction_keys: keys, attach_screenshot_on_next_turn: Boolean(root?.attach_screenshot_on_next_turn ?? instruction?.attach_screenshot_on_next_turn) };
  if (type === 'load_page') safe.url = value?.url ?? value;
  if (type === 'await_element') safe.selector = value?.selector ?? value?.css_selector ?? value ?? null;
  if (type === 'prompt_user_action') safe.prompt = String(value?.prompt ?? value?.message ?? value ?? '').slice(0, 800);
  if (type === 'run_js') {
    const code = String(value?.js ?? value?.code ?? value?.javascript ?? value ?? '');
    safe.js_length = code.length;
    safe.js_preview = code.slice(0, 1600);
  }
  if (type === 'await_js_out_change') safe.details = typeof value === 'string' ? value.slice(0,800) : value;
  return safe;
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: existing } = await supabaseAdmin.from('scrape_runs').select('id,status,error_summary').eq('run_id', RUN_ID).maybeSingle();
  if (existing?.id) return Response.json({ status: 'already_ran', existing_status: existing.status, summary: existing.error_summary });

  const { data: source, error: sourceError } = await supabaseAdmin.from('scrape_runs').select('error_summary').eq('run_id', SOURCE_RUN_ID).single();
  if (sourceError || !source?.error_summary) return Response.json({ error: 'Source checkout session not found' }, { status: 404 });
  let parsed: any;
  try { parsed = JSON.parse(source.error_summary); } catch { return Response.json({ error: 'Source checkout session summary invalid' }, { status: 500 }); }
  const sessionId = String(parsed?.session_id || '');
  if (!sessionId) return Response.json({ error: 'Source checkout session id missing' }, { status: 500 });

  const { data: run, error: runError } = await supabaseAdmin.from('scrape_runs').insert({
    run_id: RUN_ID, store:'tesco', retrieval_method:'pepesto_checkout_continue', started_at:new Date().toISOString(), status:'running', target_count:1, threshold_pct:100, attempted_count:0, fetched:0, extracted:0, inserted:0, unchanged_count:0, failed:0, silently_skipped_count:0, threshold_breached:false, scrapingbee_requests:0, scrapingbee_credits:0
  }).select('id').single();
  if (runError || !run?.id) return Response.json({ error: runError?.message || 'failed to open run' }, { status: 500 });

  try {
    const resp = await checkout(sessionId);
    const summary = { session_id: sessionId, charged_cents: resp.charged, instruction: summarizeInstruction(resp.json) };
    await supabaseAdmin.from('scrape_runs').update({ status:'success', finished_at:new Date().toISOString(), attempted_count:1, fetched:1, extracted:1, unchanged_count:1, coverage_pct:100, error_summary:JSON.stringify(summary) }).eq('id', run.id);
    return Response.json({ status:'success', ...summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabaseAdmin.from('scrape_runs').update({ status:'failed', finished_at:new Date().toISOString(), failed:1, error_summary:message.slice(0,1200) }).eq('id', run.id);
    return Response.json({ error: message }, { status: 500 });
  }
}
