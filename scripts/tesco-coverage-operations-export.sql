-- Read-only companion to tesco-discovery-export.sql. Export the complete history;
-- never omit pending rows. Optional acquisition snapshots must come from the
-- existing acquisitionSnapshotSql helper, not hand-authored eligibility flags.
select jsonb_build_object(
  'requests', coalesce((select jsonb_agg(jsonb_build_object(
    'requested_url', requested_url, 'outcome', outcome, 'mode', mode) order by id)
    from public.tesco_direct_collection_pages), '[]'::jsonb),
  'acquisitions', '[]'::jsonb,
  'queryBudget', 10
) as operations;
