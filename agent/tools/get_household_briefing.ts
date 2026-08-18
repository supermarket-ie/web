import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { requireSubscriber } from '../lib/subscriber';
import { agentSupabase } from '../lib/supabase';

export default defineTool({
  description: 'Get the signed-in household’s most useful current shopping signals: meaningful price changes and promotions on products they actually buy. Use when the user asks what is worth knowing, what changed, or what they should buy this week.',
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const subscriberId = requireSubscriber(ctx);

    const { data: history } = await agentSupabase
      .from('list_items')
      .select('canonical_name, store, price_paid, observed_at')
      .eq('subscriber_id', subscriberId)
      .order('observed_at', { ascending: false })
      .limit(200);

    if (!history?.length) {
      return { quiet: true, summary: 'I need a little shopping history before I can give you a useful household briefing.', insights: [] };
    }

    const counts = new Map<string, number>();
    const last = new Map<string, { store: string; price: number }>();
    for (const row of history) {
      counts.set(row.canonical_name, (counts.get(row.canonical_name) ?? 0) + 1);
      if (!last.has(row.canonical_name)) last.set(row.canonical_name, { store: row.store, price: Number(row.price_paid) });
    }

    const names = [...last.keys()].slice(0, 40);
    const { data: prices } = await agentSupabase
      .from('latest_prices')
      .select('canonical_name, store, price, was_price, on_promotion')
      .in('canonical_name', names);

    const best = new Map<string, { store: string; price: number; was_price: number | null; on_promotion: boolean }>();
    for (const row of prices ?? []) {
      const existing = best.get(row.canonical_name);
      if (!existing || Number(row.price) < existing.price) {
        best.set(row.canonical_name, { store: row.store, price: Number(row.price), was_price: row.was_price ? Number(row.was_price) : null, on_promotion: Boolean(row.on_promotion) });
      }
    }

    const insights = names.flatMap(name => {
      const previous = last.get(name);
      const current = best.get(name);
      if (!previous || !current) return [];
      const change = Number((current.price - previous.price).toFixed(2));
      const frequent = (counts.get(name) ?? 0) >= 2;
      const promoSaving = current.on_promotion && current.was_price ? Number((current.was_price - current.price).toFixed(2)) : 0;

      if (frequent && promoSaving >= 0.75) return [{ kind: 'promotion', canonical_name: name, store: current.store, price: current.price, saving: promoSaving, priority: 80 + promoSaving }];
      if (change <= -0.5) return [{ kind: 'price_drop', canonical_name: name, store: current.store, price: current.price, saving: Math.abs(change), priority: (frequent ? 60 : 40) + Math.abs(change) }];
      if (frequent && change >= 1) return [{ kind: 'price_rise', canonical_name: name, store: current.store, price: current.price, increase: change, priority: 35 + change }];
      return [];
    }).sort((a, b) => b.priority - a.priority).slice(0, 3);

    return {
      quiet: insights.length === 0,
      summary: insights.length ? `${insights.length} things are worth knowing about this household’s shop.` : 'Nothing important has changed in the household’s usual shop.',
      insights,
    };
  },
});
