import { supabaseAdmin } from '@/lib/supabase';
import { getPepestoCreditsCents, PEPESTO_BATCH_SIZE, PEPESTO_SEARCH_COST_CENTS, retrievePepestoSearch, selectPepestoTescoProducts, submitPepestoSearch, extractPepestoItems, choosePepestoCandidate } from '@/lib/pepesto-tesco';
import type { TescoQueueProduct } from '@/lib/tesco-queue-worker';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const RUN_ID = 'pepesto_tesco_canary_v2_20260821';
const LIMIT = 20;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const mode = new URL(request.url).searchParams.get('mode') || 'submit';

  if (mode === 'submit') {
    const existing = await supabaseAdmin.from('scrape_runs').select('id,status').eq('run_id', RUN_ID).maybeSingle();
    if (existing.data?.id) return Response.json({ status: 'already_exists', run_uuid: existing.data.id, run_status: existing.data.status });

    const products = await selectPepestoTescoProducts(LIMIT);
    if (products.length !== LIMIT) return Response.json({ error: `Expected ${LIMIT} products, got ${products.length}` }, { status: 500 });

    const needed = Math.ceil(products.length / PEPESTO_BATCH_SIZE) * PEPESTO_SEARCH_COST_CENTS;
    if (needed !== 64) return Response.json({ error: `Unexpected canary cost ${needed}` }, { status: 500 });
    const credits = await getPepestoCreditsCents();
    if (credits < needed) return Response.json({ error: 'Insufficient Pepesto credits', credits_cents: credits, needed_cents: needed }, { status: 402 });

    const { data: run, error: runError } = await supabaseAdmin.from('scrape_runs').insert({
      run_id: RUN_ID,
      store: 'tesco',
      retrieval_method: 'pepesto_search_canary_v2',
      started_at: new Date().toISOString(),
      status: 'running',
      target_count: products.length,
      threshold_pct: 70,
      attempted_count: 0,
      fetched: 0,
      extracted: 0,
      inserted: 0,
      unchanged_count: 0,
      failed: 0,
      silently_skipped_count: 0,
      threshold_breached: false,
      scrapingbee_requests: 0,
      scrapingbee_credits: 0,
      error_summary: JSON.stringify({ dry_run: true, phase: 'submitted', credits_before_cents: credits })
    }).select('id').single();
    if (runError || !run?.id) return Response.json({ error: runError?.message || 'Failed to create run' }, { status: 500 });

    const sessions: string[] = [];
    for (let i = 0; i < products.length; i += PEPESTO_BATCH_SIZE) {
      const batch = products.slice(i, i + PEPESTO_BATCH_SIZE);
      const sid = await submitPepestoSearch(batch);
      const { error } = await supabaseAdmin.from('pepesto_tesco_sessions').insert({
        run_uuid: run.id,
        search_session_id: sid,
        batch_index: i / PEPESTO_BATCH_SIZE,
        products: batch,
        status: 'submitted'
      });
      if (error) throw new Error(error.message);
      sessions.push(sid);
    }
    return Response.json({ status: 'submitted', run_id: RUN_ID, sessions, cost_cents: needed, credits_before_cents: credits });
  }

  if (mode === 'retrieve') {
    const { data: run } = await supabaseAdmin.from('scrape_runs').select('id,status,target_count').eq('run_id', RUN_ID).maybeSingle();
    if (!run?.id) return Response.json({ error: 'Canary run not found' }, { status: 404 });
    const { data: sessions, error } = await supabaseAdmin.from('pepesto_tesco_sessions').select('id,search_session_id,products,status').eq('run_uuid', run.id).order('batch_index');
    if (error) return Response.json({ error: error.message }, { status: 500 });

    let pending = 0, matched = 0, failed = 0, candidates = 0, promotions = 0;
    for (const session of sessions ?? []) {
      const payload = await retrievePepestoSearch(session.search_session_id);
      const state = String(payload?.status || payload?.state || '').toLowerCase();
      if (state && !['done','complete','completed'].includes(state)) {
        pending++;
        await supabaseAdmin.from('pepesto_tesco_sessions').update({ status: 'in_progress', result_summary: { state, dry_run: true } }).eq('id', session.id);
        continue;
      }
      const products = (session.products || []) as TescoQueueProduct[];
      const items = extractPepestoItems(payload);
      let sessionMatched = 0, sessionFailed = 0, sessionCandidates = 0, sessionPromotions = 0;
      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        const target = String(product.storeProductName || product.canonicalName).toLowerCase();
        const exact = items.find((x: any) => String(x?.item_name || '').toLowerCase() === target);
        const item: any = exact || items[i] || {};
        const list = item.candidates || item.products || item.results || [];
        sessionCandidates += Array.isArray(list) ? list.length : 0;
        const candidate: any = choosePepestoCandidate(product, item);
        if (candidate) {
          sessionMatched++;
          const promo = candidate?.price?.promotion?.promo ?? candidate?.promotion?.promo ?? candidate?.promo;
          if (promo === true) sessionPromotions++;
        } else {
          sessionFailed++;
        }
      }
      matched += sessionMatched; failed += sessionFailed; candidates += sessionCandidates; promotions += sessionPromotions;
      await supabaseAdmin.from('pepesto_tesco_sessions').update({ status: 'done', retrieved_at: new Date().toISOString(), result_summary: { dry_run: true, matched: sessionMatched, failed: sessionFailed, candidates: sessionCandidates, promotions: sessionPromotions } }).eq('id', session.id);
    }

    if (pending === 0) {
      const coverage = Number(((matched / LIMIT) * 100).toFixed(2));
      await supabaseAdmin.from('scrape_runs').update({
        status: coverage >= 70 ? 'success' : coverage >= 35 ? 'degraded' : 'failed',
        finished_at: new Date().toISOString(),
        attempted_count: LIMIT,
        fetched: candidates,
        extracted: matched,
        failed,
        coverage_pct: coverage,
        threshold_breached: coverage < 70,
        error_summary: JSON.stringify({ dry_run: true, matched, failed, total_candidates: candidates, promotions, coverage_pct: coverage })
      }).eq('id', run.id);
      return Response.json({ status: 'complete', matched, failed, candidates, promotions, coverage_pct: coverage, dry_run: true });
    }
    return Response.json({ status: 'pending', pending, matched, failed, candidates, promotions, dry_run: true });
  }

  return Response.json({ error: 'Invalid mode' }, { status: 400 });
}
