-- Replies to pitches, read from the press office's shared mailbox (press@):
-- each pitch has its own Message-ID, so replies, bounces and automatic
-- replies that arrive there are matched to it.
alter table public.press_pitches
  add column message_id text,
  add column reply_subject text not null default '',
  add column reply_preview text not null default '',
  add column auto_replied_at timestamptz;
create index press_pitches_message_idx on public.press_pitches (message_id) where message_id is not null;
create index press_pitches_email_idx on public.press_pitches (lower(email), sent_at desc);
