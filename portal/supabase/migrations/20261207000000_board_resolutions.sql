-- Legal and company secretary, phase 2 (Admin → Legal → a company → Board):
-- directors' resolutions from templates, board meetings with minutes drafted
-- by Lakeba AI from notes or a transcript, signing in the portal (after
-- two-step sign-in) and each company's minute book. Directors who don't use
-- the portal are invited to sign only. Read and written by the portal's
-- server only (service role); files in the private "legal" bucket.

create table public.board_meetings (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  title text not null check (length(title) between 3 and 200),
  held_at timestamptz not null,
  location text not null default '',
  -- [{officer_id?, name, role: 'director' | 'secretary' | 'guest', present: bool}]
  attendees jsonb not null default '[]',
  chair_officer_id uuid references public.company_officers (id) on delete set null,
  agenda text not null default '',
  notes text not null default '',
  -- A transcript (Teams, Zoom, Meet), as text, and where its file is.
  transcript text not null default '',
  transcript_path text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index board_meetings_entity_idx on public.board_meetings (entity_id, held_at desc);

-- Something directors sign: a resolution without a meeting, or a meeting's minutes.
create table public.board_papers (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  kind text not null check (kind in ('resolution', 'minutes')),
  meeting_id uuid references public.board_meetings (id) on delete cascade,
  template_key text,
  title text not null check (length(title) between 3 and 300),
  body text not null default '',
  status text not null default 'draft' check (status in ('draft', 'signing', 'signed', 'withdrawn')),
  -- A calendar item this settles (a solvency resolution, the minutes reminder).
  obligation_id uuid references public.legal_obligations (id) on delete set null,
  -- When sent for signing: the exact text signed (its PDF and fingerprint).
  pdf_path text,
  sha256 text,
  sent_at timestamptz,
  signed_at timestamptz,
  signed_pdf_path text,
  -- The signed copy filed in Documents (board only).
  document_id uuid references public.documents (id) on delete set null,
  ai_cost_usd numeric(10, 5) not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'minutes') = (meeting_id is not null))
);
create unique index board_papers_one_minutes on public.board_papers (meeting_id) where kind = 'minutes' and status <> 'withdrawn';
create index board_papers_entity_idx on public.board_papers (entity_id, created_at desc);

create table public.board_signatures (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.board_papers (id) on delete cascade,
  officer_id uuid references public.company_officers (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  name text not null,
  position text not null,
  status text not null default 'pending' check (status in ('pending', 'signed', 'declined')),
  -- What they typed, when, and the fingerprint of the text they signed.
  typed_name text,
  signed_at timestamptz,
  signed_sha256 text,
  how text,
  decline_note text not null default '',
  reminded_at timestamptz,
  unique (paper_id, officer_id)
);
create index board_signatures_user_idx on public.board_signatures (user_id, status);

alter table public.board_meetings enable row level security;
alter table public.board_papers enable row level security;
alter table public.board_signatures enable row level security;
revoke all on public.board_meetings, public.board_papers, public.board_signatures from anon, authenticated;

-- Calendar items can now be minutes to sign.
alter table public.legal_obligations drop constraint legal_obligations_kind_check;
alter table public.legal_obligations add constraint legal_obligations_kind_check
  check (kind in ('annual_review', 'solvency', 'officer_change', 'address_change', 'share_issue', 'agm', 'financial_report', 'minutes', 'other'));
