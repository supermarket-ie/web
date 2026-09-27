-- Temporary email-bound guest handoffs. Only the application's service role
-- can stage or claim them; browser-facing subscriber sessions are not Supabase JWTs.
create table public.registration_continuations (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null,
  payload jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_by uuid references public.subscribers(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  check (payload is null or octet_length(payload::text) <= 1000000)
);
create index registration_continuations_expiry_idx on public.registration_continuations(expires_at);
alter table public.registration_continuations enable row level security;
revoke all on public.registration_continuations from public, anon, authenticated;
grant select, insert, update, delete on public.registration_continuations to service_role;

create function public.claim_registration_continuation(
  p_id uuid, p_email_hash text, p_email text, p_subscriber_id uuid
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  pending public.registration_continuations%rowtype;
  chat_id uuid;
begin
  if not exists (select 1 from public.subscribers where id = p_subscriber_id and lower(email) = lower(p_email)) then
    return null;
  end if;
  select * into pending from public.registration_continuations
    where id = p_id and email_hash = p_email_hash and expires_at > now() for update;
  if not found then return null; end if;
  if pending.claimed_by is not null then
    if pending.claimed_by <> p_subscriber_id then return null; end if;
    return jsonb_build_object('conversation_id', pending.conversation_id);
  end if;
  insert into public.conversations(subscriber_id, title, messages, profile)
    values (p_subscriber_id, pending.payload->>'title', pending.payload->'messages', pending.payload->'profile')
    returning id into chat_id;
  update public.registration_continuations
    set claimed_by = p_subscriber_id, conversation_id = chat_id, payload = null where id = p_id;
  insert into public.agent_events(event_type, session_id, subscriber_id, metadata)
    values ('registration_continuation_restored', pending.payload->>'analyticsSessionId', p_subscriber_id,
      jsonb_build_object('flow', 'verified_email_continuation', 'kind', pending.payload->>'kind'));
  return jsonb_build_object('conversation_id', chat_id);
end;
$$;
revoke all on function public.claim_registration_continuation(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_registration_continuation(uuid, text, text, uuid) to service_role;

-- One grounded save per account/proposal even across devices and repeated links.
alter table public.saved_lists add column source_shop_key text;
create unique index saved_lists_source_shop_key_idx on public.saved_lists(subscriber_id, source_shop_key);
