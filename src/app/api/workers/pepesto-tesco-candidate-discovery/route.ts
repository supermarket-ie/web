import { createTescoCandidateDiscoveryRun, selectAuditedTescoDiscoveryProducts } from '@/lib/tesco-candidate-discovery';
import { getPepestoCreditsCents, submitPepestoSearch } from '@/lib/pepesto-tesco';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(request.url);
  if (url.searchParams.get('confirm') !== 'exact-candidate-canary') {
    return Response.json({ error: 'Explicit exact-candidate-canary confirmation is required' }, { status: 400 });
  }
  const requested = Number(url.searchParams.get('limit') || 3);
  const limit = Math.max(1, Math.min(Number.isFinite(requested) ? Math.floor(requested) : 3, 5));
  const canaryCap = Math.max(1, Math.min(Number(process.env.PEPESTO_TESCO_DISCOVERY_CAP_CENTS || 60), 100));
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { data: costRows, error: costError } = await supabaseAdmin.from('scrape_runs')
    .select('pepesto_actual_cost_cents').eq('store', 'tesco')
    .eq('retrieval_method', 'pepesto_candidate_discovery').gte('started_at', since.toISOString());
  if (costError) return Response.json({ error: `Unable to verify today's Pepesto spend: ${costError.message}` }, { status: 500 });
  if ((costRows ?? []).length > 0) {
    return Response.json({ status: 'already_run_today', submitted: 0 });
  }
  const spentToday = (costRows ?? []).reduce((sum, row) => sum + Number(row.pepesto_actual_cost_cents || 0), 0);
  if (spentToday >= canaryCap) {
    return Response.json({ error: 'Tesco discovery canary spend cap reached', spent_cents: spentToday, cap_cents: canaryCap }, { status: 429 });
  }

  const products = await selectAuditedTescoDiscoveryProducts(limit);
  const run = await createTescoCandidateDiscoveryRun(products);
  if (!run) return Response.json({ status: 'no_products', submitted: 0 });
  const creditsBefore = await getPepestoCreditsCents();
  let creditsAfter = creditsBefore;
  let actualCost = 0;
  let submitted = 0;
  try {
    for (const [batchIndex, product] of run.products.entries()) {
      if (spentToday + actualCost >= canaryCap) throw new Error('Tesco discovery canary spend cap reached during submission');
      const sessionCreditsBefore = creditsAfter;
      // One product per search session is deliberate: every returned candidate
      // can be attributed to one canonical identity without positional guesses.
      const searchSessionId = await submitPepestoSearch([product]);
      creditsAfter = await getPepestoCreditsCents();
      actualCost += Math.max(0, sessionCreditsBefore - creditsAfter);
      const { error } = await supabaseAdmin.from('pepesto_tesco_sessions').insert({
        run_uuid: run.runUuid,
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
      }).eq('id', run.runUuid);
    }
    return Response.json({
      status: 'submitted',
      strategy: 'single_canonical_query_all_candidates_persisted',
      run_id: run.runId,
      run_uuid: run.runUuid,
      target_count: run.products.length,
      submitted,
      credits_before_cents: creditsBefore,
      credits_after_cents: creditsAfter,
      actual_cost_cents: actualCost,
      canary_cap_cents: canaryCap,
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
    }).eq('id', run.runUuid);
    return Response.json({ error: message, submitted, actual_cost_cents: actualCost }, { status: 500 });
  }
}
