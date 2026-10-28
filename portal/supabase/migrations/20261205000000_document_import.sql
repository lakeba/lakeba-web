-- Importing many documents at once (Admin → Documents → Import documents): Lakeba AI reads each
-- file and suggests its company, name, category, date and audience; an admin checks them before
-- anything becomes a document. Written and read by the portal's server only (service role).

alter type public.document_category add value if not exists 'financials' before 'governance';
alter type public.document_category add value if not exists 'board_papers' after 'governance';

-- The date the document is about (year end, meeting day); imported documents are published under it.
alter table public.documents add column if not exists document_date date;

create table public.document_imports (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  -- Company chosen for every file, or null for "Lakeba AI works it out".
  entity_id uuid references public.entities (id) on delete cascade,
  -- financials_audience, use_in_ask, share_with_group, publish ('draft' | 'quiet')
  settings jsonb not null default '{}',
  status text not null default 'open' check (status in ('open', 'imported', 'discarded')),
  finished_at timestamptz
);

create table public.document_import_items (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.document_imports (id) on delete cascade,
  created_at timestamptz not null default now(),
  file_name text not null,
  folder text not null default '',
  file_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  pages int,
  -- Where the text for search and Lakeba AI came from: the PDF itself, Lakeba AI reading the scan, or none.
  text_source text not null default 'none' check (text_source in ('text', 'ocr', 'none')),
  chunks jsonb not null default '[]',
  status text not null default 'ready' check (status in ('ready', 'error', 'imported')),
  error text,
  -- What Lakeba AI suggested, and what the admin chose (same fields).
  suggested jsonb not null default '{}',
  chosen jsonb not null default '{}',
  include boolean not null default true,
  notes text[] not null default '{}',
  cost_usd numeric(10, 5) not null default 0,
  document_id uuid references public.documents (id) on delete set null
);
create index document_import_items_import_idx on public.document_import_items (import_id, created_at);

alter table public.document_imports enable row level security;
alter table public.document_import_items enable row level security;
