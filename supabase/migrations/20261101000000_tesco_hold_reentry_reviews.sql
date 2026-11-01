-- Operator-audited, one-use Tesco hold re-entry. This migration is deliberately
-- inert until separately approved/deployed: no holds, mappings, gates or prices
-- are changed by its installation.
create table public.tesco_hold_reentry_reviews (
  id uuid primary key default gen_random_uuid(),
  store_product_id uuid not null references public.store_products(id),
  source_page_id uuid not null references public.tesco_direct_collection_pages(id),
  evidence_snapshot jsonb not null,
  -- Human assessment of exact Tesco identity, independent of how many
  -- competing retailers currently have fresh prices.
  independent_reason text not null check(length(trim(independent_reason)) >= 30),
  -- Identity is bound from the verified Supabase Auth JWT by a trigger below,
  -- never accepted as a caller-supplied reviewer name.
  reviewer_id uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  expires_at timestamptz not null,
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
-- repeat review for the same SKU is a new record, never an edited approval.
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
revoke all on public.tesco_hold_reentry_reviews from public, anon, authenticated, service_role;
revoke all on public.tesco_hold_reentry_revocations from public, anon, authenticated;
revoke all on public.tesco_hold_reentry_uses from public, anon, authenticated;

-- One authenticated, accountably privileged reviewer signs one immutable
-- snapshot via Supabase's JWT-verified PostgREST/Data API connection. A normal
-- authenticated person without the server-controlled app_metadata permission
-- cannot insert. A privileged collector service-role connection can read
-- approvals but cannot create one through this exposed table.
create function public.bind_tesco_reentry_review_actor() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if auth.uid() is null
     or coalesce(auth.jwt() #>> '{app_metadata,tesco_reentry_reviewer}', 'false') <> 'true'
  then raise exception 'authenticated_tesco_reentry_reviewer_required'; end if;
  new.reviewer_id := auth.uid();
  new.approved_at := now();
  return new;
end $$;
create trigger tesco_hold_review_bind_actor before insert on public.tesco_hold_reentry_reviews
  for each row execute function public.bind_tesco_reentry_review_actor();
revoke all on function public.bind_tesco_reentry_review_actor() from public, anon, authenticated, service_role;

create policy tesco_hold_review_authenticated_insert on public.tesco_hold_reentry_reviews
  for insert to authenticated with check (
    reviewer_id = (select auth.uid())
    and coalesce((select auth.jwt()) #>> '{app_metadata,tesco_reentry_reviewer}', 'false') = 'true'
  );
create policy tesco_hold_review_owner_select on public.tesco_hold_reentry_reviews
  for select to authenticated using (reviewer_id = (select auth.uid()));
grant insert, select on public.tesco_hold_reentry_reviews to authenticated;
grant select on public.tesco_hold_reentry_reviews to service_role;
-- No INSERT grant is given to the service_role collector. The database owner
-- remains the ultimate administrator; these grants guard normal API roles.
