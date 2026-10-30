-- Commissions (Admin → Finance → Commissions, My HR → My commissions), phase 3 of docs/kpi-plan.md: plans per
-- company (basis: invoice raised; tiers by % of the rep's period target; optional cap; clawback), who is on a
-- plan with what target, which Xero contact was sold by whom (attribution, with splits), and runs: a period's
-- invoices from Xero (or an uploaded CSV) credited to reps, with commission per line, approved by Finance and
-- marked paid. Approved runs feed the `sales_attributed` KPI source.
-- Read and written by the portal's server only (like the HR and KPI tables).

create table if not exists public.commission_plans (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  name text not null check (length(name) between 2 and 200),
  -- Commission is earned when the invoice is raised (Xero ACCREC invoices, AUTHORISED or PAID, by invoice date, ex GST).
  basis text not null default 'invoice_raised' check (basis in ('invoice_raised')),
  -- Marginal tiers by % of the rep's period target, e.g. [{"upTo":100,"rate":8},{"upTo":null,"rate":12}]:
  -- the part of credited revenue up to 100% of target earns 8%, the part above it 12%. The last tier has no upTo.
  tiers jsonb not null default '[{"upTo":100,"rate":8},{"upTo":null,"rate":12}]'::jsonb check (jsonb_typeof(tiers) = 'array'),
  -- Most a rep earns in one run (empty: no cap).
  cap numeric(18, 2) check (cap is null or cap >= 0),
  -- An invoice voided or credited after its run was approved is taken back in the next run.
  clawback boolean not null default true,
  active boolean not null default true,
  notes text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists commission_plans_entity_idx on public.commission_plans (entity_id);

-- Who is on a plan, from when to when, and their target for each run's period (A$, ex GST).
create table if not exists public.commission_assignments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.commission_plans (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  target numeric(18, 2) not null check (target > 0),
  starts_on date not null,
  ends_on date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index if not exists commission_assignments_plan_idx on public.commission_assignments (plan_id);
create index if not exists commission_assignments_person_idx on public.commission_assignments (person_id);

-- Who sold to whom (Xero can't hold it): a client (a Xero contact, or a contact name for CSV runs) credited to a
-- person, with a share. The shares for one client add up to 100 on any date (the portal checks it).
create table if not exists public.commission_attributions (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  xero_contact_id text,
  -- The contact's name when it was attributed (and how CSV invoices are matched).
  contact_name text not null check (length(contact_name) between 1 and 300),
  person_id uuid not null references public.people (id) on delete cascade,
  share numeric(6, 2) not null check (share > 0 and share <= 100),
  starts_on date not null,
  ends_on date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create index if not exists commission_attributions_entity_idx on public.commission_attributions (entity_id, xero_contact_id);
create index if not exists commission_attributions_person_idx on public.commission_attributions (person_id);

-- A company's commission for a period: all its plans, or one.
create table if not exists public.commission_runs (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  plan_id uuid references public.commission_plans (id) on delete restrict,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'paid')),
  source text not null default 'xero' check (source in ('xero', 'upload')),
  -- What the run was built from: the period's invoices, and the latest status of earlier runs' invoices (clawback).
  invoices jsonb not null default '[]'::jsonb,
  earlier jsonb not null default '[]'::jsonb,
  upload_name text,
  fetched_at timestamptz,
  built_by uuid references auth.users (id) on delete set null,
  built_at timestamptz,
  -- Sent to Finance for approval; building it again takes it back.
  submitted_by uuid references auth.users (id) on delete set null,
  submitted_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  paid_by uuid references auth.users (id) on delete set null,
  paid_at timestamptz,
  notes text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);
create index if not exists commission_runs_entity_idx on public.commission_runs (entity_id, period_start desc);

-- A run's lines: an invoice credited to a rep (their share), or taken back (clawback). No person: an invoice
-- nobody is credited with yet (unattributed), to fix before approval.
create table if not exists public.commission_run_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.commission_runs (id) on delete cascade,
  person_id uuid references public.people (id) on delete set null,
  plan_id uuid references public.commission_plans (id) on delete set null,
  kind text not null default 'earned' check (kind in ('earned', 'clawback')),
  invoice_id text not null,
  invoice_number text not null default '',
  contact_id text,
  contact_name text not null default '',
  invoice_date date not null,
  -- The invoice's amount excluding GST (net of credit notes already on it), in A$.
  amount numeric(18, 2) not null,
  share numeric(6, 2) not null default 100,
  credited numeric(18, 2) not null default 0,
  -- The rate it earned (%, blended when a line spans two tiers).
  rate numeric(8, 4) not null default 0,
  commission numeric(18, 2) not null default 0,
  note text not null default '',
  sort int not null default 0
);
create index if not exists commission_run_lines_run_idx on public.commission_run_lines (run_id, person_id);
create index if not exists commission_run_lines_person_idx on public.commission_run_lines (person_id);
create index if not exists commission_run_lines_invoice_idx on public.commission_run_lines (invoice_id);

alter table public.commission_plans enable row level security;
alter table public.commission_assignments enable row level security;
alter table public.commission_attributions enable row level security;
alter table public.commission_runs enable row level security;
alter table public.commission_run_lines enable row level security;
revoke all on public.commission_plans, public.commission_assignments, public.commission_attributions, public.commission_runs, public.commission_run_lines from anon, authenticated;

-- The KPI that takes its result from approved runs: revenue credited to the person in the run.
insert into public.kpi_definitions (id, entity_id, name, description, unit, direction, aggregation, family, source) values
  ('6b700000-0000-4000-8000-000000000109', null, 'Sales credited (A$)', 'Revenue credited to the person in approved commission runs (invoices raised, excluding GST, their share). Filled in automatically when Finance approves a run.', 'aud', 'higher', 'sum', 'revenue', 'sales_attributed')
on conflict (id) do nothing;
