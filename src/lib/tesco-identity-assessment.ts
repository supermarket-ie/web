// Independent AI identity assessment for Tesco mappings (unattended collection).
//
// This is a SECOND, independent opinion that sits BESIDE the deterministic
// identity gate (independentExactIdentity / classifyTesco*). It never replaces
// or overrides that gate. Its only job is to produce an evidence-backed verdict
// — verified_exact | rejected | uncertain — with the supporting facts and a
// rationale, so that:
//
//   • an acceptance requires BOTH the model AND the deterministic gate to agree
//     (model confidence alone can NEVER authorise acceptance);
//   • model `rejected`/`uncertain` always routes the product to HOLD, even if
//     the deterministic gate would have passed (fail-closed on disagreement);
//   • the model can NEVER turn a deterministic rejection into an acceptance.
//
// Candidate DISCOVERY (finding a replacement URL/SKU) is a separate concern
// (tesco-evidence-repair / repair selectors). This module only VERIFIES a
// concrete (canonical, live Tesco product, peers) triple that discovery
// proposed. Tesco identity is kept separate from cross-retailer equivalence:
// peers are used only to corroborate the Tesco item's identity, never to assert
// a Dunnes/SuperValu price comparison.

import { z } from 'zod';
import type { LanguageModel } from 'ai';
import { generateObject } from 'ai';
import type { TescoCollectedProduct } from './tesco-direct-collection-core';
import {
  independentExactIdentity,
  sameBrand,
  sameBarcode,
  declaredPack,
  canonicalVariantConflict,
  type ReentryEvidence,
  type MachineAssessment,
} from './tesco-hold-reentry';
import { resolveAgentModel } from './agent/model';

export type AssessmentDecision = 'verified_exact' | 'rejected' | 'uncertain';

// The structured facts the model must extract and commit to. These are the
// attributes the deterministic gate also checks; the model must agree on each,
// citing what it saw, so a verdict is auditable rather than a bare confidence.
export const assessmentFactsSchema = z.object({
  sku_matches: z.boolean(),
  brand_matches: z.boolean(),
  barcode_matches: z.enum(['match', 'conflict', 'unavailable']),
  product_type_matches: z.boolean(),
  flavour_formulation_matches: z.boolean(),
  quantity_matches: z.boolean(),
  pack_count_matches: z.boolean(),
  selling_unit_matches: z.boolean(),
});
export type AssessmentFacts = z.infer<typeof assessmentFactsSchema>;

export const assessmentSchema = z.object({
  decision: z.enum(['verified_exact', 'rejected', 'uncertain']),
  facts: assessmentFactsSchema,
  rationale: z.string().min(30).max(1000),
});
export type IdentityAssessment = z.infer<typeof assessmentSchema> & {
  model: string;
  // The deterministic gate's independent verdict, recorded alongside so the
  // final (combined) decision is fully explainable.
  deterministic_exact: boolean;
};

const MODEL_ID = () => process.env.AGENT_MODEL_ID ?? 'eu.anthropic.claude-sonnet-4-6';

// Deterministic, self-evident facts we can hand the model so it reasons over
// the SAME evidence the code gate uses (it must still justify its verdict).
function evidenceSummary(e: ReentryEvidence, live: TescoCollectedProduct) {
  const m = e.mapping;
  const canonicalPack = declaredPack(m.canonical_name);
  const livePack = declaredPack(live.name);
  return {
    canonical: {
      name: m.canonical_name,
      brand: m.canonical_brand,
      ean: m.canonical_ean,
      declared_total: canonicalPack.total,
      declared_units: canonicalPack.units,
    },
    tesco_live: {
      sku: live.sku,
      name: live.name,
      brand: live.brand,
      gtin: live.gtin,
      quantity: live.quantity,
      declared_total: livePack.total,
      declared_units: livePack.units,
      available: live.available,
      currency: live.currency,
    },
    // Peers corroborate Tesco identity only; never a price comparison claim.
    peers: e.peers.map((p) => ({ store: p.store, name: p.store_product_name, brand: p.brand, gtin: p.gtin })),
    // Deterministic pre-checks surfaced to the model as hints (not authority).
    deterministic_hints: {
      brand_agrees: m.canonical_brand == null || (live.brand != null && sameBrand(m.canonical_brand, live.brand)),
      barcode_agrees: m.canonical_ean == null ? 'unavailable' : sameBarcode(m.canonical_ean, live.gtin) ? 'match' : 'conflict',
      variant_conflict: canonicalVariantConflict(m.canonical_name, live.name),
    },
  };
}

const SYSTEM_PROMPT = [
  'You are an independent grocery product-identity verifier for Tesco Ireland.',
  'You are given a CANONICAL product identity and a freshly fetched live TESCO product, plus optional peer products at other retailers.',
  'Decide whether the live Tesco product is EXACTLY the same product as the canonical identity.',
  'Compare: SKU, brand, barcode (EAN/GTIN) where available, product type, flavour/formulation, net quantity, pack count, and selling unit.',
  'A single material difference (wrong flavour, different net weight, different pack count, different brand, barcode conflict, different product type) means it is NOT exact.',
  'An equal total weight achieved with a different pack layout (e.g. 2x125g vs 1x250g) is NOT exact — the pack count differs.',
  'Peers may only corroborate the Tesco identity; never treat a peer as proof of an exact cross-retailer price comparison.',
  'Return verified_exact ONLY when every material attribute agrees on the evidence. Return rejected on any material conflict. Return uncertain when the evidence is incomplete or ambiguous.',
  'Cite the facts you actually observed. Never guess to fill a gap; prefer uncertain over an unsupported verified_exact.',
].join(' ');

