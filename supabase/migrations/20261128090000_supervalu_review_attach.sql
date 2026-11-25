-- SuperValu REVIEW-tier attach (owner authorised, 25 Nov 2026; policy barcode-review-ai-v1).
-- attach_barcode_supervalu_offer requires an ACTIVE STRONG association, which a review-tier match never is, and
-- accept_barcode_review_association needs the SuperValu offer to exist first. This function does both in ONE transaction:
-- the same checks as attach_barcode_supervalu_offer (SuperValu product URL for this SKU, SKU unowned, record has no SuperValu
-- offer, a direct SuperValu product-page capture bound to this SKU and URL within a day, title and brand from that capture),
-- except that the barcode requirement is the LATEST SuperValu observation being a review-tier resolution of exactly this SKU
-- from this Tesco origin (within 2 days), plus the review policy's AI (verified_exact, all seven facts) and deterministic checks.
-- It writes the offer, the retained capture, a catalogue_repairs row (policy barcode-review-ai-v1, association_basis ai_review)
-- and the acceptance row. Strong associations, barcode-exact-v1 and attach_barcode_supervalu_offer are unchanged.

create function public.attach_review_supervalu_offer(p_tesco_offer uuid, p_gtin text,
  p_sku text, p_url text, p_name text, p_brand text, p_response jsonb, p_model jsonb, p_checks jsonb, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare t record; offer uuid; repair uuid; run uuid; ob record; resp uuid; acc uuid; k text;
  g text := nullif(ltrim(btrim(coalesce(p_gtin, '')), '0'), '');
  own_label constant text := '^(dunnes( stores)?|supervalu|tesco|simply better|signature tastes)( |$)';
begin
  if p_gtin !~ '^[0-9]{8,14}$' or p_sku !~ '^[0-9]{5,14}$' or length(trim(coalesce(p_name, ''))) < 3
     or length(trim(coalesce(p_reason, ''))) < 40 or jsonb_typeof(p_checks) is distinct from 'object' then
    raise exception 'attach needs GTIN, SKU, name, reason and checks';
  end if;
  if p_url !~ ('^https://shop\.supervalu\.ie/sm/delivery/rsid/5550/product/[a-z0-9-]+-id-' || p_sku || '$') then
    raise exception 'not a SuperValu product URL for this SKU';
  end if;
  perform pg_advisory_xact_lock(hashtext('barcode-attach-supervalu:' || p_sku));
  select id, product_id, store, store_sku into t from public.store_products where id = p_tesco_offer for update;
  if t.id is null or t.store <> 'tesco' or t.product_id is null then raise exception 'not a Tesco offer on a record'; end if;
  perform 1 from public.products where id = t.product_id for update;
  -- REVIEW tier (never a strong association): the LATEST SuperValu observation for this GTIN is a review-tier resolution of
  -- exactly this SKU from this Tesco origin, recorded recently.
  select * into ob from public.retailer_barcode_observations x where ltrim(x.gtin, '0') = g and x.store = 'supervalu'
    order by x.observed_at desc, x.recorded_at desc limit 1;
  if ob.id is null or ob.tier is distinct from 'review' or ob.outcome <> 'identity_consistent' or ob.resolved_sku is distinct from p_sku
     or ob.gtin_origin_store_product_id is distinct from t.id or ob.gtin_origin_sku is distinct from t.store_sku then
    raise exception 'latest SuperValu observation is not a review-tier resolution of this SKU from this origin';
  end if;
  if ob.observed_at < now() - interval '2 days' then raise exception 'review observation too old for an attach'; end if;
  if p_brand is null or btrim(p_brand) = '' or p_brand ~* own_label or p_name ~* own_label then
    raise exception 'SuperValu brand missing or own-label';
  end if;
  -- Independent AI corroboration and the application's deterministic checks.
  if p_model->>'decision' is distinct from 'verified_exact' or jsonb_typeof(p_model->'facts') is distinct from 'object'
     or length(coalesce(p_model->>'rationale', '')) < 20 then
    raise exception 'AI assessment must be verified_exact with a rationale';
  end if;
  foreach k in array array['brand_matches', 'product_type_matches', 'flavour_formulation_matches', 'variant_matches', 'quantity_matches', 'pack_count_matches', 'age_stage_matches'] loop
    if (p_model->'facts'->>k) is distinct from 'true' then raise exception 'AI fact % is not true', k; end if;
  end loop;
  foreach k in array array['structural', 'wording_only', 'barcode_fresh_search'] loop
    if (p_checks->>k) is distinct from 'pass' then raise exception 'check % did not pass', k; end if;
  end loop;
  if exists (select 1 from public.store_products where store = 'supervalu' and store_sku = p_sku) then raise exception 'SKU already owned'; end if;
  if exists (select 1 from public.store_products where product_id = t.product_id and store = 'supervalu') then
    raise exception 'record already has a SuperValu offer';
  end if;
  -- The direct capture: SuperValu's own product page for this SKU, fetched at exactly this URL, recently.
  if p_response->>'sku' is distinct from p_sku or p_response->>'product_url' is distinct from p_url
     or p_response->>'requested_url' is distinct from p_url or p_response->>'final_url' is distinct from p_url
     or p_response->>'source_kind' is distinct from 'captured_product' or p_response->>'store' is distinct from 'supervalu'
     or p_response->>'retrieved_at' is null or p_response->>'parser_version' is distinct from 'retailer-identity-response-v3'
     or p_response->'identity'->>'title' is distinct from p_name
     or nullif(trim(coalesce(p_response->'identity'->>'brand', '')), '') is distinct from nullif(trim(coalesce(p_brand, '')), '')
     or (p_response->>'retrieved_at')::timestamptz < now() - interval '1 day' or (p_response->>'retrieved_at')::timestamptz > now() + interval '5 minutes'
     or length(coalesce(p_response->>'body_text', '')) = 0 or length(coalesce(p_response->'identity'->>'title', '')) = 0 then
    raise exception 'direct SuperValu capture missing or not bound to this SKU';
  end if;
  insert into public.store_products(product_id, store, store_sku, store_url, store_product_name, brand, is_own_brand, url_status)
    values (t.product_id, 'supervalu', p_sku, p_url, p_name, nullif(trim(coalesce(p_brand, '')), ''), false, 'resolved') returning id into offer;
  insert into public.scrape_runs(run_id, store, started_at, finished_at, target_count, attempted_count, fetched, extracted, inserted, unchanged_count, failed,
      retrieval_method, threshold_pct, status)
    values ('barcode_attach_supervalu_' || to_char(now(), 'YYYYMMDDHH24MISSMS'), 'supervalu', now(), now(), 1, 1, 1, 1, 0, 0, 0, 'vercel_direct_product_page', 0, 'success')
    returning id into run;
  insert into public.retailer_identity_responses(store, sku, product_url, requested_url, final_url, retrieved_at, content_type, body_text,
      parser_version, source_kind, source_path, identity, run_uuid, store_product_id)
    values ('supervalu', p_sku, p_url, p_url, p_url, (p_response->>'retrieved_at')::timestamptz, coalesce(p_response->>'content_type', 'text/html'),
      p_response->>'body_text', p_response->>'parser_version', 'captured_product', p_response->>'source_path', p_response->'identity', run, offer)
    returning id into resp;
  insert into public.catalogue_repairs(policy_version, kind, gtin, tesco_offer_id, to_product_id, created_offer_id, before_state, checks, reason)
    values ('barcode-review-ai-v1', 'attach_supervalu', ltrim(p_gtin, '0'), t.id, t.product_id, offer,
      jsonb_build_object('offers', (select jsonb_agg(to_jsonb(s.*)) from public.store_products s where s.product_id = t.product_id and s.id <> offer)),
      p_checks || jsonb_build_object('association_basis', 'ai_review'), p_reason) returning id into repair;
  -- The AI-accepted review association, bound to this observation, this offer and its capture (same rules as
  -- accept_barcode_review_association; the offer exists only inside this transaction).
  insert into public.retailer_barcode_review_acceptances(policy_version, gtin, store, sku, observation_id, origin_offer_id, retailer_offer_id,
      response_id, model_assessment, checks, reason)
    values ('barcode-review-ai-v1', ob.gtin, 'supervalu', p_sku, ob.id, t.id, offer, resp, p_model, p_checks, p_reason) returning id into acc;
  return offer;
end $$;
revoke all on function public.attach_review_supervalu_offer(uuid, text, text, text, text, text, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.attach_review_supervalu_offer(uuid, text, text, text, text, text, jsonb, jsonb, jsonb, text) to service_role;
