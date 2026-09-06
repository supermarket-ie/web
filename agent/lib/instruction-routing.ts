export type EveCapability = 'household_shop' | 'product' | 'price' | 'meal' | 'budget' | 'memory' | 'shop_edit' | 'monitoring' | 'briefing' | 'retailer';

const RULES: Array<[EveCapability, RegExp]> = [
  ['household_shop', /\b(complete|weekly|household|usual|normal)\b.{0,30}\b(shop|list|basket)|\b(shop|list|basket)\b.{0,30}\b(complete|weekly|household|usual|normal)\b/i],
  ['monitoring', /\b(watch|monitor|notify|remind|track|alert|tell me when|stop proactive|keep me updated)\b/i],
  ['briefing', /\b(what.{0,12}(changed|noticed|worth)|worth (buying|knowing)|recommend.{0,12}(week|today))\b/i],
  ['shop_edit', /\b(add|remove|delete|drop|replace|swap|substitute|change|increase|reduce|make that)\b.{0,35}\b(shop|list|basket|item|quantity|one|two|three|\d+)\b/i],
  ['budget', /(?:€|eur|budget|under \d+|spend|cheaper|reduce.{0,15}total|within budget)/i],
  ['meal', /\b(meal|dinner|lunch|breakfast|recipe|ingredient|cook|taco|pasta|waste)\b/i],
  ['retailer', /\b(tesco|dunnes|supervalu|aldi|retailer|supermarket|one store|split shop|basket comparison|trolley|checkout)\b/i],
  ['price', /\b(price|cost|offers?|promotions?|deals?|savings?|cheapest|value)\b/i],
  ['memory', /\b(prefer|preference|diet|dietary|allerg|gluten|vegan|vegetarian|dislike|household size|adults?|children|batch cook)\b/i],
  ['product', /\b(find|search|look up|available|milk|bread|butter|toilet roll|mayonnaise|product)\b/i],
];

export function selectEveCapabilities(text: string): EveCapability[] {
  const selected = RULES.filter(([, rule]) => rule.test(text)).map(([capability]) => capability);
  return selected.length ? [...new Set(selected)] : ['product'];
}

export function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.flatMap(part => part && typeof part === 'object' && 'text' in part && typeof part.text === 'string' ? [part.text] : []).join(' ');
}
