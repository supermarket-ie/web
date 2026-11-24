// AI-assisted resolution of REVIEW-tier barcode matches (owner authorised, 24 Nov 2026; policy barcode-review-ai-v1).
//
// A review-tier match is a retailer whose OWN storefront search returned exactly one SKU for the Tesco GTIN, but whose
// title words differ from Tesco's ("Sun-Ripened" vs "Sundried", extra descriptive words). The barcode alone NEVER
// equates two products. An association is accepted only when ALL of these hold:
//   1. barcode: a fresh governed search for the GTIN returns exactly ONE item, and it is this SKU;
//   2. SKU-bound evidence: the retailer's product-by-SKU response passes every STRUCTURAL check of the existing
//      confirmation (SKU, URL, brand, structured pack = the Tesco pack, own-label, ownership, price, multipack) and the
//      ONLY failures are missing title words (`title_words_missing:*`);
//   3. deterministic blockers: no missing word is a number, a flavour / formulation / variant / age-stage / size word,
//      unless the retailer's own SKU-bound description or ingredients state it;
//   4. AI corroboration: an independent model returns verified_exact AND its structured facts agree on every material
//      attribute (brand, product type, flavour/formulation, variant, net quantity, pack count, age stage).
// Anything else holds. Pure apart from the injected model.
import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import { resolveAgentModel } from './agent/model';

export const REVIEW_POLICY_VERSION = 'barcode-review-ai-v1';

// Words that change WHICH product it is when stated on only one side. Missing from the retailer title -> hold, unless
// the retailer's own product description/ingredients state them.
const MATERIAL_WORDS = new Set([
  // flavours / varieties
  'strawberry', 'raspberry', 'blueberry', 'cherry', 'vanilla', 'chocolate', 'caramel', 'toffee', 'mint', 'orange', 'lemon', 'lime',
  'apple', 'banana', 'mango', 'peach', 'pineapple', 'coconut', 'hazelnut', 'almond', 'peanut', 'honey', 'cinnamon', 'ginger',
  'cheese', 'cheddar', 'onion', 'garlic', 'chilli', 'chili', 'pepper', 'tomato', 'bbq', 'barbecue', 'chicken', 'beef', 'pork', 'ham',
  'bacon', 'prawn', 'salt', 'salted', 'vinegar', 'sweet', 'sour', 'spicy', 'hot', 'mild', 'smoked', 'smoky', 'herb', 'basil', 'curry', 'mushroom',
  'cranberry', 'berry', 'berries', 'fruit', 'fruits', 'nut', 'nuts', 'seed', 'seeds', 'butter', 'cream', 'yogurt', 'mayo', 'sriracha', 'jalapeno',
  // formulation / variant
  'light', 'lite', 'low', 'reduced', 'free', 'zero', 'diet', 'decaf', 'organic', 'original', 'classic', 'extra', 'max', 'plus', 'gold', 'full',
  'sugar', 'fat', 'lactose', 'gluten', 'vegan', 'vegetarian', 'wholemeal', 'whole', 'semi', 'skimmed', 'white', 'brown', 'dark',
  'unsalted', 'unsweetened', 'sensitive', 'protein', 'fibre', 'fiber', 'caffeine', 'sparkling', 'still', 'concentrate', 'squash',
  'bio', 'non', 'scented', 'unscented', 'fragrance', 'fresh', 'frozen', 'chilled', 'instant', 'ground', 'beans', 'pods', 'capsules',
  // age stage / size
  'stage', 'month', 'months', 'year', 'years', 'junior', 'toddler', 'infant', 'newborn', 'baby', 'kids', 'size', 'mini', 'large',
  'small', 'medium', 'jumbo', 'family', 'sharing', 'single', 'double', 'triple',
]);

export type ReviewInput = {
  confirmationReasons: string[];       // confirmDunnesSku(...).reasons (or the equivalent SuperValu check)
  barcodeSearch: { gtin: string; skus: string[] };   // fresh governed search for the GTIN (all forms)
  sku: string;
  retailerText: string;                // the retailer's own SKU-bound description + ingredients (plain text)
  tescoName: string;                   // Tesco's own title (the barcode origin)
  retailerName: string;                // the retailer's SKU-bound title
};
export type ReviewPrecheck = { eligible: boolean; reasons: string[]; missing: string[] };

const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

