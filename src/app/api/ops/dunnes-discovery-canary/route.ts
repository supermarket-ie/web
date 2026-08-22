import { createHash, timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { discoverDunnesProduct } from '@/lib/dunnes-discovery';

const TOKEN_HASH = '095a26423e44b12e813e8b42072531af616243363fac63dacdd5a90ba63a76d4';

function validToken(token: string | null) {
  if (!token) return false;
  const actual = createHash('sha256').update(token).digest();
  const expected = Buffer.from(TOKEN_HASH, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!validToken(url.searchParams.get('token'))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const requestedLimit = Number(url.searchParams.get('limit') ?? '30');
  const requestedOffset = Number(url.searchParams.get('offset') ?? '0');
  const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 30, 50));
  const offset = Math.max(0, Number.isFinite(requestedOffset) ? Math.floor(requestedOffset) : 0);

  const { data: targets, error } = await supabaseAdmin.rpc('select_dunnes_discovery_targets', {
    p_limit: limit,
    p_offset: offset,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const results = [] as Array<Record<string, unknown>>;
  for (const target of targets ?? []) {
    const discovery = await discoverDunnesProduct(target.canonical_name, target.brand);
    results.push({
      product_id: target.product_id,
      canonical_name: target.canonical_name,
      brand: target.brand,
      category: target.category,
      usage_quantity: target.usage_quantity,
      usage_occurrences: target.usage_occurrences,
      last_used_at: target.last_used_at,
      accepted: discovery.accepted,
      best: discovery.best,
      query_variants: discovery.queryVariants,
      candidate_count: discovery.candidates.length,
    });
  }

  const acceptedCount = results.filter(result => result.accepted === true).length;
  const runId = `dunnes_discovery_canary_${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
  const now = new Date().toISOString();
  const { error: insertError } = await supabaseAdmin.from('scrape_runs').insert({
    run_id: runId,
    store: 'dunnes',
    started_at: now,
    finished_at: now,
    target_count: results.length,
    attempted_count: results.length,
    fetched: results.reduce((sum, result) => sum + ((result.query_variants as string[])?.length ?? 0), 0),
    extracted: acceptedCount,
    inserted: 0,
    unchanged_count: 0,
    failed: results.length - acceptedCount,
    coverage_pct: results.length ? (acceptedCount / results.length) * 100 : 0,
    retrieval_method: 'dunnes_discovery_canary_dry_run',
    threshold_pct: 0,
    status: 'success',
    error_summary: JSON.stringify(results.map(result => ({
      product_id: result.product_id,
      canonical_name: result.canonical_name,
      brand: result.brand,
      category: result.category,
      usage_quantity: result.usage_quantity,
      usage_occurrences: result.usage_occurrences,
      accepted: result.accepted,
      best: result.best,
      candidate_count: result.candidate_count,
    }))),
  });

  if (insertError) {
    return Response.json({ error: insertError.message, dry_run: true, results }, { status: 500 });
  }

  return Response.json({
    dry_run: true,
    run_id: runId,
    target_count: results.length,
    accepted_count: acceptedCount,
    offset,
    results,
  });
}
