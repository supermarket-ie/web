export type SuggestionIntent = 'find' | 'price' | 'offer' | 'compare' | 'meal' | 'budget' | 'dietary' | 'general';

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
  if (/\b(gluten(?:\s+f(?:r(?:e(?:e)?)?)?)?|dairy(?:\s+f(?:r(?:e(?:e)?)?)?)?|lactose(?:\s+f(?:r(?:e(?:e)?)?)?)?|nut(?:\s+f(?:r(?:e(?:e)?)?)?)?|peanut(?:\s+f(?:r(?:e(?:e)?)?)?)?|egg(?:\s+f(?:r(?:e(?:e)?)?)?)?|soy(?:\s+f(?:r(?:e(?:e)?)?)?)?|sesame(?:\s+f(?:r(?:e(?:e)?)?)?)?|low\s+(?:prot(?:e(?:i(?:n)?)?)?|sod(?:i(?:u(?:m)?)?)?|salt|sugar|carb)|high\s+prot(?:e(?:i(?:n)?)?)?|no\s+added\s+sugar|without\s+(?:gluten|dairy|lactose|nuts?|peanuts?|eggs?|soy|sesame)|allerg(?:y|ies|en|ens)|vegetarian|vegan|halal|kosher|keto)\b/.test(query)) return 'dietary';
  if (/\b(dinners?|meals?|cook|make|recipes?|lunch(?:es)?|breakfasts?|ingredients?)\b/.test(query)) return 'meal';
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