/** Deterministic part (1-3). Eligible only when every check passes; never accepts on its own. */
export function reviewPrecheck(i: ReviewInput): ReviewPrecheck {
  const reasons: string[] = [];
  const skus = [...new Set(i.barcodeSearch.skus.filter(Boolean))];
  if (skus.length !== 1 || skus[0] !== i.sku) reasons.push(skus.length === 0 ? 'barcode_not_found' : skus.length > 1 ? 'barcode_ambiguous' : 'barcode_other_sku');
  const nonWording = i.confirmationReasons.filter(r => !r.startsWith('title_words_missing:'));
  if (nonWording.length) reasons.push(...nonWording.map(r => `structural:${r}`));
  const missing = i.confirmationReasons.filter(r => r.startsWith('title_words_missing:'))
    .flatMap(r => r.slice('title_words_missing:'.length).split('+')).map(w => w.trim().toLowerCase()).filter(Boolean);
  const stated = new Set(plain(i.retailerText).split(' '));
  for (const w of missing) {
    const singular = w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w;
    if (stated.has(w) || stated.has(singular)) continue;   // the retailer's own product data states it
    if (/\d/.test(w)) reasons.push(`numeric_word_missing:${w}`);
    else if (MATERIAL_WORDS.has(w) || MATERIAL_WORDS.has(singular)) reasons.push(`material_word_missing:${w}`);
  }
  // The other direction: a material word in the RETAILER title that Tesco's title does not state ("Fajita Kit" vs
  // "Fajita Kit Smoky BBQ", "Coconut Milk" vs "Full ... Coconut Milk") holds -- Tesco offers no description to confirm it.
  const tescoWords = new Set(plain(i.tescoName).split(' ').flatMap(w => [w, w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w]));
  for (const w of new Set(plain(i.retailerName).split(' '))) {
    const singular = w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w;
    if (!w || tescoWords.has(w) || tescoWords.has(singular)) continue;
    if (MATERIAL_WORDS.has(w) || MATERIAL_WORDS.has(singular)) reasons.push(`material_word_extra:${w}`);
  }
  return { eligible: reasons.length === 0, reasons, missing };
}

export const reviewAssessmentSchema = z.object({
  decision: z.enum(['verified_exact', 'rejected', 'uncertain']),
  facts: z.object({
    brand_matches: z.boolean(),
    product_type_matches: z.boolean(),
    flavour_formulation_matches: z.boolean(),
    variant_matches: z.boolean(),
    quantity_matches: z.boolean(),
    pack_count_matches: z.boolean(),
    age_stage_matches: z.boolean(),
  }),
  rationale: z.string().min(20).max(1200),
});
export type ReviewAssessment = z.infer<typeof reviewAssessmentSchema>;

const SYSTEM = [
  'You verify whether two grocery listings at different retailers are EXACTLY the same product.',
  'You get the Tesco product (name, brand, barcode, net quantity) and the other retailer\'s product data fetched by its own SKU (name, brand, structured size, description, ingredients).',
  'The other retailer\'s search for the Tesco barcode returned this SKU. Treat that as a lead only: a shared barcode is NOT proof.',
  'Wording differences that describe the same product are fine (word order, "&" vs "and", a retailer omitting a marketing phrase that its description confirms).',
  'Any material difference means NOT exact: a different brand, product type, flavour, scent, variety, formulation (e.g. sugar free vs regular, light vs full fat), net quantity, pack count, age stage or size.',
  'If a distinguishing word on one side (e.g. a flavour or scent) is neither stated nor clearly implied by the other side\'s name, description or ingredients, answer uncertain.',
  'Return verified_exact ONLY when every material attribute is positively supported. Prefer uncertain over a guess.',
].join(' ');

export type ReviewEvidence = {
  tesco: { name: string; brand: string; gtin: string; quantity: string | null };
  retailer: { store: 'dunnes' | 'supervalu'; sku: string; name: string; brand: string | null; size: string | null; description: string; ingredients: string };
};

export async function assessReviewIdentity(e: ReviewEvidence, opts: {
  model?: LanguageModel; runModel?: (a: { system: string; prompt: string }) => Promise<unknown>;
} = {}): Promise<ReviewAssessment> {
  const prompt = `Evidence:\n${JSON.stringify({ ...e, retailer: { ...e.retailer, description: plain(e.retailer.description).slice(0, 1500), ingredients: plain(e.retailer.ingredients).slice(0, 800) } }, null, 2)}\n\nReturn your structured verdict.`;
  if (opts.runModel) return reviewAssessmentSchema.parse(await opts.runModel({ system: SYSTEM, prompt }));
  const { object } = await generateObject({ model: opts.model ?? resolveAgentModel(), schema: reviewAssessmentSchema, system: SYSTEM, prompt, temperature: 0 });
  return object;
}

/** Final decision: deterministic precheck AND a self-consistent verified_exact verdict. */
export function decideReview(pre: ReviewPrecheck, a: ReviewAssessment | null): { accept: boolean; reasons: string[] } {
  if (!pre.eligible) return { accept: false, reasons: pre.reasons };
  if (!a) return { accept: false, reasons: ['ai_unavailable'] };
  const f = a.facts;
  const failed = Object.entries(f).filter(([, v]) => v !== true).map(([k]) => `ai_fact:${k}`);
  if (a.decision !== 'verified_exact') return { accept: false, reasons: [`ai_${a.decision}`, ...failed] };
  if (failed.length) return { accept: false, reasons: ['ai_self_contradictory', ...failed] };
  return { accept: true, reasons: [] };
}
