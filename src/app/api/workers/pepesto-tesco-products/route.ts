import { supabaseAdmin } from '@/lib/supabase';
import { choosePepestoCandidateFromItems, createPepestoRun, extractPepestoItems, finalizePepestoProduct, getPepestoCreditsCents, retrievePepestoProducts } from '@/lib/pepesto-tesco';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const BATCH_SIZE = 50;

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
  const run = await createPepestoRun(limit, undefined, { retrievalMethod: 'pepesto_products_preferred' });
  if (!run) return Response.json({ status: 'no_products', attempted: 0 });

  await supabaseAdmin.from('scrape_runs').update({ pepesto_credits_before_cents: creditsBefore }).eq('id', run.runUuid);
  let creditsAfter = creditsBefore;
  let actualCost = 0;
  let matched = 0;
  let failed = 0;
  let itemsReturned = 0;
  const observedBatchCosts: number[] = [];

  try {
    for (let index = 0; index < run.products.length; index += BATCH_SIZE) {
      const products = run.products.slice(index, index + BATCH_SIZE);
      const batchCreditsBefore = creditsAfter;
      const payload = await retrievePepestoProducts(products);
      creditsAfter = await getPepestoCreditsCents();
      const batchCost = Math.max(0, batchCreditsBefore - creditsAfter);
      actualCost += batchCost;
      observedBatchCosts.push(batchCost);

      const items = extractPepestoItems(payload);
      itemsReturned += items.length;
      for (const product of products) {
        // Pepesto may omit unresolved items or reorder results. Identity comes
        // from the exact retailer SKU, so scan the complete batch response
        // instead of relying on array position or rewritten item names.
        const candidate = choosePepestoCandidateFromItems(product, items);
        const accepted = await finalizePepestoProduct(run.runUuid, product, candidate);
        if (accepted) matched += 1;
        else failed += 1;
      }

      await supabaseAdmin.from('scrape_runs').update({ pepesto_credits_after_cents: creditsAfter, pepesto_actual_cost_cents: actualCost }).eq('id', run.runUuid);
      if (spent + actualCost >= dailyCap && index + BATCH_SIZE < run.products.length) throw new Error('Daily Pepesto spend cap reached before all products batches completed');
    }

    return Response.json({ status: 'complete', run_id: run.runId, run_uuid: run.runUuid, target: run.products.length, attempted: matched + failed, items_returned: itemsReturned, matched, failed, coverage_pct: Number(((matched / run.products.length) * 100).toFixed(2)), credits_before_cents: creditsBefore, credits_after_cents: creditsAfter, actual_cost_cents: actualCost, observed_batch_costs_cents: observedBatchCosts });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabaseAdmin.from('scrape_runs').update({ status: 'failed', finished_at: new Date().toISOString(), error_summary: message.slice(0, 500), pepesto_credits_before_cents: creditsBefore, pepesto_credits_after_cents: creditsAfter, pepesto_actual_cost_cents: actualCost }).eq('id', run.runUuid);
    return Response.json({ error: message, attempted: matched + failed, matched, failed, credits_before_cents: creditsBefore, credits_after_cents: creditsAfter, actual_cost_cents: actualCost }, { status: 500 });
  }
}
