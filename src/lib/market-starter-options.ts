// Safe to share with the client; live price selection stays on the server.
export type MarketStarterIcon = 'offer' | 'compare' | 'meal' | 'shop';
export const MARKET_STARTER_VERSION = 2;

export type MarketStarter = {
  id: string;
  label: string;
  detail: string;
  prompt: string;
  icon: MarketStarterIcon;
};

export function fallbackStarters(): MarketStarter[] {
  return [
    { id: 'shop:household', label: 'Build my household shop', detail: 'Plan food, cleaning and toiletries around your budget', prompt: 'Help me build a practical household shop covering food, cleaning and toiletries. First ask about my household, budget and what I already have, then prepare a priced shop using suitable available products.', icon: 'shop' },
    { id: 'meal:fallback', label: 'Help me plan a few dinners', detail: 'Make ingredients go further across meals', prompt: 'Help me plan a few practical dinners with ingredients I can reuse. Ask about my household and dietary needs first.', icon: 'meal' },
    { id: 'offer:fallback', label: 'Review my household essentials', detail: 'Work out what needs replacing and what can wait', prompt: 'Help me review cleaning, laundry and toiletries for my household shop. Ask what I need and already have before suggesting purchases.', icon: 'offer' },
    { id: 'compare:fallback', label: 'Compare a product I buy regularly', detail: 'Check matching brands and pack sizes', prompt: 'Help me compare a product I buy regularly. Ask which product and pack size, then compare only equivalent options with checked prices.', icon: 'compare' },
  ];
}
