-- The Presenter (phase 4 of the board assistant): Lex presents a deck at a
-- directors' meeting, slide by slide, on behalf of the CFO or the Chief Risk
-- Officer, in its own voice, with the slides on the room screen. A deck is
-- either drafted by Lex from the company's records or uploaded as a PDF (Lex
-- writes what to say for each page); people edit and approve it before it can
-- be presented. The meeting's presentation state lets the room screen follow
-- the tablet. Read and written by the portal's server only; PDFs in the
-- "legal" bucket under {entity}/meetings/{meeting}/decks/.

create table public.board_decks (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.board_meetings (id) on delete cascade,
  entity_id uuid not null references public.entities (id) on delete cascade,
  role text not null check (role in ('cfo', 'cro', 'other')),
  title text not null check (length(title) between 2 and 200),
  source text not null check (source in ('drafted', 'uploaded')),
  -- [{title, points: [..], figures: [{label, value, note}], notes, page}] — page: the PDF page for an uploaded deck
  slides jsonb not null default '[]',
  file_path text,
  status text not null default 'draft' check (status in ('preparing', 'draft', 'approved', 'failed')),
  error text,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  presented_at timestamptz,
  cost_usd numeric not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index board_decks_meeting_idx on public.board_decks (meeting_id, created_at);

-- What the room screen shows: {deck_id, slide, state: presenting|paused|answering|done, at}
alter table public.board_meetings add column presentation jsonb;

alter table public.board_decks enable row level security;
revoke all on public.board_decks from anon, authenticated;
