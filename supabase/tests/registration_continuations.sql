-- Run in an isolated test database after the migration. All fixtures roll back.
begin;
set local role service_role;
do $$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  handoff_id uuid := gen_random_uuid();
  expired_id uuid := gen_random_uuid();
  restored jsonb;
  again jsonb;
begin
  assert not has_table_privilege('anon', 'public.registration_continuations', 'SELECT');
  assert not has_table_privilege('authenticated', 'public.registration_continuations', 'SELECT');
  assert not has_table_privilege('anon', 'public.registration_continuations', 'INSERT');
  assert not has_function_privilege('anon', 'public.claim_registration_continuation(uuid,text,text,uuid)', 'EXECUTE');
  assert not has_function_privilege('authenticated', 'public.claim_registration_continuation(uuid,text,text,uuid)', 'EXECUTE');
  assert has_function_privilege('service_role', 'public.claim_registration_continuation(uuid,text,text,uuid)', 'EXECUTE');
  assert (select relrowsecurity from pg_class where oid = 'public.registration_continuations'::regclass);

  insert into public.subscribers(id,email,family_size,unsubscribe_token)
    values (owner_id,'continuation-owner@example.invalid','3','test-owner'), (other_id,'continuation-other@example.invalid','5','test-other');
  insert into public.registration_continuations(id,email_hash,payload,expires_at)
    values (handoff_id,'owner-hash','{"title":"Guest shop","messages":[{"role":"user","content":"Milk quantity 3"}],"profile":{"eve_state":{"events":[],"resumeContext":"Budget 25; two adults, one child"}},"kind":"shop","analyticsSessionId":"isolated-test"}',now() + interval '30 minutes'),
    (expired_id,'owner-hash','{}',now() - interval '1 minute');

  assert public.claim_registration_continuation(handoff_id,'wrong-hash','continuation-owner@example.invalid',owner_id) is null;
  assert public.claim_registration_continuation(handoff_id,'owner-hash','continuation-owner@example.invalid',other_id) is null;
  assert public.claim_registration_continuation(expired_id,'owner-hash','continuation-owner@example.invalid',owner_id) is null;
  assert (select count(*) from public.conversations where subscriber_id=owner_id)=0;

  restored := public.claim_registration_continuation(handoff_id,'owner-hash','continuation-owner@example.invalid',owner_id);
  again := public.claim_registration_continuation(handoff_id,'owner-hash','continuation-owner@example.invalid',owner_id);
  assert restored->>'conversation_id' is not null;
  assert restored = again;
  assert (select count(*) from public.conversations where subscriber_id=owner_id)=1;
  assert (select payload is null from public.registration_continuations where id=handoff_id);
  assert (select count(*) from public.agent_events where subscriber_id=owner_id and event_type='registration_continuation_restored')=1;
  assert public.claim_registration_continuation(handoff_id,'owner-hash','continuation-other@example.invalid',other_id) is null;

  insert into public.saved_lists(subscriber_id,source_shop_key) values(owner_id,'same-proposal');
  begin
    insert into public.saved_lists(subscriber_id,source_shop_key) values(owner_id,'same-proposal');
    raise exception 'Duplicate save was accepted';
  exception when unique_violation then null;
  end;
  insert into public.saved_lists(subscriber_id,source_shop_key) values(other_id,'same-proposal');
end;
$$;
rollback;
