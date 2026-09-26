-- Reversible, evidence-guarded quarantine. No price or historical mapping is deleted.
-- Run inside a transaction; inspect the final SELECT before COMMIT.
with evidence(store, canonical_name, sku, retailer_name, reason) as (values
  ('supervalu', 'Mini Bananas', '1709524003',
   'Ella''s Kitchen Strawberry & Banana Mini Puffs 10+ Months 4 Pack (8 g)',
   'Fresh fruit is mapped to a processed baby snack.'),
  ('dunnes', 'Bananas Loose', '100750899', 'Fyffes 5 Organic Fairtrade Bananas',
   'Loose bananas are mapped to an organic five-banana pack; the unit and pack price are not equivalent.')
)
insert into public.retailer_mapping_audit_decisions (
  decision_batch, store_product_id, store, classification, reason, evidence_source, prior_mapping
)
select 'household-shop-identity-2026-09-26', sp.id, sp.store, 'material_mismatch', e.reason,
  'Live household-shop regression and stored retailer SKU/title evidence',
  to_jsonb(sp) || jsonb_build_object('canonical_name', p.canonical_name)
from evidence e
join public.products p on p.canonical_name = e.canonical_name
join public.store_products sp on sp.product_id = p.id and sp.store = e.store
  and sp.store_sku = e.sku and sp.store_product_name = e.retailer_name
where sp.url_status = 'resolved'
on conflict (decision_batch, store_product_id) do nothing;

update public.store_products sp
set url_status = 'failed', url_last_checked_at = now(),
  url_last_error = 'household_shop_identity_audit: ' || audit.reason
from public.retailer_mapping_audit_decisions audit
where audit.decision_batch = 'household-shop-identity-2026-09-26'
  and audit.applied_at is null
  and sp.id = audit.store_product_id
  and sp.url_status = audit.prior_mapping ->> 'url_status'
  and sp.product_id::text = audit.prior_mapping ->> 'product_id'
  and sp.store_sku is not distinct from audit.prior_mapping ->> 'store_sku'
  and sp.store_product_name is not distinct from audit.prior_mapping ->> 'store_product_name'
  and sp.store_url is not distinct from audit.prior_mapping ->> 'store_url';

update public.retailer_mapping_audit_decisions audit
set applied_action = 'invalidate_trusted_mapping', applied_at = now()
from public.store_products sp
where audit.decision_batch = 'household-shop-identity-2026-09-26'
  and audit.applied_at is null and sp.id = audit.store_product_id
  and sp.url_status = 'failed'
  and sp.url_last_error = 'household_shop_identity_audit: ' || audit.reason;

select audit.store, audit.prior_mapping ->> 'canonical_name' as canonical_name,
  audit.applied_action, sp.url_status,
  exists (select 1 from public.latest_prices lp where lp.store_product_id = sp.id) as still_trusted
from public.retailer_mapping_audit_decisions audit
join public.store_products sp on sp.id = audit.store_product_id
where audit.decision_batch = 'household-shop-identity-2026-09-26';
