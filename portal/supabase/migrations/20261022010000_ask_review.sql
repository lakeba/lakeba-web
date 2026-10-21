-- Ask Lakeba review (Phase A): every question and answer is recorded so
-- admins can review them; shareholders can rate answers.
-- Records are personal information (they show what someone asked): only
-- admins can read them, and they are deleted after 12 months.

create type public.ask_review_status as enum ('unreviewed', 'good', 'corrected', 'out_of_scope', 'missing_document');

create table public.ask_exchanges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  conversation_id uuid not null,
  turn int not null check (turn >= 1),
  question text not null,
  answer text not null default '',
  sources jsonb not null default '[]'::jsonb,
  declined boolean not null default false,
  error text,
  model text,
  input_tokens int,
  cache_read_tokens int,
  cache_write_tokens int,
  output_tokens int,
  cost_usd numeric(10, 4),
  feedback smallint check (feedback in (-1, 1)),
  feedback_note text check (length(feedback_note) <= 1000),
  feedback_at timestamptz,
  review_status public.ask_review_status not null default 'unreviewed',
  corrected_answer text,
  review_note text,
  reviewer_id uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index ask_exchanges_queue_idx on public.ask_exchanges (review_status, feedback, created_at desc);
create index ask_exchanges_conversation_idx on public.ask_exchanges (conversation_id, turn);

alter table public.ask_exchanges enable row level security;

-- Written by the server (service key) only. Admins read and review.
create policy "ask_exchanges: admin read" on public.ask_exchanges
  for select to authenticated using ((select public.is_admin()));
create policy "ask_exchanges: admin review" on public.ask_exchanges
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
revoke insert, update, delete on public.ask_exchanges from authenticated;
grant update (review_status, corrected_answer, review_note, reviewer_id, reviewed_at) on public.ask_exchanges to authenticated;

-- A shareholder rates their own answer (and nothing else about it).
create function public.rate_ask_answer(exchange_id uuid, rating smallint, note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if rating not in (-1, 1) then raise exception 'rating must be -1 or 1' using errcode = '22023'; end if;
  update public.ask_exchanges
     set feedback = rating,
         feedback_note = nullif(left(trim(coalesce(note, '')), 1000), ''),
         feedback_at = now()
   where id = exchange_id and user_id = (select auth.uid());
  if not found then raise exception 'not found' using errcode = '42501'; end if;
end;
$$;

-- Deletes records older than the retention period. Admins only.
create function public.purge_ask_exchanges(keep_months int default 12)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed int;
begin
  if not public.is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  delete from public.ask_exchanges where created_at < now() - make_interval(months => keep_months);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function public.rate_ask_answer(uuid, smallint, text) from public, anon;
revoke execute on function public.purge_ask_exchanges(int) from public, anon;
grant execute on function public.rate_ask_answer(uuid, smallint, text) to authenticated;
grant execute on function public.purge_ask_exchanges(int) to authenticated;
