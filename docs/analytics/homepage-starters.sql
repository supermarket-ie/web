-- Homepage starter cohort, v2, trailing 30 days.
-- One visible impression per starter/version/session; at least half the button
-- must enter the viewport (a tap also proves visibility). Selections are taps.
-- Attribute downstream outcomes to the FIRST selected starter in a session.
-- This is observational session attribution, not a causal experiment. Rates for
-- recent cohorts are immature; allow up to seven days for a verified signup.
-- Normal email verification retains the original session even on another device.
-- Blocked analytics, cleared storage and a resent link from another browser can
-- leave gaps. Existing-account sign-ins are not new registrations.
with impressions as (
  select metadata->>'starter_id' as starter_id,
         metadata->>'starter_kind' as starter_kind,
         count(distinct session_id) as viewed_sessions
  from agent_events
  where event_type = 'starter_prompt_viewed'
    and metadata->>'starter_version' = '2'
    and created_at >= now() - interval '30 days'
    and nullif(session_id, '') is not null
  group by 1, 2
), first_selection as (
  select distinct on (session_id) session_id, created_at,
         metadata->>'starter_id' as starter_id,
         metadata->>'starter_kind' as starter_kind
  from agent_events
  where event_type = 'starter_prompt_selected'
    and metadata->>'starter_version' = '2'
    and created_at >= now() - interval '30 days'
    and nullif(session_id, '') is not null
  order by session_id, created_at, id
), outcomes as (
  select s.*,
    exists (
      select 1 from agent_events e
      where e.session_id = s.session_id and e.event_type = 'guest_shop_prepared'
        and e.created_at >= s.created_at
        and e.created_at <= s.created_at + interval '7 days'
    ) as prepared_shop,
    exists (
      select 1 from agent_events e
      where e.session_id = s.session_id and e.event_type = 'signup_completed'
        and e.metadata->>'verified' = 'true'
        and e.metadata->>'flow' = 'verified_email_continuation'
        and e.subscriber_id is not null
        and e.created_at >= s.created_at
        and e.created_at <= s.created_at + interval '7 days'
    ) as registered
  from first_selection s
), conversions as (
  select starter_id, starter_kind, count(*) as selected_sessions,
         count(*) filter (where prepared_shop) as shop_sessions,
         count(*) filter (where registered) as registrations
  from outcomes group by 1, 2
)
select i.starter_id, i.starter_kind, i.viewed_sessions,
       coalesce(c.selected_sessions, 0) as selected_sessions,
       coalesce(c.shop_sessions, 0) as shop_sessions,
       coalesce(c.registrations, 0) as verified_registrations,
       round(100.0 * coalesce(c.selected_sessions, 0) / nullif(i.viewed_sessions, 0), 1) as selection_pct,
       round(100.0 * coalesce(c.registrations, 0) / nullif(c.selected_sessions, 0), 1) as selected_to_registration_pct
from impressions i
left join conversions c using (starter_id, starter_kind)
order by verified_registrations desc, selected_sessions desc, viewed_sessions desc;
