import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const RUN_ID = 'pepesto_tesco_eval_20260820_v2';
const PEPESTO_CATALOG = 'https://s.pepesto.com/api/catalog';

function norm(value: string | null | undefined) {
  return (value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}
function tokens(value: string) { return new Set(norm(value).split(' ').filter((x) => x.length > 1)); }
function tokenScore(a: string, b: string) {
  const aa = tokens(a), bb = tokens(b); if (!aa.size || !bb.size) return 0;
  let i = 0; for (const t of aa) if (bb.has(t)) i++; return (2 * i) / (aa.size + bb.size);
}
function productName(p: any) { return p?.names?.en || p?.name || p?.product_name || p?.entity_name || ''; }

async function loadAllTescoMappings() {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from('store_products')
      .select('id,store_product_name,brand,store_url,store_sku,gtin,product_id,products(canonical_name,category)')
      .eq('store', 'tesco').range(from, from + 999);
    if (error) throw new Error(`Tesco mappings load failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export async function GET() {
  const { data: existing } = await supabaseAdmin.from('scrape_runs').select('id,status').eq('run_id', RUN_ID).maybeSingle();
  if (existing) return NextResponse.json({ ok: true, already_ran: true, status: existing.status });

  const { data: run, error: insertError } = await supabaseAdmin.from('scrape_runs').insert({
    store: 'tesco', run_id: RUN_ID, started_at: new Date().toISOString(), target_count: 2460,
    attempted_count: 0, fetched: 0, extracted: 0, inserted: 0, failed: 0,
    retrieval_method: 'pepesto_catalog_evaluation', status: 'running'
  }).select('id').single();
  if (insertError || !run) return NextResponse.json({ error: insertError?.message || 'run insert failed' }, { status: 500 });

  try {
    const { data: key, error: keyError } = await supabaseAdmin.rpc('get_pepesto_api_key');
    if (keyError || typeof key !== 'string' || !key) throw new Error('Pepesto key unavailable');

    const response = await fetch(PEPESTO_CATALOG, {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ supermarket_domain: 'tesco.ie' }), cache: 'no-store'
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Pepesto catalog failed (${response.status}): ${text.slice(0,160)}`);
    const json = JSON.parse(text);
    const rawProducts = json?.products ?? json;
    const pepestoProducts: any[] = Array.isArray(rawProducts)
      ? rawProducts
      : (rawProducts && typeof rawProducts === 'object'
          ? Object.entries(rawProducts).map(([url, p]: any) => ({ url, ...(p || {}) }))
          : []);

    const ours = await loadAllTescoMappings();
    const byUrl = new Map<string, any>();
    const byExact = new Map<string, any[]>();
    for (const p of pepestoProducts) {
      const url = String(p.url || p.product_url || p.web_url || p.id || '');
      if (url) byUrl.set(url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), p);
      const n = norm(productName(p)); if (n) byExact.set(n, [...(byExact.get(n) || []), p]);
    }

    let urlMatches = 0, exactNameMatches = 0, fuzzyMatches = 0;
    const matchedPepesto = new Set<any>();
    const unmatchedByCategory: Record<string, number> = {}, matchedByCategory: Record<string, number> = {};
    const samples: any[] = [];

    for (const o of ours) {
      const ourName = o.store_product_name || o.products?.canonical_name || '';
      const cat = o.products?.category || 'Uncategorised';
      let match: any = null, method = '';
      const ourUrl = String(o.store_url || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
      if (ourUrl && byUrl.has(ourUrl)) { match = byUrl.get(ourUrl); method = 'url'; urlMatches++; }
      if (!match) { const exact = byExact.get(norm(ourName)); if (exact?.length) { match = exact[0]; method = 'exact_name'; exactNameMatches++; } }
      if (!match && ourName) {
        let best: any = null, bestScore = 0;
        for (const p of pepestoProducts) { const score = tokenScore(ourName, productName(p)); if (score > bestScore) { bestScore = score; best = p; } }
        if (best && bestScore >= 0.82) { match = best; method = 'fuzzy'; fuzzyMatches++; }
      }
      if (match) {
        matchedPepesto.add(match); matchedByCategory[cat] = (matchedByCategory[cat] || 0) + 1;
        if (samples.length < 15) samples.push({ ours: ourName, pepesto: productName(match), method, price_cents: match.price ?? null, quantity: match.quantity_str ?? null });
      } else unmatchedByCategory[cat] = (unmatchedByCategory[cat] || 0) + 1;
    }

    const matched = urlMatches + exactNameMatches + fuzzyMatches, total = ours.length;
    const coveragePct = total ? Number(((matched / total) * 100).toFixed(2)) : 0;
    const metrics = { pepesto_catalog_count: pepestoProducts.length, our_tesco_mappings: total, matched, coverage_pct: coveragePct,
      url_matches: urlMatches, exact_name_matches: exactNameMatches, fuzzy_matches: fuzzyMatches,
      unique_pepesto_products_matched: matchedPepesto.size, matched_by_category: matchedByCategory,
      unmatched_by_category: unmatchedByCategory, samples };

    await supabaseAdmin.from('scrape_runs').update({
      finished_at: new Date().toISOString(), attempted_count: total, fetched: pepestoProducts.length,
      extracted: matched, unchanged_count: matched, failed: total - matched, coverage_pct: coveragePct,
      status: 'evaluation_complete', error_summary: JSON.stringify(metrics)
    }).eq('id', run.id);
    console.log('[pepesto-tesco-evaluation-v2]', metrics);
    return NextResponse.json({ ok: true, ...metrics });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabaseAdmin.from('scrape_runs').update({ finished_at: new Date().toISOString(), status: 'failed', error_summary: message }).eq('id', run.id);
    console.error('[pepesto-tesco-evaluation-v2] failed', message);
    return NextResponse.json({ error: 'evaluation failed', detail: message }, { status: 500 });
  }
}
