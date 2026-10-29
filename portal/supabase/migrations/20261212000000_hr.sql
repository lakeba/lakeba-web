-- HR (Admin → HR, and each employee's "My HR"): people, equity plans and
-- option grants with vesting, onboarding and offboarding checklists, policies
-- employees accept, and employee documents. A new permission area "hr" (see,
-- do, approve) for a new built-in HR role given per company; Admins have it.
-- Employees get a portal account without a role and see only their own
-- grants, documents and policies. Pay, leave and tax details stay in the
-- payroll system. Read and written by the portal's server only; files in the
-- "legal" bucket under {entity}/hr/.

create table public.people (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  full_name text not null check (length(full_name) between 2 and 200),
  email text,
  user_id uuid references public.profiles (id) on delete set null,
  job_title text not null default '',
  team text not null default '',
  employment_type text not null default 'full_time' check (employment_type in ('full_time', 'part_time', 'casual', 'contractor', 'advisor')),
  manager_id uuid references public.people (id) on delete set null,
  location text not null default '',
  start_date date,
  end_date date,
  status text not null default 'onboarding' check (status in ('onboarding', 'active', 'offboarding', 'left')),
  -- Date of birth, home address, phone, emergency contact: sealed (secret-box.ts).
  private_sealed text,
  notes text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index people_entity_idx on public.people (entity_id, status);
create index people_user_idx on public.people (user_id);

-- Onboarding and offboarding tasks for a person.
create table public.person_tasks (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  kind text not null check (kind in ('onboarding', 'offboarding')),
  sort int not null default 0,
  title text not null,
  who text not null default 'hr' check (who in ('hr', 'manager', 'it', 'employee')),
  due_on date,
  done_at timestamptz,
  done_by uuid references auth.users (id) on delete set null
);
create index person_tasks_person_idx on public.person_tasks (person_id, kind, sort);

-- Contracts, letters and other documents about a person.
create table public.person_documents (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  title text not null,
  kind text not null default 'other' check (kind in ('contract', 'letter', 'review', 'grant', 'other')),
  file_path text not null,
  file_name text not null,
  size_bytes bigint not null default 0,
  -- Shown to the employee in My HR, or kept for HR only.
  visible_to_employee boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index person_documents_person_idx on public.person_documents (person_id);

-- Equity plans and grants.
create table public.equity_plans (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  name text not null check (length(name) between 3 and 200),
  kind text not null default 'options' check (kind in ('options', 'rights', 'shares')),
  share_class_id uuid references public.share_classes (id) on delete set null,
  pool_size bigint not null default 0 check (pool_size >= 0),
  adopted_on date,
  -- Usual terms for new grants.
  vesting_months int not null default 48 check (vesting_months between 0 and 240),
  cliff_months int not null default 12 check (cliff_months between 0 and 240),
  frequency text not null default 'monthly' check (frequency in ('monthly', 'quarterly', 'annually')),
  expiry_years int not null default 10 check (expiry_years between 1 and 30),
  -- Lapse unvested when someone leaves; vested ones may be exercised within this many days.
  leaver_exercise_days int not null default 90 check (leaver_exercise_days between 0 and 3650),
  rules_path text,
  notes text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.equity_grants (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.equity_plans (id) on delete cascade,
  entity_id uuid not null references public.entities (id) on delete cascade,
  person_id uuid references public.people (id) on delete set null,
  holder_name text not null,
  number bigint not null check (number > 0),
  exercise_price numeric(14, 6) not null default 0,
  grant_date date not null,
  vesting_start date not null,
  vesting_months int not null check (vesting_months between 0 and 240),
  cliff_months int not null check (cliff_months between 0 and 240),
  frequency text not null check (frequency in ('monthly', 'quarterly', 'annually')),
  expiry_date date not null,
  -- draft: being prepared; granted; cancelled (before vesting); lapsed (all that can't be exercised any more).
  status text not null default 'draft' check (status in ('draft', 'granted', 'cancelled', 'lapsed')),
  -- When the holder left: vesting stops at this date; vested ones may be exercised until exercise_by.
  vesting_stopped_on date,
  exercise_by date,
  board_paper_id uuid references public.board_papers (id) on delete set null,
  letter_path text,
  accepted_at timestamptz,
  notes text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index equity_grants_plan_idx on public.equity_grants (plan_id, status);
create index equity_grants_person_idx on public.equity_grants (person_id);

create table public.equity_exercises (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.equity_grants (id) on delete cascade,
  number bigint not null check (number > 0),
  -- requested (by the holder or HR), approved (shares to be issued), issued, rejected.
  status text not null default 'requested' check (status in ('requested', 'approved', 'issued', 'rejected')),
  amount_payable numeric(14, 2) not null default 0,
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  issued_on date,
  note text not null default ''
);
create index equity_exercises_grant_idx on public.equity_exercises (grant_id);

-- Policies (for a company, or the whole group when entity_id is null) and who accepted which version.
create table public.policies (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.entities (id) on delete cascade,
  title text not null check (length(title) between 3 and 200),
  body text not null default '',
  file_path text,
  version int not null default 1,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  requires_ack boolean not null default true,
  published_at timestamptz,
  ack_due_days int not null default 14,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.policy_acks (
  policy_id uuid not null references public.policies (id) on delete cascade,
  version int not null,
  person_id uuid not null references public.people (id) on delete cascade,
  acked_at timestamptz not null default now(),
  primary key (policy_id, version, person_id)
);

-- HR Ask: staff questions answered from published policies.
create table public.hr_ask_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  question text not null,
  answer text not null default '',
  sources jsonb not null default '[]',
  cost_usd numeric(10, 5) not null default 0,
  created_at timestamptz not null default now()
);

alter table public.people enable row level security;
alter table public.person_tasks enable row level security;
alter table public.person_documents enable row level security;
alter table public.equity_plans enable row level security;
alter table public.equity_grants enable row level security;
alter table public.equity_exercises enable row level security;
alter table public.policies enable row level security;
alter table public.policy_acks enable row level security;
alter table public.hr_ask_log enable row level security;
revoke all on public.people, public.person_tasks, public.person_documents, public.equity_plans, public.equity_grants, public.equity_exercises, public.policies, public.policy_acks, public.hr_ask_log from anon, authenticated;

insert into public.roles (key, name, description, builtin) values
  ('hr', 'HR', 'Looks after a company''s people: employees, onboarding and leaving, equity grants, policies and employee documents.', true)
on conflict (key) do nothing;
insert into public.role_permissions (role_key, permission) values
  ('hr', 'hr.view'), ('hr', 'hr.do'), ('hr', 'hr.approve'),
  ('admin', 'hr.view'), ('admin', 'hr.do'), ('admin', 'hr.approve')
on conflict do nothing;
