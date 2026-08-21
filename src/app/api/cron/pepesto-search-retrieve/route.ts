import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const RUN_ID = 'pepesto_tesco_search_eval_20260821_v3';
const BASE = 'https://s.pepesto.com/api';

async function post(key: string, path: string, body: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body), cache: 'no-store',
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${path} failed (${r.status}): ${text.slice(0,240)}`);
  return JSON.parse(text);
}

function summariseItem(item: any) {
  const products = Array.isArray(item?.products) ? item.products : [];
  return {
    item_name: item?.item_name ?? '',
    candidate_count: products.length,
    top: products.slice(0, 3).map((entry: any) => {
      const p = entry?.product ?? entry ?? {};
      return {
        product_name: p?.product_name ?? '',
        price_cents: p?.price?.price ?? null,
        promo: p?.price?.promotion?.promo ?? false,
        product_id: p?.product_id ?? null,
        category: p?.category ?? null,
      };
    }),
  };
}

export async function GET() {
  const { data: run, error: runError } = await supabaseAdmin.from('scrape_runs')
    .select('id,status,error_summary,target_count').eq('run_id', RUN_ID).maybeSingle();
  if (runError || !run) return NextResponse.json({ error: runError?.message || 'search run not found' }, { status: 404 });

  try {
    const prior = JSON.parse(run.error_summary || '{}');
    const sessions = Array.isArray(prior?.sessions) ? prior.sessions : [];
    if (!sessions.length) throw new Error('No Pepesto search sessions stored');

    const { data: key, error: keyError } = await supabaseAdmin.rpc('get_pepesto_api_key');
    if (keyError || typeof key !== 'string' || !key) throw new Error(`Pepesto key unavailable${keyError ? `: ${keyError.message}` : ''}`);

    const results: any[] = [];
    let allDone = true;
    let foundItems = 0;
    let foundCandidates = 0;

    for (const session of sessions) {
      const response = await post(key, '/retrieve', { search_session_id: session.sid });
      const status = response?.status ?? 'unknown';
      if (status !== 'done') allDone = false;
      const items = Array.isArray(response?.items) ? response.items.map(summariseItem) : [];
      foundItems += items.filter((i: any) => i.candidate_count > 0).length;
      foundCandidates += items.reduce((n: number, i: any) => n + i.candidate_count, 0);
      results.push({ sid: session.sid, status, currency: response?.currency ?? null, items });
    }

    const summary = {
      phase: allDone ? 'complete' : 'awaiting_search_results',
      credits_before_search_cents: prior?.credits_before_search_cents ?? null,
      sessions,
      retrieval: results,
      requested_items: Number(run.target_count || 20),
      items_with_candidates: foundItems,
      total_candidates: foundCandidates,
    };

    await supabaseAdmin.from('scrape_runs').update({
      status: allDone ? 'success' : 'running',
      finished_at: allDone ? new Date().toISOString() : null,
      fetched: foundCandidates,
      extracted: foundItems,
      failed: allDone ? Math.max(0, Number(run.target_count || 20) - foundItems) : 0,
      coverage_pct: allDone ? Number(((foundItems / Number(run.target_count || 20)) * 100).toFixed(2)) : null,
      error_summary: JSON.stringify(summary),
    }).eq('id', run.id);

    return NextResponse.json({ ok: true, all_done: allDone, items_with_candidates: foundItems, total_candidates: foundCandidates, results });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[pepesto-search-retrieve] failed', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