function readableFragment(fragment: string): string {
  return fragment
    .split(' ')
    .map(token => {
      if (token === 'hellmanns') return "Hellmann's";
      if (token === 'mayo') return 'mayonnaise';
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(' ');
}

function dietaryRequirement(input: string): string {
  const query = normaliseSuggestionText(input);
  const completions: Array<[RegExp, string]> = [
    [/\bgluten\s+f(?:r(?:e(?:e)?)?)?\b/, 'gluten-free'],
    [/\bdairy\s+f(?:r(?:e(?:e)?)?)?\b/, 'dairy-free'],
    [/\blactose\s+f(?:r(?:e(?:e)?)?)?\b/, 'lactose-free'],
    [/\bnut\s+f(?:r(?:e(?:e)?)?)?\b/, 'nut-free'],
    [/\bpeanut\s+f(?:r(?:e(?:e)?)?)?\b/, 'peanut-free'],
    [/\begg\s+f(?:r(?:e(?:e)?)?)?\b/, 'egg-free'],
    [/\bsoy\s+f(?:r(?:e(?:e)?)?)?\b/, 'soy-free'],
    [/\bsesame\s+f(?:r(?:e(?:e)?)?)?\b/, 'sesame-free'],
    [/\blow\s+prot(?:e(?:i(?:n)?)?)?\b/, 'low protein'],
    [/\blow\s+sod(?:i(?:u(?:m)?)?)?\b/, 'low sodium'],
    [/\bhigh\s+prot(?:e(?:i(?:n)?)?)?\b/, 'high protein'],
  ];
  for (const [pattern, label] of completions) {
    if (pattern.test(query)) return label;
  }
  return query.match(/\b(no added sugar|low (?:salt|sugar|carb)|without (?:gluten|dairy|lactose|nuts?|peanuts?|eggs?|soy|sesame)|vegetarian|vegan|halal|kosher|keto)\b/)?.[1]
    ?? query;
}

function productSuggestions(product: CatalogueSuggestionProduct, intent: SuggestionIntent): PredictiveSuggestion[] {
  const price = euro(product.best_price);
  const priceDetail = price && product.best_store
    ? `Currently from ${price} at ${product.best_store}`
    : 'Check current Irish supermarket availability';
  const offerDetail = product.on_promotion
    ? 'A current promotion is available'
    : 'Check current promotions across Irish supermarkets';

  const primary: Record<Exclude<SuggestionIntent, 'meal' | 'budget' | 'dietary' | 'general'>, PredictiveSuggestion> = {
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
  const fragment = extractCatalogueFragment(input);
  const subject = readableFragment(fragment || input.trim());
  const amount = input.match(/[€£]?\s?(\d{2,3})\b/)?.[1];
  const people = query.match(/(?:family of|for|shop for)\s+(\d+)/)?.[1];

  if (intent === 'dietary') {
    const requirement = dietaryRequirement(input);
    const namedProduct = normaliseSuggestionText(input)
      .replace(/\b(?:gluten|dairy|lactose|nut|peanut|egg|soy|sesame)\s+f(?:r(?:e(?:e)?)?)?\b/g, ' ')
      .replace(/\b(?:low\s+(?:prot(?:e(?:i(?:n)?)?)?|sod(?:i(?:u(?:m)?)?)?|salt|sugar|carb)|high\s+prot(?:e(?:i(?:n)?)?)?|no\s+added\s+sugar|without\s+(?:gluten|dairy|lactose|nuts?|peanuts?|eggs?|soy|sesame)|vegetarian|vegan|halal|kosher|keto)\b/g, ' ')
      .replace(/\b(products?|food|foods|options?|meals?|dinners?|recipes?|find|show|me|for)\b/g, ' ')
      .trim().replace(/\s+/g, ' ');
    const product = namedProduct || null;
    const target = product ? `${requirement} ${product}` : `${requirement} products`;
    return [
      { label: `Find ${target}`, detail: 'Search products and check available ingredient or nutrition information', prompt: `Find ${target} and check the available ingredient or nutrition information` },
      product
        ? { label: `Check ${product} for ${requirement}`, detail: 'Review available labels and ingredient information for this requirement', prompt: `Check ${product} options for ${requirement} using available label and ingredient information` }
        : { label: `Compare ${requirement} options`, detail: 'Compare relevant products, prices and available label information', prompt: `Compare ${requirement} product options and their current prices` },
      { label: `Plan meals around a ${requirement} requirement`, detail: 'Build practical meal ideas while keeping the stated requirement exact', prompt: `Help me plan meals around a ${requirement} requirement` },
      { label: `Compare prices for ${target}`, detail: 'Compare matching options across Irish supermarkets', prompt: `Compare current Irish supermarket prices for ${target}` },
    ];
  }

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


  if (intent === 'offer') {
    return [
      { label: `Is ${subject} on offer?`, detail: 'Check current promotions across Irish supermarkets', prompt: `Where is ${subject} currently on offer?` },
      { label: `Compare current prices for ${subject}`, detail: 'Compare available products, stores and pack sizes', prompt: `Compare current prices for ${subject}` },
      { label: `Find a better-value alternative to ${subject}`, detail: 'Compare genuinely relevant alternatives', prompt: `Find a better-value alternative to ${subject}` },
      { label: `Where can I buy ${subject}?`, detail: 'Check current products, prices and availability', prompt: `Where can I buy ${subject}?` },
    ];
  }

  if (intent === 'price' || intent === 'compare' || intent === 'find') {
    return [
      { label: intent === 'find' ? `Where can I find ${subject}?` : `Compare current prices for ${subject}`, detail: 'Check current Irish supermarket products and prices', prompt: intent === 'find' ? `Where can I find ${subject}?` : `Compare current prices for ${subject}` },
      { label: `Is ${subject} on offer?`, detail: 'Check current promotions across Irish supermarkets', prompt: `Where is ${subject} currently on offer?` },
      { label: `Find a better-value alternative to ${subject}`, detail: 'Compare relevant alternatives, not just the lowest price', prompt: `Find a better-value alternative to ${subject}` },
    ];
  }

  return [
    { label: `Find current products matching “${subject}”`, detail: 'Search current Irish supermarket products and prices', prompt: `Find current supermarket products matching ${subject}` },
    { label: `What is on offer for “${subject}”?`, detail: 'Check current promotions and relevant alternatives', prompt: `What is currently on offer for ${subject}?` },
    { label: `Compare options for “${subject}”`, detail: 'Compare useful products, sizes and current prices', prompt: `Compare current options for ${subject}` },
  ];
}

export function buildPredictiveSuggestions(
  input: string,
  products: CatalogueSuggestionProduct[] = [],
  limit = 4,
): PredictiveSuggestion[] {
  const intent = inferSuggestionIntent(input);
  const fragmentTokens = extractCatalogueFragment(input).split(' ').filter(Boolean);
  const brandStem = fragmentTokens.length > 1 ? fragmentTokens[0].slice(0, 5) : '';
  const trustedProducts = brandStem
    ? products.filter(product => normaliseSuggestionText(product.name).includes(brandStem))
    : products;
  const productSets = trustedProducts.map(product => productSuggestions(product, intent));
  const candidates = [
    ...productSets.slice(0, 2).map(set => set[0]),
    ...(productSets[0]?.slice(1) ?? []),
  ];
  const combined = [...candidates, ...contextualSuggestions(input, intent)];
  const seen = new Set<string>();
  return combined.filter(item => {
    const key = normaliseSuggestionText(item.prompt);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}
