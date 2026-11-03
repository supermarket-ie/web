-- Per-offer pair decisions are distinct from canonical store-product mappings.
-- No application or service-role approval write path is introduced.
-- Protected operator inserts only, with immutable source/evidence assertions.
CREATE TABLE public.retailer_offer_pair_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  left_offer_id uuid NOT NULL REFERENCES public.store_products(id),
  right_offer_id uuid NOT NULL REFERENCES public.store_products(id),
  classification text NOT NULL CHECK (classification IN
    ('exact_product','comparable_alternative','not_comparable','unverified')),
  left_source_kind text CHECK (left_source_kind IN ('tesco_page','retailer_response')),
  left_source_id uuid,
  left_source_hash text CHECK (left_source_hash ~ '^[a-f0-9]{64}$'),
  left_captured_at timestamptz,
  right_source_kind text CHECK (right_source_kind IN ('tesco_page','retailer_response')),
  right_source_id uuid,
  right_source_hash text CHECK (right_source_hash ~ '^[a-f0-9]{64}$'),
  right_captured_at timestamptz,
  rationale text NOT NULL CHECK (length(trim(rationale)) >= 12),
  reviewer text NOT NULL CHECK (length(trim(reviewer)) >= 3),
  model_assessment jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(model_assessment)='object'),
  checked_attributes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(checked_attributes)='array'),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pair_order CHECK (left_offer_id::text < right_offer_id::text),
  CONSTRAINT positive_decision_has_both_sources CHECK (
    classification IN ('unverified','not_comparable') OR
    (left_source_kind IS NOT NULL AND left_source_id IS NOT NULL AND left_source_hash IS NOT NULL
     AND left_captured_at IS NOT NULL AND right_source_kind IS NOT NULL
     AND right_source_id IS NOT NULL AND right_source_hash IS NOT NULL AND right_captured_at IS NOT NULL
     AND jsonb_array_length(checked_attributes) >= 3)
  )
);
CREATE INDEX retailer_offer_pair_reviews_lookup
  ON public.retailer_offer_pair_reviews(left_offer_id,right_offer_id,reviewed_at DESC);

-- SECURITY INVOKER, no RLS bypass. A protected postgres operator is the only
-- role able to insert. Direct source rows must still bind to the exact offer.
CREATE FUNCTION public.validate_offer_pair_review() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $body$
DECLARE
  side record;
  mapped record;
  valid_capture boolean;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'comparison reviews are immutable'; END IF;
  IF NEW.reviewed_at > now() OR NEW.reviewed_at < now() - interval '14 days' THEN
    RAISE EXCEPTION 'comparison review timestamp invalid';
  END IF;
  IF (SELECT store FROM public.store_products WHERE id=NEW.left_offer_id) =
     (SELECT store FROM public.store_products WHERE id=NEW.right_offer_id) THEN
    RAISE EXCEPTION 'pair must represent different retailers';
  END IF;
  FOR side IN
    SELECT NEW.left_offer_id AS offer_id,NEW.left_source_kind AS kind,
           NEW.left_source_id AS source_id,NEW.left_source_hash AS hash,
           NEW.left_captured_at AS captured_at
    UNION ALL
    SELECT NEW.right_offer_id,NEW.right_source_kind,
           NEW.right_source_id,NEW.right_source_hash,NEW.right_captured_at
  LOOP
    IF side.source_id IS NULL THEN
      IF NEW.classification IN ('exact_product','comparable_alternative') THEN
        RAISE EXCEPTION 'positive comparison missing direct capture';
      END IF;
      CONTINUE;
    END IF;
    SELECT store,store_sku INTO mapped FROM public.store_products WHERE id=side.offer_id;
    valid_capture := false;
    IF mapped.store='tesco' AND side.kind='tesco_page' THEN
      SELECT EXISTS(
        SELECT 1 FROM public.tesco_direct_collection_pages p
        WHERE p.id=side.source_id AND p.outcome='ok' AND p.http_status=200
          AND p.body_sha256=side.hash AND p.created_at=side.captured_at
          AND (strpos(p.requested_url,mapped.store_sku)>0 OR strpos(p.final_url,mapped.store_sku)>0)
      ) INTO valid_capture;
    ELSIF mapped.store IN ('dunnes','supervalu') AND side.kind='retailer_response' THEN
      SELECT EXISTS(
        SELECT 1 FROM public.retailer_identity_responses e
        WHERE e.id=side.source_id AND e.store_product_id=side.offer_id
          AND e.store=mapped.store AND e.sku=mapped.store_sku
          AND e.source_kind='captured_product'
          AND e.body_sha256=side.hash AND e.retrieved_at=side.captured_at
      ) INTO valid_capture;
    END IF;
    IF NOT valid_capture THEN RAISE EXCEPTION 'comparison evidence does not bind to offer'; END IF;
    IF side.captured_at > now() OR side.captured_at < now() - interval '14 days' THEN
      RAISE EXCEPTION 'comparison capture outside evidence horizon';
    END IF;
  END LOOP;
  RETURN NEW;
END $body$;
CREATE TRIGGER validate_offer_pair_review
  BEFORE INSERT OR UPDATE OR DELETE ON public.retailer_offer_pair_reviews
  FOR EACH ROW EXECUTE FUNCTION public.validate_offer_pair_review();

ALTER TABLE public.retailer_offer_pair_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retailer_offer_pair_reviews FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.retailer_offer_pair_reviews TO service_role;
REVOKE ALL ON FUNCTION public.validate_offer_pair_review() FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON TABLE public.retailer_offer_pair_reviews IS
  'Immutable independent pairwise review; no automatic classification or price promotion. Inserting requires protected postgres operator credentials.';
