import { supabaseAdmin } from '@/lib/supabase';
import { discoverDunnesProduct, dunnesPackRatio } from '@/lib/dunnes-discovery';

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get('authorization') === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || !authorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const requestedLimit = Number(url.searchParams.get('limit') ?? '30');
  const requestedOffset = Number(url.searchParams.get('offset') ?? '0');
  const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 30, 50));
  const offset = Math.max(0, Number.isFinite(requestedOffset) ? Math.floor(requestedOffset) : 0);

  const { data: targets, error } = await supabaseAdmin.rpc('select_dunnes_discovery_targets', {
    p_limit: limit,
    p_offset: offset,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const targetIds = (targets ?? []).map(target => target.product_id).filter(Boolean);
  if (targetIds.length) {
    const { error: supersedeError } = await supabaseAdmin
      .from('store_product_alternative_candidates')
      .update({
        status: 'rejected',
        reason: 'Superseded by a newer Dunnes alternative revalidation.',
        updated_at: new Date().toISOString(),
      })
      .eq('store', 'dunnes')
      .in('product_id', targetIds)
      .eq('status', 'candidate');

    if (supersedeError) {
      return Response.json({ error: `Failed superseding prior Dunnes candidates: ${supersedeError.message}` }, { status: 500 });
    }
  }

  const exactMatches: Array<Record<string, unknown>> = [];
  const alternativeCandidates: Array<Record<string, unknown>> = [];

  for (const target of targets ?? []) {
    const discovery = await discoverDunnesProduct(target.canonical_name, target.brand);
    if (discovery.accepted && discovery.best) {
      exactMatches.push({ product_id: target.product_id, canonical_name: target.canonical_name, best: discovery.best });
      continue;
    }

    const alt = discovery.candidates.find(candidate =>
      Boolean(candidate.sku && candidate.price && candidate.price > 0)
      && candidate.brandMatch
      && candidate.productSignalMatch
      && !candidate.variantConflict
      && !candidate.packMatch
      && candidate.score >= 0.80
    );

    if (!alt?.sku) continue;

    const packRatio = dunnesPackRatio(target.canonical_name, alt.name);
    const reason = `Same branded product family with different pack identity: ${target.canonical_name} -> ${alt.name}`;
    const { error: upsertError } = await supabaseAdmin
      .from('store_product_alternative_candidates')
      .upsert({
        product_id: target.product_id,
        store: 'dunnes',
        candidate_store_sku: alt.sku,
        candidate_store_product_name: alt.name,
        candidate_store_url: alt.url,
        relationship_type: 'same_product_different_pack',
        confidence_score: alt.score,
        observed_price: alt.price,
        pack_ratio: packRatio,
        source: 'dunnes_direct_discovery',
        status: 'candidate',
        reason,
        last_seen_at: new Date().toISOString(),
      }, { onConflict: 'product_id,store,candidate_store_sku' });

    if (upsertError) throw new Error(`Failed staging Dunnes alternative candidate: ${upsertError.message}`);
    alternativeCandidates.push({
      product_id: target.product_id,
      canonical_name: target.canonical_name,
      usage_quantity: target.usage_quantity,
      usage_occurrences: target.usage_occurrences,
      pack_ratio: packRatio,
      candidate: alt,
    });
  }

  const runId = `dunnes_alternative_canary_${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
  const now = new Date().toISOString();
  await supabaseAdmin.from('scrape_runs').insert({
    run_id: runId,
    store: 'dunnes',
    started_at: now,
    finished_at: now,
    target_count: (targets ?? []).length,
    attempted_count: (targets ?? []).length,
    fetched: (targets ?? []).length,
    extracted: alternativeCandidates.length,
    inserted: alternativeCandidates.length,
    unchanged_count: 0,
    failed: Math.max(0, (targets ?? []).length - exactMatches.length - alternativeCandidates.length),
    coverage_pct: (targets ?? []).length ? ((exactMatches.length + alternativeCandidates.length) / (targets ?? []).length) * 100 : 0,
    retrieval_method: 'dunnes_alternative_candidate_canary',
    threshold_pct: 0,
    status: 'success',
    error_summary: JSON.stringify({ exact_matches: exactMatches, alternative_candidates: alternativeCandidates }),
  });

  return Response.json({
    run_id: runId,
    target_count: (targets ?? []).length,
    exact_match_count: exactMatches.length,
    alternative_candidate_count: alternativeCandidates.length,
    exact_matches: exactMatches,
    alternative_candidates: alternativeCandidates,
  });
}
