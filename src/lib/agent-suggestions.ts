export type SuggestionIntent = 'find' | 'price' | 'offer' | 'compare' | 'meal' | 'budget' | 'general';

export type CatalogueSuggestionProduct = {
  name: string;
  category: string | null;
  best_price: number | null;
  best_store: string | null;
  on_promotion: boolean;
};

export type PredictiveSuggestion = {
  label: string;
  detail: string;
  prompt: string;
};

const INTENT_WORDS = new Set([
  'a', 'all', 'an', 'any', 'are', 'at', 'best', 'buy', 'can', 'cheaper', 'compare',
  'cost', 'current', 'do', 'find', 'for', 'get', 'have', 'how', 'i', 'in', 'is',
  'it', 'latest', 'me', 'much', 'near', 'of', 'on', 'offer', 'offers', 'price',
  'prices', 'product', 'products', 'sale', 'show', 'supermarket', 'the', 'this',
  'to', 'what', 'where', 'which', 'with', 'worth', 'you',
]);

export function normaliseSuggestionText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9€£]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function inferSuggestionIntent(input: string): SuggestionIntent {
  const query = normaliseSuggestionText(input);
  if (/\b(dinner|meal|cook|make|recipe|lunch|breakfast|ingredient|vegetarian|vegan)\b/.test(query)) return 'meal';
  if (/€|£|\b(budget|spend|under|less than|shop for|family of|adults?|people)\b/.test(query)) return 'budget';
  if (/\b(compare|versus|vs|difference|which store|cheapest)\b/.test(query)) return 'compare';
  if (/\b(offer|offers|promotion|promotions|sale|reduced|deal)\b/.test(query)) return 'offer';
  if (/\b(price|cost|how much)\b/.test(query)) return 'price';
  if (/\b(find|where|stock|available|buy|get)\b/.test(query)) return 'find';
  return 'general';
}

export function extractCatalogueFragment(input: string): string {
  const tokens = normaliseSuggestionText(input)
    .split(' ')
    .filter(token => token.length >= 2 && !INTENT_WORDS.has(token) && !/^\d+$/.test(token));
  return tokens.slice(-3).join(' ');
}

function euro(value: number | null): string | null {
  return value == null ? null : `€${value.toFixed(2)}`;
}

function productSuggestions(product: CatalogueSuggestionProduct, intent: SuggestionIntent): PredictiveSuggestion[] {
  const price = euro(product.best_price);
  const priceDetail = price && product.best_store
    ? `Currently from ${price} at ${product.best_store}`
    : 'Check current Irish supermarket availability';
  const offerDetail = product.on_promotion
    ? 'A current promotion is available'
    : 'Check current promotions across Irish supermarkets';

  const primary: Record<Exclude<SuggestionIntent, 'meal' | 'budget' | 'general'>, PredictiveSuggestion> = {
    find: { label: `Where can I find ${product.name}?`, detail: priceDetail, prompt: `Where can I find ${product.name}?` },
    price: { label: `What is the current price of ${product.name}?`, detail: priceDetail, prompt: `Find the current price of ${product.name}` },
    offer: { label: `Is ${product.name} on offer?`, detail: offerDetail, prompt: `Where is ${product.name} currently on offer?` },
    compare: { label: `Compare prices for ${product.name}`, detail: 'Compare current prices and available pack options', prompt: `Compare current prices for ${product.name}` },
  };

  const first = intent === 'find' || intent === 'price' || intent === 'offer' || intent === 'compare'
    ? primary[intent]
    : primary.find;

  return [
    first,
    ...(intent !== 'offer' ? [primary.offer] : []),
    ...(intent !== 'compare' ? [primary.compare] : []),
    { label: `Find a better-value alternative to ${product.name}`, detail: 'Compare relevant alternatives, not just the lowest price', prompt: `Find a better-value alternative to ${product.name}` },
  ];
}

function contextualSuggestions(input: string, intent: SuggestionIntent): PredictiveSuggestion[] {
  const query = normaliseSuggestionText(input);
  const amount = input.match(/[€£]?\s?(\d{2,3})\b/)?.[1];
  const people = query.match(/(?:family of|for|shop for)\s+(\d+)/)?.[1];

  if (intent === 'meal') {
    const ingredient = query.match(/(?:with|using|use up)\s+(.+)$/)?.[1];
    return [
      ingredient
        ? { label: `What can I make with ${ingredient}?`, detail: 'Build practical meals around those ingredients', prompt: `What can I make with ${ingredient}?` }
        : { label: 'Plan four easy dinners', detail: 'Build a practical dinner plan with reusable ingredients', prompt: 'Help me plan four easy dinners' },
      { label: 'Plan five dinners with fewer ingredients', detail: 'Reuse ingredients and reduce waste across the week', prompt: 'Plan five dinners that reuse ingredients and keep waste down' },
      { label: 'Plan budget-friendly family dinners', detail: 'Use current products and sensible household value', prompt: 'Plan budget-friendly family dinners for this week' },
      { label: 'Plan vegetarian dinners', detail: 'Create a balanced, practical meat-free week', prompt: 'Plan five vegetarian dinners for this week' },
    ];
  }

  if (intent === 'budget') {
    const budget = amount ? `€${amount}` : 'my budget';
    const household = people ? ` for ${people} people` : '';
    return [
      { label: `Plan a household shop under ${budget}`, detail: `Build a practical complete shop${household}`, prompt: `Help me plan a household shop${household} under ${budget}` },
      { label: `Plan dinners within ${budget}`, detail: 'Prioritise useful meals and reusable ingredients', prompt: `Plan dinners for the week within ${budget}` },
      { label: `What should I prioritise within ${budget}?`, detail: 'Balance food, cleaning and household essentials', prompt: `What should I prioritise in a household shop within ${budget}?` },
      { label: 'Find better-value swaps', detail: 'Identify relevant savings without weakening the shop', prompt: `Suggest better-value swaps to keep my household shop within ${budget}` },
    ];
  }

  return [
    { label: `Find current products matching “${input.trim()}”`, detail: 'Search current Irish supermarket products and prices', prompt: `Find current supermarket products matching ${input.trim()}` },
    { label: `What is on offer for “${input.trim()}”?`, detail: 'Check current promotions and relevant alternatives', prompt: `What is currently on offer for ${input.trim()}?` },
    { label: `Compare options for “${input.trim()}”`, detail: 'Compare useful products, sizes and current prices', prompt: `Compare current options for ${input.trim()}` },
  ];
}

export function buildPredictiveSuggestions(
  input: string,
  products: CatalogueSuggestionProduct[] = [],
  limit = 4,
): PredictiveSuggestion[] {
  const intent = inferSuggestionIntent(input);
  const candidates = products.flatMap(product => productSuggestions(product, intent));
  const combined = [...candidates, ...contextualSuggestions(input, intent)];
  const seen = new Set<string>();
  return combined.filter(item => {
    const key = normaliseSuggestionText(item.prompt);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}
