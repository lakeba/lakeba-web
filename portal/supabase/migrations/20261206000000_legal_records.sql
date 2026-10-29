-- Legal and company secretary, phase 1 (Admin → Legal): each company's record,
-- its officers register and a calendar of what is due (ASIC notices, annual
-- review, AGM and financial report deadlines, anything added by hand).
-- A new permission area, "legal" (see, do, approve), for Lakeba's group roles
-- only at first. Read and written by the portal's server only (service role);
-- files in the private "legal" bucket, which has no policies.

-- ---------------------------------------------------------------------------
-- Company record (one per company; ASIC details, kept apart from entities,
-- which every member of a company can read)
-- ---------------------------------------------------------------------------
create table public.company_records (
  entity_id uuid primary key references public.entities (id) on delete cascade,
  acn text,
  abn text,
  company_type text check (company_type in ('proprietary', 'public')),
  incorporated_on date,
  -- State or territory of registration (NSW, VIC…)
  registered_in text,
  registered_office text,
  principal_place text,
  -- Financial year end and ASIC annual review date as MM-DD (review date: the registration anniversary unless ASIC changed it).
  year_end text check (year_end ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  review_date text check (review_date ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  auditor text,
  ultimate_holding text,
  constitution_document_id uuid references public.documents (id) on delete set null,
  notes text not null default '',
  -- The last ASIC extract read into this record.
  extract_path text,
  extract_dated date,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Officers register: directors, alternates and secretaries, with or without a
-- portal account. Private details (date and place of birth, residential
-- address, director ID) are sealed with the portal's key (secret-box.ts).
-- ---------------------------------------------------------------------------
create table public.company_officers (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  full_name text not null check (length(full_name) between 2 and 200),
  email text,
  user_id uuid references public.profiles (id) on delete set null,
  position text not null check (position in ('director', 'alternate_director', 'secretary')),
  appointed_on date,
  ceased_on date,
  consent_on date,
  consent_path text,
  private_sealed text,
  notes text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ceased_on is null or appointed_on is null or ceased_on >= appointed_on)
);
create index company_officers_entity_idx on public.company_officers (entity_id, position);

-- ---------------------------------------------------------------------------
-- What is due: created by the portal's rules (source_key, once each) or by hand.
-- ---------------------------------------------------------------------------
create table public.legal_obligations (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  kind text not null check (kind in ('annual_review', 'solvency', 'officer_change', 'address_change', 'share_issue', 'agm', 'financial_report', 'other')),
  title text not null check (length(title) between 3 and 300),
  detail text not null default '',
  due_on date not null,
  owner_id uuid references public.profiles (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'done', 'not_needed')),
  source_key text unique,
  -- A person moved the date: the rules no longer change it.
  date_kept boolean not null default false,
  done_on date,
  done_by uuid references auth.users (id) on delete set null,
  done_note text not null default '',
  proof_path text,
  -- Reminder stages already sent ('30', '7', '1', 'over:0', 'over:1'…).
  reminded text[] not null default '{}',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index legal_obligations_due_idx on public.legal_obligations (status, due_on);
create index legal_obligations_entity_idx on public.legal_obligations (entity_id, due_on);

-- An ASIC extract read by Lakeba AI, waiting to be checked and applied.
create table public.legal_extract_reads (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  file_path text not null,
  file_name text not null,
  suggested jsonb not null default '{}',
  cost_usd numeric(10, 5) not null default 0,
  status text not null default 'open' check (status in ('open', 'applied', 'discarded')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- A private calendar feed per person (Outlook, Google): only a hash of its token is kept.
create table public.legal_calendar_feeds (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now()
);

alter table public.company_records enable row level security;
alter table public.company_officers enable row level security;
alter table public.legal_obligations enable row level security;
alter table public.legal_extract_reads enable row level security;
alter table public.legal_calendar_feeds enable row level security;
revoke all on public.company_records, public.company_officers, public.legal_obligations, public.legal_extract_reads, public.legal_calendar_feeds from anon, authenticated;

insert into storage.buckets (id, name, public) values ('legal', 'legal', false) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- The "legal" permission area: Admin has it all, Legal sees, does and approves, Compliance sees.
-- ---------------------------------------------------------------------------
insert into public.role_permissions (role_key, permission) values
  ('admin', 'legal.view'), ('admin', 'legal.do'), ('admin', 'legal.approve'),
  ('legal', 'legal.view'), ('legal', 'legal.do'), ('legal', 'legal.approve'),
  ('compliance', 'legal.view')
on conflict do nothing;

update public.roles set description = 'Company secretary work (company records, officers, deadlines); reviews and approves documents, press releases and meeting materials; sees the register and the audit log.'
where key = 'legal';
