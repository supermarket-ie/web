-- Operator-audited, one-use Tesco hold re-entry. This migration is deliberately
-- inert until separately approved/deployed: no holds, mappings, gates or prices
-- are changed by its installation.
create table public.tesco_hold_reentry_reviews (
  id uuid primary key default gen_random_uuid(),
  store_product_id uuid not null references public.store_products(id),
  source_page_id uuid not null references public.tesco_direct_collection_pages(id),
  evidence_snapshot jsonb not null,
  -- Human assessment of canonical identity, supported by the exact retained
  -- source page and both fresh retailer peers in evidence_snapshot.
  independent_reason text not null check(length(trim(independent_reason)) >= 30),
  assessed_by text not null check(length(trim(assessed_by)) >= 3),
  approved_by text not null check(length(trim(approved_by)) >= 3),
  approved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint distinct_reentry_reviewers check(assessed_by <> approved_by),
  constraint bounded_reentry_approval check(expires_at > approved_at and expires_at <= approved_at + interval '14 days'),
  constraint structured_reentry_snapshot check(jsonb_typeof(evidence_snapshot) = 'object')
);

create table public.tesco_hold_reentry_revocations (
  review_id uuid primary key references public.tesco_hold_reentry_reviews(id),
  revoked_by text not null check(length(trim(revoked_by)) >= 3),
  reason text not null check(length(trim(reason)) >= 10),
  revoked_at timestamptz not null default now()
);

create table public.tesco_hold_reentry_uses (
  review_id uuid primary key references public.tesco_hold_reentry_reviews(id),
  run_id uuid not null references public.scrape_runs(id),
  used_at timestamptz not null default now()
);

-- All three tables are append-only, including approvals and revocations. A
-- second review for the same SKU is a new record, never an edited approval.
create function public.prevent_tesco_reentry_audit_rewrite() returns trigger
language plpgsql as $$ begin raise exception 'reentry_audit_append_only'; end $$;
create trigger tesco_reentry_review_immutable before update or delete on public.tesco_hold_reentry_reviews
  for each row execute function public.prevent_tesco_reentry_audit_rewrite();
create trigger tesco_reentry_revocation_immutable before update or delete on public.tesco_hold_reentry_revocations
  for each row execute function public.prevent_tesco_reentry_audit_rewrite();
create trigger tesco_reentry_use_immutable before update or delete on public.tesco_hold_reentry_uses
  for each row execute function public.prevent_tesco_reentry_audit_rewrite();

create index tesco_hold_reentry_reviews_product_idx on public.tesco_hold_reentry_reviews(store_product_id);
alter table public.tesco_hold_reentry_reviews enable row level security;
alter table public.tesco_hold_reentry_revocations enable row level security;
alter table public.tesco_hold_reentry_uses enable row level security;
revoke all on public.tesco_hold_reentry_reviews from public, anon, authenticated;
revoke all on public.tesco_hold_reentry_revocations from public, anon, authenticated;
revoke all on public.tesco_hold_reentry_uses from public, anon, authenticated;
-- The operator SQL bridge uses the privileged connection it already uses for
-- the supervised runner. No browser/API-facing role may approve or use a review.
