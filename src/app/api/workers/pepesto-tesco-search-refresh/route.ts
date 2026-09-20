import { getPepestoCreditsCents, submitPepestoSearch } from '@/lib/pepesto-tesco';
import { selectProvenPepestoTescoProducts } from '@/lib/tesco-proven-refresh';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(request.url);
  if (url.searchParams.get('confirm') !== 'tesco-search-refresh') {
    return Response.json({ error: 'Explicit tesco-search-refresh confirmation is required' }, { status: 400 });
  }

  const requested = Number(url.searchParams.get('limit') || 10);
  const limit = Math.max(1, Math.min(Number.isFinite(requested) ? Math.floor(requested) : 10, 50));
  const requestedCap = Number(url.searchParams.get('max_cost_cents') || 120);
  const maxCostCents = Math.max(1, Math.min(Number.isFinite(requestedCap) ? Math.floor(requestedCap) : 120, 2000));
  const products = await selectProvenPepestoTescoProducts(limit);
  if (!products.length) return Response.json({ status: 'no_products', submitted: 0 });

  const runId = `pepesto_tesco_search_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const { data: run, error: runError } = await supabaseAdmin.from('scrape_runs').insert({
    run_id: runId,
    store: 'tesco',
    retrieval_method: 'pepesto_search',
    run_scope: 'manual',
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
  }).select('id').single();
  if (runError || !run?.id) return Response.json({ error: `Failed opening search refresh: ${runError?.message || 'missing id'}` }, { status: 500 });

  const creditsBefore = await getPepestoCreditsCents();
  let creditsAfter = creditsBefore;
  let actualCost = 0;
  let submitted = 0;
  try {
    for (const [batchIndex, product] of products.entries()) {
      if (actualCost >= maxCostCents) throw new Error('Tesco search refresh spend cap reached during submission');
      const sessionCreditsBefore = creditsAfter;
      const searchSessionId = await submitPepestoSearch([product]);
      creditsAfter = await getPepestoCreditsCents();
      actualCost += Math.max(0, sessionCreditsBefore - creditsAfter);
      const { error } = await supabaseAdmin.from('pepesto_tesco_sessions').insert({
        run_uuid: String(run.id),
        search_session_id: searchSessionId,
        batch_index: batchIndex,
        products: [product],
        status: 'submitted',
      });
      if (error) throw new Error(error.message);
      submitted += 1;
      await supabaseAdmin.from('scrape_runs').update({
        pepesto_credits_before_cents: creditsBefore,
        pepesto_credits_after_cents: creditsAfter,
        pepesto_actual_cost_cents: actualCost,
      }).eq('id', run.id);
    }
    return Response.json({
      status: 'submitted',
      route: 'pepesto_search',
      strategy: 'one_product_per_search_session',
      run_id: runId,
      run_uuid: String(run.id),
      target_count: products.length,
      submitted,
      credits_before_cents: creditsBefore,
      credits_after_cents: creditsAfter,
      actual_cost_cents: actualCost,
      max_cost_cents: maxCostCents,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabaseAdmin.from('scrape_runs').update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      error_summary: message.slice(0, 500),
      pepesto_credits_before_cents: creditsBefore,
      pepesto_credits_after_cents: creditsAfter,
      pepesto_actual_cost_cents: actualCost,
    }).eq('id', run.id);
    return Response.json({ error: message, submitted, actual_cost_cents: actualCost }, { status: 500 });
  }
}
