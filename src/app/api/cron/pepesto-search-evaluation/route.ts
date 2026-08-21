import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const RUN_ID = 'pepesto_tesco_search_eval_20260821_v3';
const BASE = 'https://s.pepesto.com/api';
const PRODUCTS = [
  'Tesco Non Bio Laundry Gel','Fairy Washing Up Liquid','Domestos Bleach','Andrex Toilet Tissue','Head & Shoulders Shampoo',
  'Colgate Total Toothpaste','Nivea Shower Gel','Gillette Shaving Gel','Pampers Baby Dry Nappies','WaterWipes Baby Wipes',
  'Aptamil First Infant Milk','Johnson’s Baby Shampoo','Pedigree Dog Food','Whiskas Cat Food','Felix Cat Food',
  'Finish Dishwasher Tablets','Flash Cleaning Spray','Comfort Fabric Conditioner','Dove Deodorant','Tesco Kitchen Foil'
];

async function post(key: string, path: string, body: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${path} failed (${r.status}): ${text.slice(0, 240)}`);
  try { return JSON.parse(text); } catch { throw new Error(`${path} returned non-JSON: ${text.slice(0, 240)}`); }
}

export async function GET() {
  const { data: existing } = await supabaseAdmin.from('scrape_runs').select('id,status').eq('run_id', RUN_ID).maybeSingle();
  if (existing) return NextResponse.json({ ok: true, already_ran: true, status: existing.status });

  const { data: run, error: insertError } = await supabaseAdmin.from('scrape_runs').insert({
    store: 'tesco', run_id: RUN_ID, started_at: new Date().toISOString(), target_count: PRODUCTS.length,
    attempted_count: 0, fetched: 0, extracted: 0, inserted: 0, failed: 0,
    retrieval_method: 'pepesto_search_evaluation', status: 'running', error_summary: JSON.stringify({ phase: 'preflight' })
  }).select('id').single();
  if (insertError || !run) {
    console.error('[pepesto-search-evaluation] run insert failed', insertError?.message);
    return NextResponse.json({ error: insertError?.message || 'run insert failed' }, { status: 500 });
  }

  try {
    const { data: key, error: keyError } = await supabaseAdmin.rpc('get_pepesto_api_key');
    if (keyError) throw new Error(`key RPC failed: ${keyError.message}`);
    if (typeof key !== 'string' || !key) throw new Error('Pepesto key unavailable');

    const credits = await post(key, '/credits', {});
    const cents = typeof credits?.euro_cents === 'number' ? credits.euro_cents :
      typeof credits?.credits_remaining === 'number' ? credits.credits_remaining : null;
    if (cents === null) throw new Error(`Unrecognised credits response keys: ${Object.keys(credits || {}).join(',')}`);
    if (cents < 64) throw new Error(`Insufficient Pepesto credits (${cents} cents)`);

    const sessions: any[] = [];
    for (let i = 0; i < PRODUCTS.length; i += 10) {
      const batch = PRODUCTS.slice(i, i + 10);
      const result = await post(key, '/search', { products: batch, supermarket_domain: 'tesco.ie' });
      const sid = result?.search_session_id ?? result?.session_id ?? result?.id ?? null;
      sessions.push({ sid, products: batch, response_keys: Object.keys(result || {}).slice(0, 20) });
    }

    await supabaseAdmin.from('scrape_runs').update({
      attempted_count: PRODUCTS.length,
      error_summary: JSON.stringify({ phase: 'awaiting_search_results', credits_before_search_cents: cents, sessions })
    }).eq('id', run.id);

    return NextResponse.json({ ok: true, submitted: PRODUCTS.length, credits_before_search_cents: cents, sessions: sessions.map(s => s.sid) });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabaseAdmin.from('scrape_runs').update({ status: 'failed', finished_at: new Date().toISOString(), error_summary: message }).eq('id', run.id);
    console.error('[pepesto-search-evaluation] failed', message);
    return NextResponse.json({ error: 'Pepesto search evaluation failed', detail: message }, { status: 500 });
  }
}
