-- KPI automation (phase 4 of docs/kpi-plan.md): the daily refresh of automatic results (`policies_accepted`,
-- `onboarding_done`) and off-track alerts. An automatic source keeps one result per scorecard item
-- (source_ref 'auto'), refreshed each morning; an off-track item is alerted at most once every 14 days.
-- Read and written by the portal's server only (like the other KPI tables). Safe to run again.

-- When HR and the manager were last told this item is off track (the daily job waits 14 days before again).
alter table public.kpi_scorecard_items add column if not exists off_track_alerted_at timestamptz;

-- One automatic result per item and source: the daily refresh replaces it rather than adding another.
create unique index if not exists kpi_results_auto_idx on public.kpi_results (item_id, source) where source_ref = 'auto';

-- The seeded "Policies accepted" KPI now fills itself in (unless HR already chose another source for it).
update public.kpi_definitions
  set source = 'policies_accepted',
      description = 'Share of the person’s required company policies (current versions) they have accepted in My HR. Filled in automatically each morning.',
      aggregation = 'last'
  where id = '6b700000-0000-4000-8000-000000000108' and source = 'manual';

-- And one for new starters: how much of their onboarding checklist is done.
insert into public.kpi_definitions (id, entity_id, name, description, unit, direction, aggregation, family, source) values
  ('6b700000-0000-4000-8000-000000000110', null, 'Onboarding done', 'Share of the person’s onboarding checklist that is done (Admin → People). Filled in automatically each morning.', 'percent', 'higher', 'last', 'compliance', 'onboarding_done')
on conflict (id) do nothing;
