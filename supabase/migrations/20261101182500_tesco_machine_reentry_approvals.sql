-- Machine identity for independently corroborated Tesco hold re-entry.
-- Adds no approvals, changes no holds/mappings/prices, and never grants
-- service_role the right to mint a review through the Data API.
alter table public.tesco_hold_reentry_reviews
  add column approval_kind text not null default 'human'
    check (approval_kind in ('human','machine')),
  add column machine_assessment jsonb,
  add constraint tesco_machine_approval_evidence check (
    (approval_kind='human' and machine_assessment is null)
    or (approval_kind='machine'
      and jsonb_typeof(machine_assessment)='object'
      and machine_assessment->>'decision'='verified_exact'
      and length(trim(coalesce(machine_assessment->>'model','')))>=3
      and length(trim(coalesce(machine_assessment->>'reason','')))>=30
      and length(trim(coalesce(machine_assessment->>'source','')))>=5
      and machine_assessment #> '{validation,independently_exact}' = 'true'::jsonb
      and machine_assessment->>'mapping_id'=store_product_id::text
      and machine_assessment->>'source_page_id'=source_page_id::text
      and machine_assessment->>'source_body_sha256'=
        evidence_snapshot #>> '{page,body_sha256}')
  );

-- The Auth service principal is a real, separate account, not an alias for a
-- human. Only a server-admin-controlled app_metadata claim grants this very
-- narrow INSERT authority. Both actor ID and kind are derived from the JWT,
-- not from caller-controlled JSON. A principal carrying both flags is denied.
create or replace function public.bind_tesco_reentry_review_actor() returns trigger
language plpgsql set search_path=''
as $$
declare
  human_allowed boolean;
  machine_allowed boolean;
begin
  if auth.uid() is null then
    raise exception 'authenticated_tesco_reentry_approver_required';
  end if;
  human_allowed := coalesce(auth.jwt() #>> '{app_metadata,tesco_reentry_reviewer}','false')='true';
  machine_allowed := coalesce(auth.jwt() #>> '{app_metadata,tesco_reentry_machine_approver}','false')='true';
  if not human_allowed and not machine_allowed then
    raise exception 'authenticated_tesco_reentry_reviewer_required';
  end if;
  if human_allowed and machine_allowed then
    raise exception 'exactly_one_tesco_reentry_approval_role_required';
  end if;
  new.reviewer_id := auth.uid();
  new.approved_at := now();
  new.approval_kind := case when machine_allowed then 'machine' else 'human' end;
  return new;
end $$;

drop policy tesco_hold_review_authenticated_insert on public.tesco_hold_reentry_reviews;
create policy tesco_hold_review_authenticated_insert on public.tesco_hold_reentry_reviews
  for insert to authenticated with check (
    reviewer_id=(select auth.uid())
    and (
      (approval_kind='human' and
        coalesce((select auth.jwt()) #>> '{app_metadata,tesco_reentry_reviewer}','false')='true'
        and coalesce((select auth.jwt()) #>> '{app_metadata,tesco_reentry_machine_approver}','false')<>'true')
      or
      (approval_kind='machine' and
        coalesce((select auth.jwt()) #>> '{app_metadata,tesco_reentry_machine_approver}','false')='true'
        and coalesce((select auth.jwt()) #>> '{app_metadata,tesco_reentry_reviewer}','false')<>'true')
    )
  );

comment on column public.tesco_hold_reentry_reviews.approval_kind is
  'JWT-derived human or separately authenticated machine actor; never client selected.';
comment on column public.tesco_hold_reentry_reviews.machine_assessment is
  'Machine decision provenance and independently revalidated evidence; NOT permission to skip live finalisation.';
