-- Accounting, phase 1: reporting packs. Each venture sends its profit and loss
-- and balance sheet on its own schedule (monthly or quarterly, due a set number
-- of days after period end). The figures are read into standard lines (from an
-- uploaded Excel or PDF by Lakeba AI, or later from Xero), checked by the
-- sender, then reviewed by Lakeba's finance team; the group view compares them.
-- New permission areas: "reporting" (a venture sends its packs; the new
-- built-in Finance role) and "accounting" (Lakeba's finance team, group only).
-- Read and written by the portal's server only; files in the "legal" bucket
-- under {entity}/reporting/.

create table public.reporting_schedules (
  entity_id uuid primary key references public.entities (id) on delete cascade,
  cadence text not null default 'monthly' check (cadence in ('monthly', 'quarterly')),
  -- Days after period end the pack is due.
  due_days int not null default 10 check (due_days between 1 and 120),
  -- The first period (its last day) packs are asked for.
  first_period date not null,
  currency text not null default 'AUD' check (currency ~ '^[A-Z]{3}$'),
  -- Month the financial year ends (6 = June): year to date counts from the month after.
  year_end_month int not null default 6 check (year_end_month between 1 and 12),
  active boolean not null default true,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.reporting_packs (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  period_end date not null,
  cadence text not null check (cadence in ('monthly', 'quarterly')),
  due_on date not null,
  -- open: waiting for the venture; submitted: with Lakeba; returned: Lakeba asked something; accepted.
  status text not null default 'open' check (status in ('open', 'submitted', 'returned', 'accepted')),
  -- {pl: {line: {period, ytd}}, bs: {line: value}} in the schedule's currency, whole units.
  figures jsonb not null default '{}',
  source text check (source in ('upload', 'xero', 'typed')),
  -- [{path, name, size}]
  files jsonb not null default '[]',
  ai_notes text[] not null default '{}',
  ai_cost_usd numeric(10, 5) not null default 0,
  -- The sender's commentary for the period.
  note text not null default '',
  submitted_by uuid references public.profiles (id) on delete set null,
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  reminded text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, period_end)
);
create index reporting_packs_status_idx on public.reporting_packs (status, due_on);

-- Questions and answers about a pack, between Lakeba's finance team and the venture.
create table public.reporting_pack_messages (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.reporting_packs (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);
create index reporting_pack_messages_idx on public.reporting_pack_messages (pack_id, created_at);

alter table public.reporting_schedules enable row level security;
alter table public.reporting_packs enable row level security;
alter table public.reporting_pack_messages enable row level security;
revoke all on public.reporting_schedules, public.reporting_packs, public.reporting_pack_messages from anon, authenticated;

-- The Finance role (given per venture), and the new permissions for the built-in roles.
insert into public.roles (key, name, description, builtin) values
  ('finance', 'Finance', 'Does a company''s books: sends its reporting packs (profit and loss, balance sheet) and answers Lakeba''s questions about them.', true)
on conflict (key) do nothing;
insert into public.role_permissions (role_key, permission) values
  ('finance', 'reporting.view'), ('finance', 'reporting.do'),
  ('admin', 'reporting.view'), ('admin', 'reporting.do'),
  ('admin', 'accounting.view'), ('admin', 'accounting.do'), ('admin', 'accounting.approve'),
  ('board', 'accounting.view'), ('compliance', 'accounting.view')
on conflict do nothing;
