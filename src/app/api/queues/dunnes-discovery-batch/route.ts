import { handleCallback } from '@vercel/queue';
import { supabaseAdmin } from '@/lib/supabase';
import { discoverDunnesProduct, dunnesPackRatio } from '@/lib/dunnes-discovery';

type Target = {
  product_id: string;
  canonical_name: string;
  brand: string;
  usage_quantity?: number | null;
  usage_occurrences?: number | null;
};

type Message = {
  runUuid: string;
  runId: string;
  batchIndex: number;
  totalBatches: number;
  targets: Target[];
};

async function finalize(message: Message, target: Target, outcome: 'exact' | 'alternative' | 'rejected', candidate?: {
  sku: string | null;
  name: string;
  url: string | null;
  price: number | null;
  score: number;
}, packRatio?: number | null, reason?: string | null) {
  const { error } = await supabaseAdmin.rpc('finalize_dunnes_discovery_product', {
    p_run_uuid: message.runUuid,
    p_product_id: target.product_id,
    p_outcome: outcome,
    p_canonical_name: target.canonical_name,
    p_candidate_sku: candidate?.sku ?? null,
    p_candidate_name: candidate?.name ?? null,
    p_candidate_url: candidate?.url ?? null,
    p_price: candidate?.price ?? null,
    p_confidence: candidate?.score ?? null,
    p_pack_ratio: packRatio ?? null,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(`Dunnes discovery finalization failed: ${error.message}`);
}

export const POST = handleCallback<Message>(async (message) => {
  if (!message?.runUuid || !Array.isArray(message.targets) || message.targets.length === 0) {
    throw new Error('Invalid Dunnes discovery queue message');
  }

  for (const target of message.targets) {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('dunnes_discovery_receipts')
      .select('id')
      .eq('run_id', message.runUuid)
      .eq('product_id', target.product_id)
      .maybeSingle();
    if (existingError) throw new Error(`Failed checking Dunnes discovery receipt: ${existingError.message}`);
    if (existing) continue;

    const discovery = await discoverDunnesProduct(target.canonical_name, target.brand);
    if (discovery.accepted && discovery.best) {
      await finalize(
        message,
        target,
        'exact',
        discovery.best,
        1,
        `Exact Dunnes discovery match: ${target.canonical_name} -> ${discovery.best.name}`,
      );
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

    if (alt?.sku) {
      const ratio = dunnesPackRatio(target.canonical_name, alt.name);
      await finalize(
        message,
        target,
        'alternative',
        alt,
        ratio,
        `Same branded product family with different pack identity: ${target.canonical_name} -> ${alt.name}`,
      );
      continue;
    }

    await finalize(message, target, 'rejected', undefined, null, 'No sufficiently confident exact or different-pack Dunnes match.');
  }

  console.log('[dunnes-discovery-queue] batch complete', {
    runId: message.runId,
    batchIndex: message.batchIndex,
    totalBatches: message.totalBatches,
    products: message.targets.length,
  });
}, {
  visibilityTimeoutSeconds: 300,
  retry: (_error, metadata) => ({
    afterSeconds: Math.min(180, Math.max(10, 10 * 2 ** Math.max(0, metadata.deliveryCount - 1))),
  }),
});
