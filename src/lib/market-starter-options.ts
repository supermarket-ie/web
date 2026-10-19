// Stable, high-intent homepage entry points. Live price intelligence is applied by the agent after the click.
export type MarketStarterIcon = 'offer' | 'compare' | 'meal' | 'shop';
export const MARKET_STARTER_VERSION = 3;

export type MarketStarter = {
  id: string;
  label: string;
  detail: string;
  prompt: string;
  icon: MarketStarterIcon;
};

export function fallbackStarters(): MarketStarter[] {
  return [
    {
      id: 'shop:weekly',
      label: 'Build my weekly shop',
      detail: 'Tell me what you need and I’ll find the best-value way to buy it',
      prompt: 'Help me build my weekly household shop. Ask only the essential questions about my household, budget, dietary needs and what I need this week, then prepare a practical shop using current checked prices and explain the best-value retailer choices.',
      icon: 'shop',
    },
    {
      id: 'compare:shopping-list',
      label: 'Compare my shopping list',
      detail: 'See what my shop costs across Tesco, Dunnes and SuperValu',
      prompt: 'Help me compare my shopping list across Tesco, Dunnes and SuperValu. Ask me for the items I need, match equivalent products carefully, use current checked prices only, and show where the meaningful savings are without mixing incompatible pack sizes.',
      icon: 'compare',
    },
    {
      id: 'offer:best-deals',
      label: 'Find today’s best deals',
      detail: 'Show me offers that could actually save money on my household shop',
      prompt: 'Help me find the best current deals for a household shop. Ask what I am likely to buy, then use current checked offers to surface genuinely useful savings rather than simply listing the biggest discounts. Compare pack size and unit value where relevant.',
      icon: 'offer',
    },
    {
      id: 'meal:plan-and-shop',
      label: 'Plan meals and shop',
      detail: 'Plan dinners, build the ingredient list and check current prices',
      prompt: 'Help me plan practical dinners for my household, reuse ingredients across meals, build the shopping list, and then check current prices for the ingredients I need. Ask about household size and dietary needs first.',
      icon: 'meal',
    },
  ];
}
