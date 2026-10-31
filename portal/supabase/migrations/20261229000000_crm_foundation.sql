-- CRM, phase 1 (docs/crm.md): people and companies held once for the whole group, each venture's
-- relationship with them, pipelines and stages per venture, deals with their buying group, tasks, notes,
-- custom fields and the activity timeline. A new permission area "crm" (see, do, approve) with built-in
-- roles Sales (see and do) and Sales lead (also approve: discounts, every deal of the venture); Admins
-- have it. A venture switches the CRM on (entities.crm_enabled) and may give it its own address
-- (crm_domain, e.g. crm.doxai.com). Read and written by the portal's server only, like HR.

alter table public.entities
  add column crm_enabled boolean not null default false,
  add column crm_domain text,
  add column crm_domain_verified_at timestamptz,
  -- Group totals and the forecast are shown in this currency; each deal keeps its own.
  add column crm_currency text not null default 'AUD' check (crm_currency ~ '^[A-Z]{3}$');
create unique index entities_crm_domain_idx on public.entities (lower(crm_domain)) where crm_domain is not null;

-- People: one record for the whole group (what a venture knows about them is in crm_relationships).
create table public.crm_people (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(full_name) between 1 and 200),
  email text check (email is null or email = lower(email)),
  other_emails text[] not null default '{}',
  phone text not null default '',
  mobile text not null default '',
  job_title text not null default '',
  company_id uuid,
  linkedin_url text not null default '',
  city text not null default '',
  country text not null default '',
  timezone text not null default '',
  -- Their portal account, when they have one (an investor, a staff member).
  profile_id uuid references public.profiles (id) on delete set null,
  -- Where the record came from (manual, import, email, form, hubspot…) and ids in other systems, so imports can run again.
  source text not null default 'manual',
  external_ids jsonb not null default '{}',
  merged_into uuid references public.crm_people (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index crm_people_email_idx on public.crm_people (email) where email is not null and merged_into is null;
create index crm_people_company_idx on public.crm_people (company_id);
create index crm_people_name_idx on public.crm_people (lower(full_name));
create index crm_people_profile_idx on public.crm_people (profile_id);

create table public.crm_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  -- The company's web domain (harbourlogistics.com): matches people by their email address.
  domain text check (domain is null or domain = lower(domain)),
  country text not null default '',
  city text not null default '',
  industry text not null default '',
  size_band text not null default '' check (size_band in ('', '1-10', '11-50', '51-200', '201-1000', '1000+')),
  phone text not null default '',
  linkedin_url text not null default '',
  parent_id uuid references public.crm_companies (id) on delete set null,
  source text not null default 'manual',
  external_ids jsonb not null default '{}',
  merged_into uuid references public.crm_companies (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index crm_companies_domain_idx on public.crm_companies (domain) where domain is not null and merged_into is null;
create index crm_companies_name_idx on public.crm_companies (lower(name));
alter table public.crm_people add constraint crm_people_company_fk foreign key (company_id) references public.crm_companies (id) on delete set null;

-- A venture's tie to a person or a company: what they are to it, who owns the relationship, its Xero contact.
create table public.crm_relationships (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  person_id uuid references public.crm_people (id) on delete cascade,
  company_id uuid references public.crm_companies (id) on delete cascade,
  kind text not null default 'lead' check (kind in ('lead', 'prospect', 'customer', 'former_customer', 'partner', 'supplier', 'investor', 'student', 'university', 'other')),
  owner_id uuid references public.profiles (id) on delete set null,
  -- 0–100, from recent contact (lib/crm.ts warmth()).
  warmth int not null default 0 check (warmth between 0 and 100),
  xero_contact_id text,
  -- May other ventures see that this venture knows them (only once both ventures switch sharing on, phase 6).
  shareable boolean not null default true,
  tags text[] not null default '{}',
  fields jsonb not null default '{}',
  last_contact_at timestamptz,
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((person_id is null) <> (company_id is null))
);
create unique index crm_relationships_person_idx on public.crm_relationships (entity_id, person_id) where person_id is not null;
create unique index crm_relationships_company_idx on public.crm_relationships (entity_id, company_id) where company_id is not null;
create index crm_relationships_owner_idx on public.crm_relationships (entity_id, owner_id);

create table public.crm_pipelines (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  -- deals: selling to a company; partners: partner organisations (MIST's universities); people: one person each (MIST's students).
  kind text not null default 'deals' check (kind in ('deals', 'partners', 'people')),
  sort int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index crm_pipelines_entity_idx on public.crm_pipelines (entity_id, sort);

create table public.crm_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.crm_pipelines (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  sort int not null default 0,
  -- open stages carry a chance of winning (%); won and lost close the deal.
  kind text not null default 'open' check (kind in ('open', 'won', 'lost')),
  chance int not null default 10 check (chance between 0 and 100),
  -- What must be true to move on (shown on the deal; the playbook, phase 5).
  exit_criteria text not null default '',
  -- A deal with no contact for this many days in this stage is going cold.
  cold_after_days int not null default 14 check (cold_after_days between 1 and 365)
);
create index crm_stages_pipeline_idx on public.crm_stages (pipeline_id, sort);

create table public.crm_deals (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  pipeline_id uuid not null references public.crm_pipelines (id) on delete restrict,
  stage_id uuid not null references public.crm_stages (id) on delete restrict,
  title text not null check (length(title) between 1 and 200),
  company_id uuid references public.crm_companies (id) on delete set null,
  person_id uuid references public.crm_people (id) on delete set null,
  owner_id uuid references public.profiles (id) on delete set null,
  amount numeric(14, 2) not null default 0 check (amount >= 0),
  currency text not null default 'AUD' check (currency ~ '^[A-Z]{3}$'),
  expected_close date,
  -- open, won (paid in Xero, or marked won), lost.
  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  won_at timestamptz,
  lost_at timestamptz,
  lost_reason text not null default '',
  next_step text not null default '',
  next_step_on date,
  -- Where it came from (referral, website, event, outbound, introduction…) and who referred it (a partner company, e.g. a university).
  source text not null default '',
  referred_by_company_id uuid references public.crm_companies (id) on delete set null,
  -- Lakeba AI's view of the chance (phase 3), next to the stage's.
  ai_chance int check (ai_chance between 0 and 100),
  ai_review jsonb,
  fields jsonb not null default '{}',
  external_ids jsonb not null default '{}',
  stage_changed_at timestamptz not null default now(),
  last_activity_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crm_deals_entity_idx on public.crm_deals (entity_id, status, stage_id);
create index crm_deals_owner_idx on public.crm_deals (owner_id, status);
create index crm_deals_company_idx on public.crm_deals (company_id);
create index crm_deals_person_idx on public.crm_deals (person_id);

-- The buying group: who is involved in a deal and their part in it.
create table public.crm_deal_people (
  deal_id uuid not null references public.crm_deals (id) on delete cascade,
  person_id uuid not null references public.crm_people (id) on delete cascade,
  part text not null default 'involved' check (part in ('champion', 'decides', 'influences', 'blocks', 'uses', 'involved')),
  primary key (deal_id, person_id)
);

create table public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  title text not null check (length(title) between 1 and 300),
  kind text not null default 'todo' check (kind in ('call', 'email', 'meeting', 'todo')),
  due_on date,
  owner_id uuid references public.profiles (id) on delete set null,
  deal_id uuid references public.crm_deals (id) on delete cascade,
  person_id uuid references public.crm_people (id) on delete cascade,
  company_id uuid references public.crm_companies (id) on delete cascade,
  done_at timestamptz,
  done_by uuid references auth.users (id) on delete set null,
  -- Suggested by Lakeba AI or a rule (phase 3), until someone keeps it.
  suggested boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index crm_tasks_owner_idx on public.crm_tasks (entity_id, owner_id, done_at, due_on);
create index crm_tasks_deal_idx on public.crm_tasks (deal_id);

-- Everything that happened, on a deal, person or company: notes typed by people, stage changes, and (phase 2 on)
-- emails, meetings, calls, WhatsApp messages, deal-room visits and Xero changes, each with a pointer to its source.
create table public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  kind text not null check (kind in ('note', 'stage', 'email', 'meeting', 'call', 'whatsapp', 'room', 'xero', 'quote', 'task', 'form', 'system')),
  -- in (from them), out (from us), or null.
  direction text check (direction in ('in', 'out')),
  subject text not null default '',
  body text not null default '',
  deal_id uuid references public.crm_deals (id) on delete cascade,
  person_id uuid references public.crm_people (id) on delete cascade,
  company_id uuid references public.crm_companies (id) on delete cascade,
  -- The mailbox message, meeting, Xero object… it came from (unique per venture, so it is filed once).
  source_ref text,
  meta jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index crm_activities_deal_idx on public.crm_activities (deal_id, occurred_at desc);
create index crm_activities_person_idx on public.crm_activities (person_id, occurred_at desc);
create index crm_activities_company_idx on public.crm_activities (company_id, occurred_at desc);
create unique index crm_activities_source_idx on public.crm_activities (entity_id, source_ref) where source_ref is not null;

-- A venture's own fields on deals, people and companies (values in each record's `fields`).
create table public.crm_fields (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  applies_to text not null check (applies_to in ('deal', 'person', 'company')),
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (length(label) between 1 and 80),
  type text not null default 'text' check (type in ('text', 'number', 'date', 'choice', 'yes_no')),
  choices text[] not null default '{}',
  sort int not null default 0,
  unique (entity_id, applies_to, key)
);

alter table public.crm_people enable row level security;
alter table public.crm_companies enable row level security;
alter table public.crm_relationships enable row level security;
alter table public.crm_pipelines enable row level security;
alter table public.crm_stages enable row level security;
alter table public.crm_deals enable row level security;
alter table public.crm_deal_people enable row level security;
alter table public.crm_tasks enable row level security;
alter table public.crm_activities enable row level security;
alter table public.crm_fields enable row level security;
revoke all on public.crm_people, public.crm_companies, public.crm_relationships, public.crm_pipelines, public.crm_stages, public.crm_deals,
  public.crm_deal_people, public.crm_tasks, public.crm_activities, public.crm_fields from anon, authenticated;

insert into public.roles (key, name, description, builtin) values
  ('sales', 'Sales', 'Sells for a company: its CRM, their own deals and the team''s pipeline, quotes and follow-ups.', true),
  ('sales_lead', 'Sales lead', 'Leads a company''s sales: every deal, the forecast, approving discounts and quotes.', true)
on conflict (key) do nothing;
insert into public.role_permissions (role_key, permission) values
  ('sales', 'crm.view'), ('sales', 'crm.do'),
  ('sales_lead', 'crm.view'), ('sales_lead', 'crm.do'), ('sales_lead', 'crm.approve'),
  ('admin', 'crm.view'), ('admin', 'crm.do'), ('admin', 'crm.approve')
on conflict do nothing;
