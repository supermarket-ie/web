-- Restore three demanded Tesco identities that are deterministic from existing
-- cross-retailer mappings and persisted Pepesto evidence. No external request
-- or new observation time is created by this migration.
do $$
declare
  v_run_uuid uuid;
  v_row record;
  v_prior_mapping jsonb;
begin
  select r.id into strict v_run_uuid
  from public.scrape_runs r
  where r.run_id = 'pepesto_tesco_discovery_20260922114211'
    and r.store = 'tesco'
    and r.retrieval_method = 'pepesto_candidate_discovery';

  for v_row in
    select p.id as product_id, p.canonical_name, sp.id as store_product_id,
           e.id as evidence_id, e.candidate_name, e.candidate_sku,
           e.candidate_url, e.candidate_price_cents, e.created_at
    from public.products p
    join public.store_products sp on sp.product_id = p.id and sp.store = 'tesco'
    join public.tesco_candidate_discovery_evidence e
      on e.store_product_id = sp.id and e.run_uuid = v_run_uuid
    where (p.canonical_name, e.candidate_sku) in (
      ('Loose Pink Lady Apples 1 Pack', '284182372'),
      ('Loose Aubergines 1 Pack', '266344796')
    )
      and e.candidate_price_cents > 0
      and coalesce(e.raw_candidate #>> '{quantity,pieces}', '0')::integer = 1
      and e.candidate_url = 'https://www.tesco.ie/shop/en-IE/products/' || e.candidate_sku
  loop
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
    ) into v_prior_mapping
    from public.store_products sp
    join public.products p on p.id = sp.product_id
    where sp.id = v_row.store_product_id
    for update of sp;

    if v_prior_mapping is null then
      raise exception 'Expected audited Tesco mapping was not found for %', v_row.canonical_name;
    end if;

    update public.store_products
    set store_product_name = v_row.candidate_name,
        brand = 'Tesco',
        is_own_brand = true,
        store_sku = v_row.candidate_sku,
        store_url = v_row.candidate_url,
        url_status = 'resolved',
        url_last_checked_at = v_row.created_at,
        url_last_error = null
    where id = v_row.store_product_id
      and url_status = 'failed'
      and url_last_error like 'tesco_mapping_audit:%';

    if not found then
      raise exception 'Audited Tesco mapping guard did not match for %', v_row.canonical_name;
    end if;

    insert into public.price_observations (
      store_product_id, price, was_price, on_promotion, observed_at, source
    )
    select v_row.store_product_id, v_row.candidate_price_cents::numeric / 100,
           null, false, v_row.created_at, 'pepesto_search'
    where not exists (
      select 1 from public.price_observations po
      where po.store_product_id = v_row.store_product_id
        and po.observed_at = v_row.created_at
        and po.source = 'pepesto_search'
    );

    update public.tesco_candidate_discovery_evidence
    set classification = 'exact_replacement_candidate',
        reasons = '["cross-retailer identity and structured single-piece quantity agree"]'::jsonb,
        identity_signals = identity_signals ||
          '{"canonicalTermsCovered":true,"packCountConflict":false,"measureConflict":false}'::jsonb,
        selected_at = coalesce(selected_at, now())
    where id = v_row.evidence_id;

    insert into public.retailer_mapping_audit_decisions (
      decision_batch, store_product_id, store, classification, reason,
      evidence_source, prior_mapping, applied_action, applied_at
    ) values (
      'tesco-demand-identity-repair-2026-09-22-v2',
      v_row.store_product_id,
      'tesco',
      'exact_replacement_candidate',
      'Dunnes/SuperValu identity plus persisted Pepesto pieces=1 evidence establishes the exact loose single-item Tesco SKU',
      'cross_retailer_identity_plus_pepesto_structured_quantity',
      v_prior_mapping || jsonb_build_object('candidate_evidence_id', v_row.evidence_id),
      'restore_exact_replacement',
      now()
    )
    on conflict (decision_batch, store_product_id) do nothing;
  end loop;

  if not exists (
    select 1 from public.retailer_mapping_audit_decisions
    where decision_batch = 'tesco-demand-identity-repair-2026-09-22-v2'
    group by decision_batch having count(*) = 2
  ) then
    raise exception 'Expected exactly two structured-quantity Tesco repairs';
  end if;
end;
$$;

do $$
declare
  v_product_id uuid;
  v_store_product_id uuid;
  v_observed_at timestamptz;
  v_prior_mapping jsonb;
begin
  select p.id into strict v_product_id
  from public.products p
  where p.canonical_name = 'Dr. Oetker Bistro Pepperoni Pizza 2 Pack';

  select sp.id into strict v_store_product_id
  from public.store_products sp
  where sp.product_id = v_product_id
    and sp.store = 'tesco'
    and sp.store_sku = '260285673'
    and sp.store_product_name = 'Dr Oetker Bistro Pepperoni Baguette 250g';

  select max(po.observed_at) into v_observed_at
  from public.price_observations po
  where po.store_product_id = v_store_product_id
    and po.source = 'pepesto_search'
    and po.price > 0;

  if v_observed_at is null then
    raise exception 'Expected persisted Pepesto price for Dr. Oetker pepperoni baguettes';
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
  ) into v_prior_mapping
  from public.store_products sp
  join public.products p on p.id = sp.product_id
  where sp.id = v_store_product_id
  for update of sp;

  update public.products
  set canonical_name = 'Dr. Oetker Bistro Pepperoni Baguettes 2 Pack 250g',
      default_quantity = '250.0',
      default_unit = 'g'
  where id = v_product_id
    and canonical_name = 'Dr. Oetker Bistro Pepperoni Pizza 2 Pack';

  if not found then
    raise exception 'Expected Dr. Oetker pepperoni canonical was not found';
  end if;

  update public.list_items
  set canonical_name = 'Dr. Oetker Bistro Pepperoni Baguettes 2 Pack 250g'
  where canonical_name = 'Dr. Oetker Bistro Pepperoni Pizza 2 Pack';

  update public.store_products
  set brand = 'Dr. Oetker',
      is_own_brand = false,
      url_status = 'resolved',
      url_last_checked_at = v_observed_at,
      url_last_error = null
  where id = v_store_product_id
    and url_status = 'failed'
    and url_last_error like 'tesco_mapping_audit:%';

  if not found then
    raise exception 'Audited Dr. Oetker Tesco mapping guard did not match';
  end if;

  insert into public.retailer_mapping_audit_decisions (
    decision_batch, store_product_id, store, classification, reason,
    evidence_source, prior_mapping, applied_action, applied_at
  ) values (
    'tesco-demand-identity-repair-2026-09-22-v2',
    v_store_product_id,
    'tesco',
    'exact_replacement_candidate',
    'Dunnes and Tesco retailer identities agree that the branded two-pack is pepperoni baguettes totalling 250g; the prior canonical used pizza as the product type',
    'cross_retailer_identity_plus_prior_pepesto_observation',
    v_prior_mapping,
    'clarify_canonical_and_restore_exact_mapping',
    now()
  )
  on conflict (decision_batch, store_product_id) do nothing;
end;
$$;
