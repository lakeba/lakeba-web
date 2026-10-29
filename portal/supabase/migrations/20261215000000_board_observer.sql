-- The Observer (phase 2 of the board assistant): a tablet at the board table
-- records a directors' meeting, after the chair confirms everyone present
-- agreed, shows the transcript live with speakers, and puts the transcript
-- into the meeting's records for the minutes. The audio is kept in the
-- "legal" bucket under {entity}/meetings/{meeting}/audio/ until the minutes
-- are signed, then deleted. Transcription by Deepgram or AssemblyAI (both
-- available, to compare); live text is replaced by a full pass on the whole
-- recording after the meeting. Read and written by the portal's server only.

alter table public.board_meetings
  add column recording_status text not null default 'none' check (recording_status in ('none', 'recording', 'paused', 'processing', 'done', 'failed')),
  -- {at, by, by_name, chair, wording, present: [names], agreed: [names]}
  add column recording_consent jsonb,
  -- [{take, started_at, ended_at, chunks, path, bytes, mime}]
  add column recording_takes jsonb not null default '[]',
  add column recording_error text,
  add column audio_deleted_at timestamptz,
  -- Which transcript the meeting's transcript text comes from, e.g. 'batch:deepgram'.
  add column transcript_source text,
  -- Names given to the speakers each transcript found: {"batch:deepgram": {"0": "Jane Smith"}}
  add column speaker_names jsonb not null default '{}';

create table public.board_meeting_segments (
  id bigint generated always as identity primary key,
  meeting_id uuid not null references public.board_meetings (id) on delete cascade,
  source text not null check (source ~ '^(live|batch):(deepgram|assemblyai)$'),
  take int not null default 1,
  seq int not null,
  start_ms int not null default 0,
  end_ms int not null default 0,
  speaker text not null default '',
  text text not null,
  created_at timestamptz not null default now(),
  unique (meeting_id, source, take, seq)
);
create index board_meeting_segments_meeting_idx on public.board_meeting_segments (meeting_id, source, take, seq);

alter table public.board_meeting_segments enable row level security;
revoke all on public.board_meeting_segments from anon, authenticated;
