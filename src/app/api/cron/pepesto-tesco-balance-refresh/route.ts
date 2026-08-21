import { supabaseAdmin } from '@/lib/supabase';
import {
  choosePepestoCandidate,
  createPepestoRun,
  extractPepestoItems,
  finalizePepestoProduct,
  getPepestoCreditsCents,
  PEPESTO_BATCH_SIZE,
  PEPESTO_SEARCH_COST_CENTS,
  retrievePepestoSearch,
  submitPepestoSearch,
} from '@/lib/pepesto-tesco';
import type { TescoQueueProduct } from '@/lib/tesco-queue-worker';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}

async function submitBalanceRun() {
  const { count: pendingCount, error: pendingError } = await supabaseAdmin
    .from('pepesto_tesco_sessions')
    .select('id', { count: 'exact', head: true })
    .in('status', ['submitted', 'in_progress']);
  if (pendingError) throw new Error(pendingError.message);
  if ((pendingCount || 0) > 0) {
    return { status: 'waiting_for_existing_sessions', pending_sessions: pendingCount };
  }

  const credits = await getPepestoCreditsCents();
  // Keep one request (€0.32) in reserve so a balance race cannot overdraw the account.
  const affordableBatches = Math.max(0, Math.min(90, Math.floor(credits / PEPESTO_SEARCH_COST_CENTS) - 1));
  if (affordableBatches < 1) return { status: 'insufficient_balance', credits_cents: credits };

  const run = await createPepestoRun(affordableBatches * PEPESTO_BATCH_SIZE);
  if (!run) return { status: 'no_products', credits_cents: credits };

  const actualBatches = Math.ceil(run.products.length / PEPESTO_BATCH_SIZE);
  let submittedProducts = 0;
  const sessionIds: string[] = [];
  try {
    for (let i = 0; i < run.products.length; i += PEPESTO_BATCH_SIZE) {
      const products = run.products.slice(i, i + PEPESTO_BATCH_SIZE);
      const sid = await submitPepestoSearch(products);
      const { error } = await supabaseAdmin.from('pepesto_tesco_sessions').insert({
        run_uuid: run.runUuid,
        search_session_id: sid,
        batch_index: i / PEPESTO_BATCH_SIZE,
        products,
        status: 'submitted',
      });
      if (error) throw new Error(error.message);
      submittedProducts += products.length;
      sessionIds.push(sid);
    }
    await supabaseAdmin.from('scrape_runs').update({
      retrieval_method: 'pepesto_balance_refresh',
      error_summary: JSON.stringify({
        credits_before_cents: credits,
        submitted_products: submittedProducts,
        submitted_batches: actualBatches,
        estimated_cost_cents: actualBatches * PEPESTO_SEARCH_COST_CENTS,
      }),
    }).eq('id', run.runUuid);
    return {
      status: 'submitted',
      run_id: run.runId,
      target: run.products.length,
      submitted_products: submittedProducts,
      submitted_batches: actualBatches,
      estimated_cost_cents: actualBatches * PEPESTO_SEARCH_COST_CENTS,
      credits_before_cents: credits,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabaseAdmin.from('scrape_runs').update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      error_summary: message.slice(0, 500),
    }).eq('id', run.runUuid);
    throw error;
  }
}

async function retrieveBalanceRun() {
  const { data: sessions, error } = await supabaseAdmin
    .from('pepesto_tesco_sessions')
    .select('id,run_uuid,search_session_id,products,status,submitted_at')
    .in('status', ['submitted', 'in_progress'])
    .order('submitted_at', { ascending: true })
    .limit(20);
  if (error) throw new Error(error.message);

  let completed = 0;
  let pending = 0;
  let matched = 0;
  let failed = 0;
  let promotions = 0;

  for (const session of sessions || []) {
    try {
      const payload = await retrievePepestoSearch(session.search_session_id);
      const state = String(payload?.status || payload?.state || '').toLowerCase();
      if (state && !['done', 'complete', 'completed'].includes(state)) {
        await supabaseAdmin.from('pepesto_tesco_sessions').update({
          status: 'in_progress',
          result_summary: { state },
          last_error: null,
        }).eq('id', session.id);
        pending++;
        continue;
      }

      const products = (session.products || []) as TescoQueueProduct[];
      const items = extractPepestoItems(payload);
      let batchMatched = 0;
      let batchFailed = 0;
      let batchPromotions = 0;

      for (let i = 0; i < products.length; i++) {
        const product = products[i];
        const target = String(product.storeProductName || product.canonicalName).toLowerCase();
        const exact = items.find((item: any) => String(item?.item_name || '').toLowerCase() === target);
        const item = exact || items[i] || {};
        const candidate: any = choosePepestoCandidate(product, item);
        if (candidate?.price?.promotion?.promo === true || candidate?.promotion?.promo === true || candidate?.on_promotion === true) {
          batchPromotions++;
          promotions++;
        }
        const ok = await finalizePepestoProduct(session.run_uuid, product, candidate);
        if (ok) { matched++; batchMatched++; } else { failed++; batchFailed++; }
      }

      await supabaseAdmin.from('pepesto_tesco_sessions').update({
        status: 'done',
        retrieved_at: new Date().toISOString(),
        result_summary: { items: items.length, matched: batchMatched, failed: batchFailed, promotions: batchPromotions },
        last_error: null,
      }).eq('id', session.id);
      completed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const ageMs = Date.now() - new Date(session.submitted_at).getTime();
      await supabaseAdmin.from('pepesto_tesco_sessions').update({
        status: ageMs > 2 * 60 * 60 * 1000 ? 'failed' : 'in_progress',
        retrieved_at: ageMs > 2 * 60 * 60 * 1000 ? new Date().toISOString() : null,
        last_error: message.slice(0, 500),
      }).eq('id', session.id);
      if (ageMs > 2 * 60 * 60 * 1000) failed++; else pending++;
    }
  }

  const credits = await getPepestoCreditsCents();
  return { status: 'ok', sessions_checked: (sessions || []).length, completed, pending, matched, failed, promotions, credits_cents: credits };
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const mode = new URL(request.url).searchParams.get('mode') || 'retrieve';
  try {
    const result = mode === 'submit' ? await submitBalanceRun() : await retrieveBalanceRun();
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
