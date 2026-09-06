import { defineDynamic, defineInstructions } from 'eve/instructions';
import { agentSupabase } from '../lib/supabase';
import { buildBoundedSessionContext } from '../lib/session-context';
import { messageText, selectEveCapabilities } from '../lib/instruction-routing';

function weekStart(now: Date) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() === 0 ? 6 : date.getUTCDay() - 1));
  return date.toISOString().slice(0, 10);
}

export default defineDynamic({
  events: {
    'turn.started': async (_event, ctx) => {
      const principal = ctx.session.auth.current;
      if (principal?.principalType !== 'user' || !principal.principalId) return null;
      const subscriberId = principal.principalId;
      const recentText = ctx.messages.filter(message => message.role === 'user').slice(-4).map(message => messageText(message.content)).join('\n');
      const capabilities = selectEveCapabilities(recentText);
      const now = new Date();
      const [household, shop, meals, history, watches] = await Promise.all([
        agentSupabase.from('households').select('adults, children, child_ages, weekly_budget, preferred_stores, dietary, dislikes, meals, batch_cooking, skip_days, extra_context').eq('subscriber_id', subscriberId).maybeSingle(),
        agentSupabase.from('saved_lists').select('id, name, family_size, items, store_totals, generated_at').eq('subscriber_id', subscriberId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
        agentSupabase.from('weekly_plans').select('meals').eq('subscriber_id', subscriberId).eq('week_start', weekStart(now)).maybeSingle(),
        agentSupabase.from('list_items').select('canonical_name, quantity, observed_at').eq('subscriber_id', subscriberId).order('observed_at', { ascending: false }).limit(40),
        agentSupabase.from('agent_tasks').select('type, canonical_name, product_family, condition').eq('subscriber_id', subscriberId).eq('status', 'active').order('created_at', { ascending: false }).limit(20),
      ]);
      const failed = [household, shop, meals, history, watches].find(result => result.error);
      if (failed?.error) throw new Error(`Unable to load bounded household context: ${failed.error.message}`);

      const shopItems = ((shop.data?.items ?? []) as Array<{ canonical_product_id?: string; canonical_name?: string; display_label?: string; quantity?: number; coverage_status?: string }>).slice(0, 80).map(item => ({ canonical_product_id: item.canonical_product_id ?? null, name: item.canonical_name ?? item.display_label, quantity: item.quantity ?? 1, coverage: item.coverage_status ?? null }));
      const counts = new Map<string, { occurrences: number; last_seen: string; usual_quantity: number }>();
      for (const row of history.data ?? []) {
        if (!counts.has(row.canonical_name)) counts.set(row.canonical_name, { occurrences: 0, last_seen: row.observed_at, usual_quantity: Number(row.quantity ?? 1) });
        counts.get(row.canonical_name)!.occurrences += 1;
      }
      const context = buildBoundedSessionContext({
        now, capabilities,
        explicitFacts: household.data ?? null,
        currentShop: shop.data ? { id: shop.data.id, name: shop.data.name, family_size: shop.data.family_size, generated_at: shop.data.generated_at, items: shopItems, store_totals: shop.data.store_totals } : null,
        mealPlan: meals.data?.meals ?? null,
        recentBehaviour: [...counts.entries()].slice(0, 20).map(([canonical_name, evidence]) => ({ canonical_name, ...evidence, source: 'inferred_from_list_items' })),
        watches: (watches.data ?? []).map(row => ({ type: row.type, canonical_name: row.canonical_name, product_family: row.product_family, condition: row.condition })),
      });
      console.info('[eve-session-context]', { chars: context.chars, truncated: context.truncated, capabilities, sections: context.included });
      return defineInstructions({ content: context.content, role: 'user' });
    },
  },
});
