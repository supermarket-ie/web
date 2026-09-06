alter table public.scrape_runs
  add column if not exists pepesto_credits_before_cents integer,
  add column if not exists pepesto_credits_after_cents integer,
  add column if not exists pepesto_actual_cost_cents integer;

alter table public.scrape_runs
  drop constraint if exists scrape_runs_pepesto_credit_values_nonnegative;

alter table public.scrape_runs
  add constraint scrape_runs_pepesto_credit_values_nonnegative check (
    (pepesto_credits_before_cents is null or pepesto_credits_before_cents >= 0)
    and (pepesto_credits_after_cents is null or pepesto_credits_after_cents >= 0)
    and (pepesto_actual_cost_cents is null or pepesto_actual_cost_cents >= 0)
  );

comment on column public.scrape_runs.pepesto_actual_cost_cents is
  'Observed Pepesto spend calculated from credits before minus credits after submission; never an estimated tariff.';
