-- Lex, the board assistant in the room (phase 3): during a recorded meeting a
-- director says "Lex, …" or taps Ask on the Observer tablet; Lex answers aloud
-- in a few sentences (ElevenLabs voice) and shows the detail with sources,
-- using Board Ask with the meeting company's records. Each exchange is kept
-- with the meeting, shown on its page and given to the minutes, labelled as
-- the assistant's. Read and written by the portal's server only.

create table public.board_meeting_assistant (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.board_meetings (id) on delete cascade,
  asked_by uuid references auth.users (id) on delete set null,
  how text not null check (how in ('voice', 'tap', 'typed')),
  -- Milliseconds into the recording (same clock as the transcript), when known.
  offset_ms int,
  question text not null check (length(question) between 1 and 2000),
  spoken text not null default '',
  answer text not null default '',
  sources jsonb not null default '[]',
  steps jsonb not null default '[]',
  status text not null default 'answering' check (status in ('answering', 'done', 'failed', 'stopped')),
  error text,
  cost_usd numeric not null default 0,
  created_at timestamptz not null default now()
);
create index board_meeting_assistant_meeting_idx on public.board_meeting_assistant (meeting_id, created_at);

alter table public.board_meeting_assistant enable row level security;
revoke all on public.board_meeting_assistant from anon, authenticated;
