create table if not exists public.retailer_mapping_audit_decisions (
  id uuid primary key default gen_random_uuid(),
  decision_batch text not null,
  store_product_id uuid not null references public.store_products(id) on delete restrict,
  store text not null,
  classification text not null check (classification in (
    'exact_unique', 'exact_synonym_duplicate', 'material_mismatch',
    'obsolete_mapping', 'exact_replacement_candidate', 'ambiguous',
    'insufficient_evidence'
  )),
  reason text not null,
  evidence_source text not null,
  prior_mapping jsonb not null,
  applied_action text,
  decided_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (decision_batch, store_product_id)
);

alter table public.retailer_mapping_audit_decisions enable row level security;
revoke all on public.retailer_mapping_audit_decisions from public, anon, authenticated;
grant select, insert, update on public.retailer_mapping_audit_decisions to service_role;

create index if not exists retailer_mapping_audit_store_product_idx
  on public.retailer_mapping_audit_decisions (store_product_id, decided_at desc);

create index if not exists retailer_mapping_audit_batch_idx
  on public.retailer_mapping_audit_decisions (decision_batch, classification);

comment on table public.retailer_mapping_audit_decisions is
  'Private immutable evidence snapshot and decision trail for conservative retailer mapping repair.';

with targets(store_product_id, reason) as (values
  ('a2fc5440-5668-428a-8a97-dfc2e84e4c30'::uuid, 'canonical brand Fyffes conflicts with Tesco own-label bananas'),
  ('febd1248-e6d2-4002-bf36-8f55082bff5c'::uuid, 'red chilli is mapped to a red bell pepper'),
  ('641fda29-f875-47d7-ae24-0b76798a445b'::uuid, 'canonical 250g mushrooms conflict with retailer 300g'),
  ('835814a0-379f-403e-aa7f-a753ba8c69b2'::uuid, 'canonical Daily Basics curry sauce conflicts with McDonnells'),
  ('f3809e2b-9700-4613-b6c3-89a836da8f9f'::uuid, 'pepperoni pizza two-pack is mapped to a pepperoni baguette'),
  ('01ca76ce-694d-4245-b38d-52ec97552276'::uuid, 'canonical six-pack conflicts with retailer five-pack'),
  ('6328d7b0-b28b-4925-a708-73ff3588cbc4'::uuid, 'loose single apple is mapped to a five-pack'),
  ('a4116a00-f5c0-48ec-a216-5397073d9def'::uuid, 'loose single apple is mapped to a seven-pack'),
  ('17f90709-5784-4345-9806-c62bd05488aa'::uuid, 'canonical 180g dessert conflicts with retailer 170g'),
  ('7de9eeba-1d3d-4591-ba4d-492f142c9179'::uuid, 'canonical Monini olive oil conflicts with Tesco own-label'),
  ('460cce42-2e8a-46b1-b0d5-325fa7904a9f'::uuid, 'semolina conchiglie pasta is mapped to semolina flour'),
  ('c2c19369-ae99-4a74-90c5-dd3ea81b1e3c'::uuid, 'Glenilen Farm yogurt is mapped to Tesco yogurt drink'),
  ('489a8a38-b6b6-488b-94e6-904c91041bc1'::uuid, 'chilli-infused olive oil is mapped to plain olive oil'),
  ('41216e11-6bb3-485a-9ac6-569f1cec5acb'::uuid, 'loose standard aubergine is mapped to a branded organic product'),
  ('6efa58ac-a9fd-4f06-a6fb-a0a5de28394b'::uuid, 'onion powder is mapped to onion granules'),
  ('1b5ca045-aa07-44bc-acdf-9d7e9f0cf054'::uuid, 'fresh onions are mapped to breaded onion rings'),
  ('3781be17-f6a2-4cd0-93a1-b8a87f2892f4'::uuid, 'baby spinach leaves are mapped to an organic non-baby variant'),
  ('53d5b0f4-579b-4eb3-b8f7-7272e967dde6'::uuid, 'generic pitta bread is mapped to wholemeal pitta'),
  ('755ff669-666e-4551-b49c-6709c6e1591a'::uuid, 'generic chicken thighs are mapped to a free-range 800g variant'),
  ('5c79faca-4f49-4017-9074-b2dcfcabc590'::uuid, 'standard salmon darnes are mapped to an organic branded variant'),
  ('9851a1dc-aa9f-4754-b1d4-62cfe34b229f'::uuid, 'beechwood six-pack rashers conflict with Tesco thick-cut 335g rashers'),
  ('18e273d8-255e-4f1e-bb80-c93400c6027a'::uuid, 'Fitzgeralds wraps are mapped to H.W. Nevills wholemeal wraps'),
  ('3d8cfb8a-abcf-4f07-bef5-f124d81a8869'::uuid, 'natural yogurt four-pack is mapped to peach yogurt 500g'),
  ('13e93fab-e4c4-4a35-bd6c-255709c32b02'::uuid, 'chicken oyster thighs are mapped to boneless thighs'),
  ('937fcf82-d1ed-4549-8b5d-9def9096bfaf'::uuid, 'generic kiwi four-pack is mapped to gold kiwi'),
  ('0a5c6ba6-5b31-4182-9e01-03e41f72d512'::uuid, 'Tesco seedless grapes are mapped to Keelings black grapes')
)
insert into public.retailer_mapping_audit_decisions (
  decision_batch, store_product_id, store, classification, reason,
  evidence_source, prior_mapping
)
select
  'tesco-risk-audit-2026-09-20-v1', sp.id, sp.store, 'material_mismatch',
  targets.reason, 'deterministic_identity_audit',
  jsonb_build_object(
    'product_id', sp.product_id,
    'canonical_name', p.canonical_name,
    'canonical_brand', p.brand,
    'store_product_name', sp.store_product_name,
    'store_brand', sp.brand,
    'is_own_brand', sp.is_own_brand,
    'store_sku', sp.store_sku,
    'store_url', sp.store_url,
    'url_status', sp.url_status,
    'url_last_checked_at', sp.url_last_checked_at,
    'url_last_error', sp.url_last_error,
    'fresh_observed_at', lp.observed_at
  )
from targets
join public.store_products sp on sp.id = targets.store_product_id
join public.products p on p.id = sp.product_id
left join public.latest_prices lp on lp.store_product_id = sp.id
where sp.store = 'tesco'
on conflict (decision_batch, store_product_id) do nothing;

update public.store_products sp
set
  url_status = 'failed',
  url_last_checked_at = now(),
  url_last_error = 'tesco_mapping_audit: ' || audit.reason
from public.retailer_mapping_audit_decisions audit
where audit.decision_batch = 'tesco-risk-audit-2026-09-20-v1'
  and audit.classification = 'material_mismatch'
  and audit.store_product_id = sp.id
  and sp.store = 'tesco'
  and sp.url_status = audit.prior_mapping ->> 'url_status'
  and sp.store_sku is not distinct from audit.prior_mapping ->> 'store_sku'
  and sp.store_url is not distinct from audit.prior_mapping ->> 'store_url'
  and sp.store_product_name is not distinct from audit.prior_mapping ->> 'store_product_name';

update public.retailer_mapping_audit_decisions audit
set applied_action = 'invalidate_trusted_mapping', applied_at = now()
from public.store_products sp
where audit.decision_batch = 'tesco-risk-audit-2026-09-20-v1'
  and audit.store_product_id = sp.id
  and sp.url_status = 'failed'
  and sp.url_last_error = 'tesco_mapping_audit: ' || audit.reason;
