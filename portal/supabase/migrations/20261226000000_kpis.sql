-- KPIs and reviews (Admin → People → Performance, My HR → My performance and My team), phases 1 and 2 of
-- docs/kpi-plan.md: a library of KPI definitions and role sets, periods per company, goals (with team goals
-- under them), scorecards for one person and one period with weighted items, results (Finance proposes, HR
-- confirms; only confirmed ones count), check-ins and the end-of-period review with a 1–5 rating.
-- Commissions, automatic sources and dashboards come later: definitions and results carry a `source`
-- ('manual' for now) and results a `source_ref`, so an automatic source can write its own without changes.
-- Read and written by the portal's server only (like the other HR tables); evidence files in the "legal"
-- bucket under {entity}/hr/kpis/.

-- What a KPI measures. No company: offered to every company (group-wide).
create table if not exists public.kpi_definitions (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.entities (id) on delete cascade,
  name text not null check (length(name) between 2 and 200),
  description text not null default '',
  unit text not null default 'count' check (unit in ('aud', 'percent', 'count', 'days', 'hours', 'score')),
  direction text not null default 'higher' check (direction in ('higher', 'lower')),
  -- How a period's results add up: their sum, their average, or the latest one.
  aggregation text not null default 'sum' check (aggregation in ('sum', 'average', 'last')),
  family text not null default 'other' check (family in ('revenue', 'delivery', 'engineering', 'customer', 'compliance', 'other')),
  -- 'manual', or an automatic source (later: sales_attributed, policies_accepted, onboarding_done…).
  source text not null default 'manual',
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kpi_definitions_entity_idx on public.kpi_definitions (entity_id);

-- A named bundle of definitions with default weights ("Sales rep", "Developer").
create table if not exists public.kpi_role_sets (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.entities (id) on delete cascade,
  name text not null check (length(name) between 2 and 200),
  description text not null default '',
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kpi_role_sets_entity_idx on public.kpi_role_sets (entity_id);

create table if not exists public.kpi_role_set_items (
  role_set_id uuid not null references public.kpi_role_sets (id) on delete cascade,
  definition_id uuid not null references public.kpi_definitions (id) on delete cascade,
  weight numeric(6, 2) not null default 0 check (weight between 0 and 100),
  sort int not null default 0,
  primary key (role_set_id, definition_id)
);

-- A month, quarter or year for a company.
create table if not exists public.kpi_periods (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  label text not null check (length(label) between 2 and 100),
  kind text not null default 'quarter' check (kind in ('month', 'quarter', 'year')),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'planning' check (status in ('planning', 'open', 'closed')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (entity_id, label)
);
create index if not exists kpi_periods_entity_idx on public.kpi_periods (entity_id, starts_on desc);

-- A company goal for a period; team goals point at the company goal they serve.
create table if not exists public.kpi_goals (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  period_id uuid not null references public.kpi_periods (id) on delete cascade,
  parent_id uuid references public.kpi_goals (id) on delete cascade,
  title text not null check (length(title) between 2 and 300),
  description text not null default '',
  team text not null default '',
  target numeric(18, 4),
  unit text check (unit in ('aud', 'percent', 'count', 'days', 'hours', 'score')),
  sort int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists kpi_goals_period_idx on public.kpi_goals (period_id, parent_id);

-- One person, one period.
create table if not exists public.kpi_scorecards (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  period_id uuid not null references public.kpi_periods (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  -- draft (HR sets it up) → active (the person sees it) → in_review (end of period) → signed_off.
  status text not null default 'draft' check (status in ('draft', 'active', 'in_review', 'signed_off')),
  role_set_id uuid references public.kpi_role_sets (id) on delete set null,
  activated_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (period_id, person_id)
);
create index if not exists kpi_scorecards_person_idx on public.kpi_scorecards (person_id);
create index if not exists kpi_scorecards_entity_idx on public.kpi_scorecards (entity_id, status);

-- A KPI on a scorecard: its target, weight (a scorecard's add up to 100) and thresholds, in the KPI's unit.
create table if not exists public.kpi_scorecard_items (
  id uuid primary key default gen_random_uuid(),
  scorecard_id uuid not null references public.kpi_scorecards (id) on delete cascade,
  -- Definitions are archived, never deleted, once they are on a scorecard.
  definition_id uuid not null references public.kpi_definitions (id) on delete restrict,
  goal_id uuid references public.kpi_goals (id) on delete set null,
  target numeric(18, 4),
  weight numeric(6, 2) not null default 0 check (weight between 0 and 100),
  -- Under "below" (over it, when lower is better) the item is off track; at "stretch" it's beyond target.
  below numeric(18, 4),
  stretch numeric(18, 4),
  note text not null default '',
  sort int not null default 0
);
create index if not exists kpi_scorecard_items_scorecard_idx on public.kpi_scorecard_items (scorecard_id, sort);
create index if not exists kpi_scorecard_items_definition_idx on public.kpi_scorecard_items (definition_id);

-- A value for an item. Only confirmed results count; Finance proposes, HR confirms (or enters directly).
create table if not exists public.kpi_results (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.kpi_scorecard_items (id) on delete cascade,
  value numeric(18, 4) not null,
  as_of date not null,
  -- 'manual', or the automatic source that wrote it; source_ref: that source's own key (e.g. a run id).
  source text not null default 'manual',
  source_ref text,
  note text not null default '',
  evidence_path text,
  status text not null default 'confirmed' check (status in ('proposed', 'confirmed')),
  proposed_by uuid references auth.users (id) on delete set null,
  proposed_at timestamptz,
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists kpi_results_item_idx on public.kpi_results (item_id, as_of);
create index if not exists kpi_results_proposed_idx on public.kpi_results (status) where status = 'proposed';

-- Dated comments on a scorecard (HR, the manager or the person); private ones are for HR and managers only.
create table if not exists public.kpi_checkins (
  id uuid primary key default gen_random_uuid(),
  scorecard_id uuid not null references public.kpi_scorecards (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  author_role text not null default 'hr' check (author_role in ('hr', 'manager', 'employee')),
  body text not null check (length(body) between 1 and 4000),
  private boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists kpi_checkins_scorecard_idx on public.kpi_checkins (scorecard_id, created_at);

-- The end-of-period review: self and manager assessments, the agreed 1–5 rating, HR sign-off, acknowledgement.
create table if not exists public.kpi_reviews (
  scorecard_id uuid primary key references public.kpi_scorecards (id) on delete cascade,
  self_text text not null default '',
  self_rating int check (self_rating between 1 and 5),
  self_by uuid references auth.users (id) on delete set null,
  self_at timestamptz,
  manager_text text not null default '',
  manager_rating int check (manager_rating between 1 and 5),
  manager_by uuid references auth.users (id) on delete set null,
  manager_at timestamptz,
  agreed_rating int check (agreed_rating between 1 and 5),
  signed_off_by uuid references auth.users (id) on delete set null,
  signed_off_at timestamptz,
  acknowledged_at timestamptz,
  employee_comment text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.kpi_definitions enable row level security;
alter table public.kpi_role_sets enable row level security;
alter table public.kpi_role_set_items enable row level security;
alter table public.kpi_periods enable row level security;
alter table public.kpi_goals enable row level security;
alter table public.kpi_scorecards enable row level security;
alter table public.kpi_scorecard_items enable row level security;
alter table public.kpi_results enable row level security;
alter table public.kpi_checkins enable row level security;
alter table public.kpi_reviews enable row level security;
revoke all on public.kpi_definitions, public.kpi_role_sets, public.kpi_role_set_items, public.kpi_periods, public.kpi_goals, public.kpi_scorecards,
  public.kpi_scorecard_items, public.kpi_results, public.kpi_checkins, public.kpi_reviews from anon, authenticated;

-- A starting library (group-wide), changeable in Admin → People → Performance → Library.
insert into public.kpi_definitions (id, entity_id, name, description, unit, direction, aggregation, family) values
  ('6b700000-0000-4000-8000-000000000101', null, 'New revenue', 'Revenue from new sales in the period, excluding GST.', 'aud', 'higher', 'sum', 'revenue'),
  ('6b700000-0000-4000-8000-000000000102', null, 'New customers', 'Customers won in the period.', 'count', 'higher', 'sum', 'revenue'),
  ('6b700000-0000-4000-8000-000000000103', null, 'Roadmap items shipped', 'Roadmap items shipped, as a share of those committed for the period.', 'percent', 'higher', 'last', 'delivery'),
  ('6b700000-0000-4000-8000-000000000104', null, 'Tasks done on time', 'Share of assigned tasks finished by their due date.', 'percent', 'higher', 'average', 'delivery'),
  ('6b700000-0000-4000-8000-000000000105', null, 'Production incidents', 'Incidents in production caused by changes the person shipped.', 'count', 'lower', 'sum', 'engineering'),
  ('6b700000-0000-4000-8000-000000000106', null, 'Customer response time', 'Average hours to a first reply to a customer.', 'hours', 'lower', 'average', 'customer'),
  ('6b700000-0000-4000-8000-000000000107', null, 'Customer satisfaction', 'Average customer rating out of 10.', 'score', 'higher', 'average', 'customer'),
  ('6b700000-0000-4000-8000-000000000108', null, 'Policies accepted', 'Share of the person’s required company policies accepted.', 'percent', 'higher', 'last', 'compliance')
on conflict (id) do nothing;

insert into public.kpi_role_sets (id, entity_id, name, description) values
  ('6b700000-0000-4000-8000-000000000201', null, 'Sales rep', 'Winning new revenue and customers.'),
  ('6b700000-0000-4000-8000-000000000202', null, 'Developer', 'Shipping the roadmap reliably.'),
  ('6b700000-0000-4000-8000-000000000203', null, 'Account manager', 'Looking after existing customers and growing them.'),
  ('6b700000-0000-4000-8000-000000000204', null, 'Operations', 'Getting the day-to-day done on time.')
on conflict (id) do nothing;

insert into public.kpi_role_set_items (role_set_id, definition_id, weight, sort) values
  ('6b700000-0000-4000-8000-000000000201', '6b700000-0000-4000-8000-000000000101', 50, 0),
  ('6b700000-0000-4000-8000-000000000201', '6b700000-0000-4000-8000-000000000102', 30, 1),
  ('6b700000-0000-4000-8000-000000000201', '6b700000-0000-4000-8000-000000000106', 10, 2),
  ('6b700000-0000-4000-8000-000000000201', '6b700000-0000-4000-8000-000000000108', 10, 3),
  ('6b700000-0000-4000-8000-000000000202', '6b700000-0000-4000-8000-000000000103', 50, 0),
  ('6b700000-0000-4000-8000-000000000202', '6b700000-0000-4000-8000-000000000104', 30, 1),
  ('6b700000-0000-4000-8000-000000000202', '6b700000-0000-4000-8000-000000000105', 10, 2),
  ('6b700000-0000-4000-8000-000000000202', '6b700000-0000-4000-8000-000000000108', 10, 3),
  ('6b700000-0000-4000-8000-000000000203', '6b700000-0000-4000-8000-000000000107', 40, 0),
  ('6b700000-0000-4000-8000-000000000203', '6b700000-0000-4000-8000-000000000106', 30, 1),
  ('6b700000-0000-4000-8000-000000000203', '6b700000-0000-4000-8000-000000000101', 20, 2),
  ('6b700000-0000-4000-8000-000000000203', '6b700000-0000-4000-8000-000000000108', 10, 3),
  ('6b700000-0000-4000-8000-000000000204', '6b700000-0000-4000-8000-000000000104', 50, 0),
  ('6b700000-0000-4000-8000-000000000204', '6b700000-0000-4000-8000-000000000106', 30, 1),
  ('6b700000-0000-4000-8000-000000000204', '6b700000-0000-4000-8000-000000000108', 20, 2)
on conflict do nothing;
