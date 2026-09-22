-- Persist the one deterministic repair from the 20-product demand-first
-- candidate-discovery run. The existing SuperValu SKU identifies this
-- canonical as white pitta, which disambiguates the two Tesco candidates.
do $$
declare
  v_product_id uuid;
  v_store_product_id uuid;
  v_run_uuid uuid;
  v_candidate_id uuid;
  v_candidate_created_at timestamptz;
  v_prior_mapping jsonb;
begin
  select p.id into strict v_product_id
  from public.products p
  where p.canonical_name = 'Pitta Bread 6 Pack';

  select sp.id into strict v_store_product_id
  from public.store_products sp
  where sp.product_id = v_product_id
    and sp.store = 'tesco';

  select r.id into strict v_run_uuid
  from public.scrape_runs r
  where r.run_id = 'pepesto_tesco_discovery_20260922114211'
    and r.store = 'tesco'
    and r.retrieval_method = 'pepesto_candidate_discovery';

  if exists (
    select 1 from public.products
    where canonical_name = 'White Pitta Bread 6 Pack' and id <> v_product_id
  ) then
    raise exception 'White Pitta Bread 6 Pack already belongs to another canonical product';
  end if;

  select jsonb_build_object(
    'product_id', sp.product_id,
    'canonical_name', p.canonical_name,
    'canonical_brand', p.brand,
    'store_product_name', sp.store_product_name,
    'store_brand', sp.brand,
    'is_own_brand', sp.is_own_brand,
    'store_sku', sp.store_sku,
    'store_url', sp.store_url,
    'url_status', sp.url_status,
    'url_last_error', sp.url_last_error
  )
  into v_prior_mapping
  from public.store_products sp
  join public.products p on p.id = sp.product_id
  where sp.id = v_store_product_id
    and sp.product_id = v_product_id
    and sp.store = 'tesco'
  for update of sp;

  if v_prior_mapping is null then
    raise exception 'Expected audited Tesco pitta mapping was not found';
  end if;

  select e.id, e.created_at
  into v_candidate_id, v_candidate_created_at
  from public.tesco_candidate_discovery_evidence e
  where e.run_uuid = v_run_uuid
    and e.store_product_id = v_store_product_id
    and e.candidate_sku = '254945564'
    and e.candidate_url = 'https://www.tesco.ie/shop/en-IE/products/254945564'
    and e.candidate_name = 'Tesco White Plain Pitta Bread 6 Pack'
    and e.candidate_price_cents = 88
  for update;

  if v_candidate_id is null then
    raise exception 'Expected persisted white pitta candidate evidence was not found';
  end if;

  update public.products
  set canonical_name = 'White Pitta Bread 6 Pack'
  where id = v_product_id
    and canonical_name in ('Pitta Bread 6 Pack', 'White Pitta Bread 6 Pack');

  if not found then
    raise exception 'Expected pitta canonical identity was not found';
  end if;

  update public.list_items
  set canonical_name = 'White Pitta Bread 6 Pack'
  where canonical_name = 'Pitta Bread 6 Pack';

  update public.store_products
  set store_product_name = 'Tesco White Plain Pitta Bread 6 Pack',
      brand = 'Tesco',
      is_own_brand = true,
      store_sku = '254945564',
      store_url = 'https://www.tesco.ie/shop/en-IE/products/254945564',
      url_status = 'resolved',
      url_last_checked_at = v_candidate_created_at,
      url_last_error = null
  where id = v_store_product_id
    and product_id = v_product_id
    and store = 'tesco';

  insert into public.price_observations (
    store_product_id, price, was_price, on_promotion, observed_at, source
  )
  select v_store_product_id, 0.88, null, false, v_candidate_created_at, 'pepesto_search'
  where not exists (
    select 1 from public.price_observations po
    where po.store_product_id = v_store_product_id
      and po.observed_at = v_candidate_created_at
      and po.source = 'pepesto_search'
  );

  update public.tesco_candidate_discovery_evidence
  set classification = 'exact_replacement_candidate',
      reasons = '["candidate identity agrees with clarified white pitta canonical"]'::jsonb,
      identity_signals = identity_signals || '{"variantConflict":false,"canonicalTermsCovered":true}'::jsonb,
      selected_at = coalesce(selected_at, now())
  where id = v_candidate_id;

  update public.tesco_candidate_discovery_evidence
  set classification = 'material_mismatch',
      reasons = '["variantConflict"]'::jsonb,
      identity_signals = identity_signals || '{"variantConflict":true,"canonicalTermsCovered":false}'::jsonb,
      selected_at = null
  where run_uuid = v_run_uuid
    and store_product_id = v_store_product_id
    and candidate_sku = '254945610';

  insert into public.retailer_mapping_audit_decisions (
    decision_batch, store_product_id, store, classification, reason,
    evidence_source, prior_mapping, applied_action, applied_at
  ) values (
    'tesco-canonical-repair-2026-09-22-v1',
    v_store_product_id,
    'tesco',
    'exact_replacement_candidate',
    'SuperValu SKU 1972541000 identifies the canonical variant as white pitta; persisted Pepesto evidence uniquely corroborates Tesco white pitta SKU 254945564 and rejects wholemeal SKU 254945610',
    'cross_retailer_identity_plus_pepesto_candidate_evidence',
    v_prior_mapping || jsonb_build_object('candidate_evidence_id', v_candidate_id),
    'clarify_canonical_and_restore_exact_replacement',
    now()
  )
  on conflict (decision_batch, store_product_id) do nothing;
end;
$$;
