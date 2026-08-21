import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BASE = 'https://s.pepesto.com/api';
const RUN_ID = 'pepesto_checkout_protocol_v2_20260821';

const TEST_PRODUCTS = [
  { name: 'Tesco Crunchy Peanut Butter', url: 'https://www.tesco.ie/shop/en-IE/products/264769567' },
  { name: 'Kenco Smooth Instant Coffee', url: 'https://www.tesco.ie/shop/en-IE/products/323643868' },
  { name: 'Tesco Chicken Legs', url: 'https://www.tesco.ie/shop/en-IE/products/302515004' },
  { name: 'Green Isle Baby Carrots', url: 'https://www.tesco.ie/shop/en-IE/products/315964892' },
  { name: 'Tesco Baby Irish Rooster Potatoes', url: 'https://www.tesco.ie/shop/en-IE/products/288406575' },
];

function authorized(r: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && r.headers.get('authorization') === `Bearer ${secret}`);
}

async function apiKey() {
  const { data, error } = await supabaseAdmin.rpc('get_pepesto_api_key');
  if (error || typeof data !== 'string' || !data) throw new Error('Pepesto API key unavailable');
  return data;
}

async function post(path: string, body: unknown) {
  const key = await apiKey();
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const text = await r.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 500) }; }
  if (!r.ok) throw new Error(`Pepesto ${path} failed (${r.status}): ${text.slice(0, 500)}`);
  return { json, charged: Number(r.headers.get('Pepesto-Eurocents-Charged') || 0) };
}

function flattenProducts(payload: any) {
  const out: any[] = [];
  for (const item of payload?.items ?? []) {
    for (const wrapper of item?.products ?? []) {
      const product = wrapper?.product ?? wrapper;
      const sessionToken = wrapper?.session_token ?? product?.session_token;
      if (product) out.push({ item_name: item?.item_name, product, session_token: sessionToken, num_units_to_buy: wrapper?.num_units_to_buy ?? 1 });
    }
  }
  return out;
}

function summarizeInstruction(proto: any) {
  if (!proto || typeof proto !== 'object') return { type: 'unknown', keys: [] };
  const keys = Object.keys(proto);
  const preferred = ['load_page','await_element','run_js','prompt_user_action','await_js_out_change','done'];
  const type = preferred.find((k) => proto[k] != null) || keys.find((k) => proto[k] != null && !['session_id','attach_screenshot_on_next_turn'].includes(k)) || 'unknown';
  const value = type !== 'unknown' ? proto[type] : null;
  const safe: any = { type, keys, attach_screenshot_on_next_turn: Boolean(proto.attach_screenshot_on_next_turn) };
  if (type === 'load_page') safe.url = value?.url ?? value;
  if (type === 'await_element') safe.selector = value?.selector ?? value?.css_selector ?? null;
  if (type === 'prompt_user_action') safe.prompt = String(value?.prompt ?? value?.message ?? '').slice(0, 500);
  if (type === 'run_js') {
    const code = String(value?.js ?? value?.code ?? value?.javascript ?? '');
    safe.js_length = code.length;
    safe.js_preview = code.slice(0, 800);
  }
  return safe;
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: existing } = await supabaseAdmin.from('scrape_runs').select('id,status,error_summary').eq('run_id', RUN_ID).maybeSingle();
  if (existing?.id) return Response.json({ status: 'already_ran', run_id: RUN_ID, existing_status: existing.status, summary: existing.error_summary });

  const { data: run, error: runError } = await supabaseAdmin.from('scrape_runs').insert({
    run_id: RUN_ID, store: 'tesco', retrieval_method: 'pepesto_checkout_protocol', started_at: new Date().toISOString(), status: 'running',
    target_count: 3, threshold_pct: 100, attempted_count: 0, fetched: 0, extracted: 0, inserted: 0, unchanged_count: 0, failed: 0,
    silently_skipped_count: 0, threshold_breached: false, scrapingbee_requests: 0, scrapingbee_credits: 0,
  }).select('id').single();
  if (runError || !run?.id) return Response.json({ error: runError?.message || 'failed to open run' }, { status: 500 });

  try {
    const creditsResp = await post('/credits', {});
    const creditsBefore = Number(creditsResp.json?.euro_cents ?? 0);
    if (creditsBefore < 124) throw new Error(`Insufficient Pepesto credits for protocol test: ${creditsBefore} cents`);

    const productsResp = await post('/products', {
      recipe_kg_tokens: [],
      manual_shopping_list: TEST_PRODUCTS.map((p) => p.name).join('\n'),
      supermarket_domain: 'tesco.ie',
      preferred_product_urls: TEST_PRODUCTS.map((p) => p.url),
      item_names_locale: 'en-IE',
    });

    const flattened = flattenProducts(productsResp.json);
    const selected = TEST_PRODUCTS.map((target) => {
      const exact = flattened.find((x) => String(x?.product?.product_id || '') === target.url);
      return exact ? { target, match: exact } : null;
    }).filter(Boolean) as any[];

    if (selected.length < 3) throw new Error(`Pepesto /products exact URL match only found ${selected.length}/5; need 3`);

    const chosen = selected.slice(0, 3);
    const skus = chosen.map((x) => ({ session_token: x.match.session_token, num_units_to_buy: 1 }));
    if (skus.some((x) => !x.session_token)) throw new Error('Missing one or more Pepesto session tokens');

    const sessionResp = await post('/session', { supermarket_domain: 'tesco.ie', user_locale: 'en-IE', skus });
    const sessionId = String(sessionResp.json?.session_id || '');
    if (!sessionId) throw new Error('Pepesto /session did not return session_id');

    const checkoutResp = await post('/checkout', { continue_session_id: sessionId });
    const proto = checkoutResp.json?.proto ?? checkoutResp.json;
    const summary = {
      credits_before_cents: creditsBefore,
      charged_cents: { products: productsResp.charged, session: sessionResp.charged, checkout_turn_1: checkoutResp.charged, total: productsResp.charged + sessionResp.charged + checkoutResp.charged },
      matched_products: chosen.map((x) => ({ requested_name: x.target.name, requested_url: x.target.url, returned_name: x.match?.product?.product_name ?? null, returned_url: x.match?.product?.product_id ?? null })),
      session_id: sessionId,
      first_instruction: summarizeInstruction(proto),
    };

    await supabaseAdmin.from('scrape_runs').update({ status: 'success', finished_at: new Date().toISOString(), target_count: 3, attempted_count: 3, fetched: 3, extracted: 3, inserted: 0, unchanged_count: 3, failed: 0, coverage_pct: 100, error_summary: JSON.stringify(summary) }).eq('id', run.id);
    return Response.json({ status: 'success', run_id: RUN_ID, ...summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabaseAdmin.from('scrape_runs').update({ status: 'failed', finished_at: new Date().toISOString(), failed: 3, error_summary: message.slice(0, 1000) }).eq('id', run.id);
    return Response.json({ error: message }, { status: 500 });
  }
}
