-- Legal and company secretary, phase 3 (Admin → Legal → Contracts): each
-- company's contracts, uploaded one at a time or many at once. Lakeba AI reads
-- the key terms; a person checks them; renewal and notice dates go on the
-- calendar. The text is kept (in pieces) for search and, later, Legal Ask.
-- Read and written by the portal's server only; files in the "legal" bucket.

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references public.entities (id) on delete cascade,
  title text not null check (length(title) between 2 and 300),
  counterparty text not null default '',
  contract_type text not null default 'other' check (contract_type in (
    'customer', 'supplier', 'services', 'employment', 'contractor', 'nda', 'lease', 'loan', 'investment', 'shareholders', 'licence', 'partnership', 'other')),
  -- draft: not signed yet; active; ended (expired or terminated).
  status text not null default 'active' check (status in ('draft', 'active', 'ended')),
  signed_on date,
  starts_on date,
  ends_on date,
  auto_renews boolean not null default false,
  renewal_term text not null default '',
  notice_days int check (notice_days between 0 and 3650),
  value text not null default '',
  governing_law text not null default '',
  change_of_control text not null default '',
  assignment text not null default '',
  exclusivity text not null default '',
  liability_cap text not null default '',
  termination text not null default '',
  obligations text not null default '',
  summary text not null default '',
  -- Points Lakeba AI thinks a lawyer should look at.
  flags text[] not null default '{}',
  owner_id uuid references public.profiles (id) on delete set null,
  notes text not null default '',
  -- The file, its text in pieces [{page, content}] and how it was read.
  file_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  pages int,
  text_source text not null default 'none' check (text_source in ('text', 'ocr', 'word', 'none')),
  chunks jsonb not null default '[]',
  -- What Lakeba AI read (the fields above start as it), and when a person checked them.
  suggested jsonb not null default '{}',
  ai_notes text[] not null default '{}',
  ai_cost_usd numeric(10, 5) not null default 0,
  checked_by uuid references auth.users (id) on delete set null,
  checked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index contracts_entity_idx on public.contracts (entity_id, status);
create index contracts_sha_idx on public.contracts (sha256);
create index contracts_ends_idx on public.contracts (ends_on) where status = 'active';

alter table public.contracts enable row level security;
revoke all on public.contracts from anon, authenticated;

-- Calendar items can now come from contracts.
alter table public.legal_obligations drop constraint legal_obligations_kind_check;
alter table public.legal_obligations add constraint legal_obligations_kind_check
  check (kind in ('annual_review', 'solvency', 'officer_change', 'address_change', 'share_issue', 'agm', 'financial_report', 'minutes', 'contract_notice', 'contract_end', 'other'));
