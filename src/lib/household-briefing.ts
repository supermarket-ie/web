import 'server-only';
import { supabaseAdmin } from '@/lib/supabase';
import { queryPriceChanges, queryUserHistory } from '@/lib/planner-agent';

export type BriefingInsight = {
  kind: 'price_drop' | 'price_rise' | 'promotion' | 'replenishment';
  priority: number;
  title: string;
  body: string;
  canonicalName?: string;
  action?: 'add_to_list' | 'review';
};

export type HouseholdBriefing = {
  subscriberId: string;
  generatedAt: string;
  insights: BriefingInsight[];
  quiet: boolean;
  summary: string;
};

const MIN_PRICE_MOVE = 0.50;
const MIN_PROMO_SAVING = 0.75;
const MAX_INSIGHTS = 3;

function euro(value: number) {
  return `€${Math.abs(value).toFixed(2)}`;
}

export async function buildHouseholdBriefing(subscriberId: string): Promise<HouseholdBriefing> {
  const [history, priceChanges] = await Promise.all([
    queryUserHistory(subscriberId),
    queryPriceChanges(subscriberId),
  ]);

  const frequent = new Set(history.filter(item => item.times_bought >= 2).map(item => item.canonical_name));
  const names = history.slice(0, 40).map(item => item.canonical_name);

  const { data: currentRows } = names.length
    ? await supabaseAdmin
        .from('latest_prices')
        .select('canonical_name, store, price, was_price, on_promotion')
        .in('canonical_name', names)
    : { data: [] as Array<{ canonical_name: string; store: string; price: number; was_price: number | null; on_promotion: boolean }> };

  const insights: BriefingInsight[] = [];

  for (const change of priceChanges) {
    if (Math.abs(change.change) < MIN_PRICE_MOVE) continue;
    const isFrequent = frequent.has(change.canonical_name);
    if (change.direction === 'cheaper') {
      insights.push({
        kind: 'price_drop',
        priority: (isFrequent ? 50 : 25) + Math.min(30, Math.abs(change.change) * 5),
        title: `${change.canonical_name} is ${euro(change.change)} cheaper`,
        body: `Best current price is €${change.best_price_now.toFixed(2)} at ${change.best_store_now}.`,
        canonicalName: change.canonical_name,
        action: 'add_to_list',
      });
    } else if (isFrequent && change.change >= 1) {
      insights.push({
        kind: 'price_rise',
        priority: 25 + Math.min(20, change.change * 4),
        title: `${change.canonical_name} has gone up ${euro(change.change)}`,
        body: `It is currently €${change.best_price_now.toFixed(2)} at ${change.best_store_now}. I can look for an alternative when you build your shop.`,
        canonicalName: change.canonical_name,
        action: 'review',
      });
    }
  }

  const seenPromo = new Set<string>();
  for (const row of currentRows ?? []) {
    if (!row.on_promotion || !row.was_price || !frequent.has(row.canonical_name)) continue;
    const saving = Number(row.was_price) - Number(row.price);
    if (saving < MIN_PROMO_SAVING || seenPromo.has(row.canonical_name)) continue;
    seenPromo.add(row.canonical_name);
    insights.push({
      kind: 'promotion',
      priority: 60 + Math.min(25, saving * 5),
      title: `${row.canonical_name} is on offer`,
      body: `It is €${Number(row.price).toFixed(2)} at ${row.store}, saving ${euro(saving)} on the previous price.`,
      canonicalName: row.canonical_name,
      action: 'add_to_list',
    });
  }

  const selected = insights
    .sort((a, b) => b.priority - a.priority)
    .filter((item, index, all) => all.findIndex(other => other.canonicalName === item.canonicalName) === index)
    .slice(0, MAX_INSIGHTS);

  return {
    subscriberId,
    generatedAt: new Date().toISOString(),
    insights: selected,
    quiet: selected.length === 0,
    summary: selected.length === 0
      ? 'Nothing important has changed in your usual shop.'
      : `${selected.length} ${selected.length === 1 ? 'thing is' : 'things are'} worth knowing about your shop.`,
  };
}
