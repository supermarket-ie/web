import { selectEveCapabilities, type EveCapability } from '../../../agent/lib/instruction-routing';

export const BEHAVIOURAL_DIMENSIONS = [
  'intent', 'clarification', 'guest_turns', 'household_coherence',
  'planning_period', 'category_coverage', 'quantities', 'dietary',
  'product_resolution', 'price_truth', 'promotion_truth', 'store_coverage',
  'totals', 'retailer_split', 'persistence_cta', 'handoff_truth',
] as const;

export type BehaviouralDimension = typeof BEHAVIOURAL_DIMENSIONS[number];
export type EvaluationStatus = 'pass' | 'fail' | 'review' | 'not_applicable';

export type BehaviouralItem = {
  name: string;
  category: string;
  quantity: number;
  dietary_compatible?: boolean;
  resolved?: boolean;
  price?: number;
  price_source?: 'latest_prices';
  retailer?: string;
  promotion?: { retailer_marked: boolean; was_price: number | null; claimed_saving: boolean };
};

export type BehaviouralFixture = {
  id: string;
  prompt: string;
  expected_capabilities: EveCapability[];
  critical_dimensions: BehaviouralDimension[];
  expected: {
    clarification: 'required' | 'not_required' | 'optional';
    max_guest_turns?: number;
    planning_days?: number;
    budget?: number;
    required_categories?: string[];
    dietary?: string[];
    persistence?: 'proposal' | 'saved_shop' | 'watch';
    cta?: 'clarify' | 'review' | 'save' | 'sign_in' | 'none';
  };
  captured: {
    clarification_asked: boolean;
    outcome_turn: number;
    household?: { adults: number; children: number };
    planning_days?: number;
    items: BehaviouralItem[];
    reported_total?: number;
    store_coverage?: string[];
    persistence: 'none' | 'proposal' | 'saved_shop' | 'watch';
    cta: 'clarify' | 'review' | 'save' | 'sign_in' | 'none';
    handoff_claim: 'none' | 'product_links' | 'populated_trolley' | 'checkout_complete';
    handoff_proven?: boolean;
  };
};

export type DimensionResult = { dimension: BehaviouralDimension; status: EvaluationStatus; detail: string };

const money = (value: number) => Number(value.toFixed(2));

export function evaluateBehaviouralFixture(fixture: BehaviouralFixture): DimensionResult[] {
  const capabilities = selectEveCapabilities(fixture.prompt);
  const items = fixture.captured.items;
  const itemTotal = money(items.reduce((sum, item) => sum + (item.price ?? 0) * item.quantity, 0));
  const result = new Map<BehaviouralDimension, DimensionResult>();
  const record = (dimension: BehaviouralDimension, status: EvaluationStatus, detail: string) => result.set(dimension, { dimension, status, detail });

  record('intent', fixture.expected_capabilities.every(value => capabilities.includes(value)) ? 'pass' : 'fail', `selected: ${capabilities.join(', ')}`);
  const clarificationMatches = fixture.expected.clarification === 'optional'
    || fixture.captured.clarification_asked === (fixture.expected.clarification === 'required');
  record('clarification', clarificationMatches ? 'pass' : 'fail', fixture.captured.clarification_asked ? 'asked' : 'not asked');
  record('guest_turns', fixture.expected.max_guest_turns == null || fixture.captured.outcome_turn <= fixture.expected.max_guest_turns ? 'pass' : 'fail', `outcome turn ${fixture.captured.outcome_turn}`);
  record('household_coherence', fixture.captured.household ? 'review' : 'not_applicable', fixture.captured.household ? `${fixture.captured.household.adults} adults, ${fixture.captured.household.children} children` : 'no household outcome');
  record('planning_period', fixture.expected.planning_days == null ? 'not_applicable' : fixture.captured.planning_days === fixture.expected.planning_days ? 'pass' : 'fail', `${fixture.captured.planning_days ?? 'none'} days`);
  const categories = new Set(items.map(item => item.category.toLowerCase()));
  const missingCategories = (fixture.expected.required_categories ?? []).filter(category => !categories.has(category.toLowerCase()));
  record('category_coverage', fixture.expected.required_categories == null ? 'not_applicable' : missingCategories.length ? 'fail' : 'pass', missingCategories.length ? `missing: ${missingCategories.join(', ')}` : 'required categories covered');
  record('quantities', items.length ? (items.every(item => Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 50) ? 'review' : 'fail') : 'not_applicable', 'positive bounded quantities');
  record('dietary', fixture.expected.dietary == null ? 'not_applicable' : items.every(item => item.dietary_compatible === true) ? 'pass' : 'fail', fixture.expected.dietary?.join(', ') ?? 'no dietary constraint');
  record('product_resolution', items.length ? (items.every(item => item.resolved !== false) ? 'pass' : 'fail') : 'not_applicable', 'canonical resolution');
  const priced = items.filter(item => item.price != null);
  record('price_truth', priced.length ? (priced.every(item => item.price_source === 'latest_prices' && Number(item.price) > 0) ? 'pass' : 'fail') : 'not_applicable', `${priced.length} priced lines`);
  const promotions = items.filter(item => item.promotion);
  record('promotion_truth', promotions.length ? (promotions.every(item => !item.promotion!.claimed_saving || (item.promotion!.retailer_marked && item.promotion!.was_price != null && item.promotion!.was_price > Number(item.price))) ? 'pass' : 'fail') : 'not_applicable', `${promotions.length} promotion claims`);
  record('store_coverage', fixture.captured.store_coverage ? (fixture.captured.store_coverage.length >= 3 ? 'pass' : 'fail') : 'not_applicable', fixture.captured.store_coverage?.join(', ') ?? 'not compared');
  record('totals', fixture.captured.reported_total == null ? 'not_applicable' : fixture.captured.reported_total === itemTotal ? 'pass' : 'fail', `reported ${fixture.captured.reported_total ?? 'none'}, calculated ${itemTotal}`);
  record('retailer_split', new Set(items.map(item => item.retailer).filter(Boolean)).size > 1 ? 'review' : 'not_applicable', 'subjective split quality');
  const persistenceOk = fixture.expected.persistence == null || fixture.captured.persistence === fixture.expected.persistence;
  const ctaOk = fixture.expected.cta == null || fixture.captured.cta === fixture.expected.cta;
  record('persistence_cta', persistenceOk && ctaOk ? 'pass' : 'fail', `${fixture.captured.persistence} / ${fixture.captured.cta}`);
  const unsupported = ['populated_trolley', 'checkout_complete'].includes(fixture.captured.handoff_claim) && !fixture.captured.handoff_proven;
  record('handoff_truth', unsupported ? 'fail' : 'pass', fixture.captured.handoff_claim);

  return BEHAVIOURAL_DIMENSIONS.map(dimension => result.get(dimension)!);
}

export function criticalFailures(fixture: BehaviouralFixture) {
  const critical = new Set(fixture.critical_dimensions);
  return evaluateBehaviouralFixture(fixture).filter(result => critical.has(result.dimension) && result.status === 'fail');
}

export function evaluationCoverage(fixtures: BehaviouralFixture[]) {
  return Object.fromEntries(BEHAVIOURAL_DIMENSIONS.map(dimension => [dimension, fixtures.filter(fixture => evaluateBehaviouralFixture(fixture).find(result => result.dimension === dimension)?.status !== 'not_applicable').length]));
}