export type AssessOptions = {
  model?: LanguageModel;
  // Injectable runner for deterministic tests (bypasses the real model call).
  runModel?: (args: { system: string; prompt: string }) => Promise<z.infer<typeof assessmentSchema>>;
};

/**
 * Run the independent AI assessment over a concrete (canonical, live, peers)
 * triple. Returns the model's structured verdict plus the deterministic gate's
 * independent result. This function performs NO writes and NO network fetch to
 * Tesco — it reasons over already-captured evidence.
 */
export async function assessTescoIdentity(
  evidence: ReentryEvidence,
  live: TescoCollectedProduct,
  options: AssessOptions = {},
): Promise<IdentityAssessment> {
  const summary = evidenceSummary(evidence, live);
  const prompt = 'Evidence:\n' + JSON.stringify(summary, null, 2) +
    '\n\nReturn your structured verdict. Base it only on the evidence above.';

  let raw: z.infer<typeof assessmentSchema>;
  if (options.runModel) {
    raw = assessmentSchema.parse(await options.runModel({ system: SYSTEM_PROMPT, prompt }));
  } else {
    const model = options.model ?? resolveAgentModel();
    const { object } = await generateObject({
      model,
      schema: assessmentSchema,
      system: SYSTEM_PROMPT,
      prompt,
      temperature: 0,
    });
    raw = object;
  }

  // The deterministic gate's OWN independent verdict over the same evidence
  // (and the live page). This is authoritative; the model is advisory.
  const deterministicExact = independentExactIdentity(evidence, live);

  return { ...raw, model: MODEL_ID(), deterministic_exact: deterministicExact };
}

export type CombinedVerdict = {
  // The final, enforceable decision after combining both opinions.
  decision: AssessmentDecision;
  assessment: IdentityAssessment;
  // Present ONLY when decision === 'verified_exact' (both opinions agree): a
  // MachineAssessment suitable for the existing approval/finalisation path.
  machineAssessment: MachineAssessment | null;
  holdReason: string | null;
};

/**
 * Combine the AI assessment with the deterministic gate under the safety
 * invariants. The result is the ONLY thing collection should act on.
 *
 *   verified_exact  ⇔  model says verified_exact  AND  deterministic gate passes
 *   otherwise       →  hold (rejected or uncertain), NEVER a write
 *
 * A MachineAssessment (decision 'verified_exact') is emitted only in the first
 * case. It still has to clear `approvedReview` + `independentExactIdentity`
 * downstream, so this is defence-in-depth, not a bypass.
 */
export function combineIdentityVerdict(
  evidence: ReentryEvidence,
  live: TescoCollectedProduct,
  assessment: IdentityAssessment,
  sourcePageId: string,
  modelReason?: string,
): CombinedVerdict {
  const modelExact = assessment.decision === 'verified_exact';
  const deterministicExact = assessment.deterministic_exact;

  if (modelExact && deterministicExact) {
    const reason = (modelReason ?? assessment.rationale).trim();
    const machineAssessment: MachineAssessment = {
      decision: 'verified_exact',
      model: assessment.model,
      source: 'independent_ai_identity_assessment',
      reason: reason.length >= 30 ? reason : `${reason} (independent AI + deterministic identity gate agreed on all material attributes)`,
      mapping_id: evidence.mapping.id,
      source_page_id: sourcePageId,
      source_body_sha256: evidence.page.body_sha256,
      validation: { independently_exact: true, checks: factChecks(assessment.facts) },
    };
    return { decision: 'verified_exact', assessment, machineAssessment, holdReason: null };
  }

  // Disagreement or any non-exact verdict → hold. Describe why, for the audit.
  let holdReason: string;
  if (!modelExact && !deterministicExact) {
    holdReason = `both independent AI (${assessment.decision}) and deterministic gate rejected the identity`;
  } else if (!deterministicExact) {
    holdReason = `deterministic identity gate did not confirm exact identity (AI said ${assessment.decision})`;
  } else {
    holdReason = `independent AI assessment was ${assessment.decision} despite a deterministic pass — held pending review`;
  }
  return {
    decision: assessment.decision === 'rejected' ? 'rejected' : 'uncertain',
    assessment,
    machineAssessment: null,
    holdReason,
  };
}

function factChecks(facts: AssessmentFacts): string[] {
  const checks: string[] = [];
  if (facts.sku_matches) checks.push('sku');
  if (facts.brand_matches) checks.push('brand');
  if (facts.barcode_matches === 'match') checks.push('barcode');
  if (facts.product_type_matches) checks.push('product_type');
  if (facts.flavour_formulation_matches) checks.push('flavour_formulation');
  if (facts.quantity_matches) checks.push('quantity');
  if (facts.pack_count_matches) checks.push('pack_count');
  if (facts.selling_unit_matches) checks.push('selling_unit');
  return checks;
}

/**
 * Convenience: assess then combine in one call. Returns the enforceable
 * CombinedVerdict. No writes, no Tesco fetch.
 */
export async function assessAndCombine(
  evidence: ReentryEvidence,
  live: TescoCollectedProduct,
  sourcePageId: string,
  options: AssessOptions = {},
): Promise<CombinedVerdict> {
  const assessment = await assessTescoIdentity(evidence, live, options);
  return combineIdentityVerdict(evidence, live, assessment, sourcePageId);
}
