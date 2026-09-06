import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getSubscriberId } from '@/lib/auth';
import { parseMarkdownList } from '@/lib/parse-planner-markdown';
import { householdShopToolOutputSchema, type HouseholdShopContract } from '@/lib/shopping/household-shop-contract';
import { groundHouseholdShop } from '@/lib/shopping/household-shop';

function sessionToken(request: NextRequest, explicit?: string) {
  return request.cookies.get('sm_session')?.value ?? (explicit && explicit !== '__cookie__' ? explicit : null);
}

async function repriceStructuredShop(input: unknown): Promise<HouseholdShopContract> {
  const parsed = householdShopToolOutputSchema.parse({ kind: 'household_shop', shop: input });
  const proposal = {
    schema_version: parsed.shop.schema_version,
    household: parsed.shop.household,
    sections: parsed.shop.sections,
    items: parsed.shop.items.map(item => ({
      line_id: item.line_id, section_id: item.section_id, canonical_product_id: item.canonical_product_id,
      unresolved_need: item.unresolved_need, display_label: item.display_label, quantity: item.quantity,
      unit_or_pack_expectation: item.unit_or_pack_expectation, reason: item.reason, purpose: item.purpose,
      preferred_retailer: item.selected_offer?.retailer ?? item.preferred_retailer,
    })),
  };
  const ids = [...new Set(proposal.items.flatMap(item => item.canonical_product_id ? [item.canonical_product_id] : []))];
  const [catalogue, prices] = ids.length ? await Promise.all([
    supabaseAdmin.from('products').select('id, canonical_name, category').in('id', ids),
    supabaseAdmin.from('latest_prices').select('canonical_product_id, canonical_name, category, store_product_id, store, store_product_name, store_sku, store_url, price, was_price, on_promotion, observed_at, source, relationship_type, freshness_state').in('canonical_product_id', ids),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (catalogue.error || prices.error) throw new Error('Unable to reprice structured household shop.');
  return groundHouseholdShop({
    proposal,
    catalogue_products: (catalogue.data ?? []).map(row => ({ canonical_product_id: String(row.id), canonical_name: row.canonical_name, category: row.category ?? null })),
    latest_prices: (prices.data ?? []).map(row => ({ ...row, canonical_product_id: String(row.canonical_product_id), store_product_id: String(row.store_product_id), price: Number(row.price), was_price: row.was_price == null ? null : Number(row.was_price), on_promotion: row.on_promotion === true, relationship_type: row.relationship_type as 'exact', freshness_state: row.freshness_state as 'fresh' })),
    comparison_retailers: ['tesco', 'dunnes', 'supervalu'],
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { token?: string; markdown?: string; household_shop?: unknown; name?: string; family_size?: string };
    const subscriberId = getSubscriberId(sessionToken(request, body.token));
    if (!subscriberId) return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
    const structured = body.household_shop ? await repriceStructuredShop(body.household_shop) : null;
    if (!structured && !body.markdown) return NextResponse.json({ error: 'Missing household_shop or markdown' }, { status: 400 });
    const legacy = structured ? null : parseMarkdownList(body.markdown!);
    if (!structured && legacy!.items.length === 0) return NextResponse.json({ error: 'Could not parse any items from list content' }, { status: 422 });

    const items = structured ? structured.items.map(item => ({
      schema_version: structured.schema_version, line_id: item.line_id, canonical_product_id: item.canonical_product_id,
      unresolved_need: item.unresolved_need, canonical_name: item.canonical_name ?? item.display_label, display_label: item.display_label,
      category: item.category ?? structured.sections.find(section => section.id === item.section_id)?.label ?? 'Other',
      store: item.selected_offer?.retailer ?? '', store_product_id: item.selected_offer?.retailer_product_id ?? null,
      store_sku: item.selected_offer?.retailer_sku ?? null, price: item.selected_offer?.current_price ?? null,
      quantity: item.quantity, unit_or_pack_expectation: item.unit_or_pack_expectation, coverage_status: item.coverage_status,
      on_promotion: item.selected_offer?.promotion.retailer_marked ?? false,
    })) : legacy!.items;
    const storeTotals = structured
      ? structured.store_coverage.map(row => ({ store: row.retailer, total: row.basket_total, item_count: row.covered_lines, complete: row.complete }))
      : legacy!.storeTotals;

    const { data: existing } = await supabaseAdmin.from('saved_lists').select('id, created_at').eq('subscriber_id', subscriberId).order('created_at', { ascending: true });
    if (existing && existing.length >= 10) await supabaseAdmin.from('saved_lists').delete().in('id', existing.slice(0, existing.length - 9).map(row => row.id));
    await supabaseAdmin.from('saved_lists').update({ is_default: false }).eq('subscriber_id', subscriberId);
    const name = body.name ?? (structured ? `${structured.household.planning_period.label} household shop` : body.markdown!.split('\n').find(line => line.startsWith('# '))?.slice(2).trim()) ?? 'Weekly grocery list';
    const { data: saved, error } = await supabaseAdmin.from('saved_lists').insert({
      subscriber_id: subscriberId, name: name.slice(0, 80),
      family_size: body.family_size ?? (structured ? String(structured.household.adults + (structured.household.children ?? 0)) : undefined) ?? '2',
      items, store_totals: storeTotals, is_default: true, generated_at: new Date().toISOString(),
      agent_decision_trace: structured ? { kind: 'household_shop', schema_version: structured.schema_version, household: structured.household, missing_or_uncertain_items: structured.missing_or_uncertain_items, provenance: structured.provenance } : null,
    }).select('id').single();
    if (error || !saved) throw error ?? new Error('Failed to save list');
    const history = items.filter(item => item.price != null && item.store).map(item => ({ subscriber_id: subscriberId, list_id: saved.id, canonical_name: item.canonical_name, category: item.category, store: item.store, price_paid: item.price, quantity: item.quantity, observed_at: new Date().toISOString() }));
    if (history.length) await supabaseAdmin.from('list_items').insert(history);
    void supabaseAdmin.from('subscribers').update({ refresh_cache: null, refresh_cache_at: null }).eq('id', subscriberId);
    return NextResponse.json({ ok: true, list_id: saved.id, item_count: items.length, format: structured ? structured.schema_version : 'legacy_markdown' });
  } catch (error) {
    console.error('[save-from-planner] unexpected error:', error);
    return NextResponse.json({ error: 'Failed to validate or save list' }, { status: 422 });
  }
}
