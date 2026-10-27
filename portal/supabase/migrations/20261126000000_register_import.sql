-- Importing the company secretary's register of members (the PDF report "Current
-- register of members as at …"). The register is the legal record of who holds
-- what; these tables remember how its names and classes map to the portal's,
-- so the next register of the same company is matched without asking, and keep
-- a record of each register imported. Read and written by the server only.

-- A name as it appears on a company's register, and the portal holder it is.
-- name_key: the name, beneficial trust and ACN, tidied (lib/register-pdf.mjs).
create table public.register_names (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  name_key text not null,
  register_name text not null,
  beneficially_for text,
  acn text,
  address text,
  entered_on date,
  holder_id uuid not null references public.holders (id) on delete cascade,
  updated_at timestamptz not null default now(),
  unique (entity_id, name_key)
);
create index register_names_holder on public.register_names (holder_id);
alter table public.register_names enable row level security;

-- A class code on a company's register (ORD, F, OPTS…) and the portal's class.
create table public.register_classes (
  entity_id uuid not null references public.entities (id) on delete cascade,
  register_code text not null,
  register_name text,
  share_class_id uuid not null references public.share_classes (id) on delete cascade,
  primary key (entity_id, register_code)
);
alter table public.register_classes enable row level security;

-- Each register imported: its date, totals and the PDF (private storage).
create table public.register_imports (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  as_at date not null,
  company_name text,
  company_number text,
  file_name text,
  file_path text,
  file_sha256 text not null,
  holders integer not null,
  holdings integer not null,
  movements integer not null,
  totals jsonb not null default '{}',
  imported_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index register_imports_entity on public.register_imports (entity_id, as_at desc);
alter table public.register_imports enable row level security;
