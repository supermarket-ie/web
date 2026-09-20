import { supabaseAdmin } from '@/lib/supabase';
import { choosePepestoCatalogCandidate, createPepestoRun, finalizePepestoProduct, getPepestoCreditsCents, retrievePepestoCatalog } from '@/lib/pepesto-tesco';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CATALOG_BATCH_SIZE = 50;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}

function requestedLimit(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 250) : 50;
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const limit = requestedLimit(new URL(request.url).searchParams.get('limit'));
  const dailyCap = Math.min(Math.max(Number(process.env.PEPESTO_TESCO_DAILY_CAP_CENTS || 1000), 1), 10000);
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { data: costRows, error: costError } = await supabaseAdmin.from('scrape_runs').select('pepesto_actual_cost_cents').eq('store', 'tesco').gte('started_at', since.toISOString());
  if (costError) return Response.json({ error: `Unable to verify today's Pepesto spend: ${costError.message}` }, { status: 500 });
  const spent = (costRows ?? []).reduce((sum, row) => sum + Number(row.pepesto_actual_cost_cents || 0), 0);
  if (spent >= dailyCap) return Response.json({ error: 'Daily Pepesto spend cap reached', spent_cents: spent, cap_cents: dailyCap }, { status: 429 });

  const creditsBefore = await getPepestoCreditsCents();
  if (creditsBefore <= 0) return Response.json({ error: 'No Pepesto credits available', credits_before_cents: creditsBefore }, { status: 402 });
  // The shared selector's legacy productUrlOnly filter recognises `/product/`
  // URLs, while Tesco Ireland uses `/products/`. Select resolved SKU mappings
  // normally and enforce complete URLs below before making a paid request.
  const run = await createPepestoRun(limit, undefined, { retrievalMethod: 'pepesto_catalog_preselected' });
  if (!run) return Response.json({ status: 'no_products', attempted: 0 });

  await supabaseAdmin.from('scrape_runs').update({ pepesto_credits_before_cents: creditsBefore }).eq('id', run.runUuid);

  let creditsAfter = creditsBefore;
  let actualCost = 0;
  let matched = 0;
  let failed = 0;
  const observedBatchCosts: number[] = [];

  try {
    for (let index = 0; index < run.products.length; index += CATALOG_BATCH_SIZE) {
      const products = run.products.slice(index, index + CATALOG_BATCH_SIZE);
      const urls = products.map(product => product.storeUrl).filter((value): value is string => Boolean(value));
      if (urls.length !== products.length) throw new Error('Pepesto preselected catalog requires a URL for every product');

      const batchCreditsBefore = creditsAfter;
      const candidates = await retrievePepestoCatalog(urls);
      creditsAfter = await getPepestoCreditsCents();
      const batchCost = Math.max(0, batchCreditsBefore - creditsAfter);
      actualCost += batchCost;
      observedBatchCosts.push(batchCost);

      for (const product of products) {
        const candidate = choosePepestoCatalogCandidate(product, candidates);
        const accepted = await finalizePepestoProduct(run.runUuid, product, candidate);
        if (accepted) matched += 1;
        else failed += 1;
      }

      await supabaseAdmin.from('scrape_runs').update({ pepesto_credits_after_cents: creditsAfter, pepesto_actual_cost_cents: actualCost }).eq('id', run.runUuid);
      if (spent + actualCost >= dailyCap && index + CATALOG_BATCH_SIZE < run.products.length) throw new Error('Daily Pepesto spend cap reached before all catalog batches completed');
    }

    return Response.json({ status: 'complete', run_id: run.runId, run_uuid: run.runUuid, target: run.products.length, attempted: matched + failed, matched, failed, coverage_pct: Number(((matched / run.products.length) * 100).toFixed(2)), credits_before_cents: creditsBefore, credits_after_cents: creditsAfter, actual_cost_cents: actualCost, observed_batch_costs_cents: observedBatchCosts });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabaseAdmin.from('scrape_runs').update({ status: 'failed', finished_at: new Date().toISOString(), error_summary: message.slice(0, 500), pepesto_credits_before_cents: creditsBefore, pepesto_credits_after_cents: creditsAfter, pepesto_actual_cost_cents: actualCost }).eq('id', run.runUuid);
    return Response.json({ error: message, attempted: matched + failed, matched, failed, credits_before_cents: creditsBefore, credits_after_cents: creditsAfter, actual_cost_cents: actualCost }, { status: 500 });
  }
}
