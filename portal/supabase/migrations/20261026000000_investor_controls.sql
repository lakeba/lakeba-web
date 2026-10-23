-- Per-person switches on the investor page, and notes on holdings.
--
-- Ask: turning it off for a person reuses ask_user_pauses (the same pause the
-- cost protection uses). Board Q&A: profiles.board_qa_enabled, enforced
-- here so a person who is switched off cannot create questions or reply.
-- Holding notes: one note per holder and share class (so it survives new
-- dated balances), shown to that holder's people next to their shares.

alter table public.profiles add column board_qa_enabled boolean not null default true;

-- The signed-in person's own switches (their pause row is admin-only to read).
create function public.my_portal_flags()
returns table (ask_enabled boolean, board_qa_enabled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.ask_user_pauses p where p.user_id = (select auth.uid())),
         coalesce((select pr.board_qa_enabled from public.profiles pr where pr.id = (select auth.uid())), false);
$$;
revoke execute on function public.my_portal_flags() from public, anon;
grant execute on function public.my_portal_flags() to authenticated;

create function public.my_board_qa_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select board_qa_enabled from public.profiles where id = (select auth.uid())), false);
$$;
revoke execute on function public.my_board_qa_enabled() from public, anon;
grant execute on function public.my_board_qa_enabled() to authenticated;

drop policy "queries: members create own" on public.queries;
create policy "queries: members create own" on public.queries
  for insert to authenticated with check (
    user_id = (select auth.uid()) and (select public.can_see_entity(entity_id)) and (select public.my_board_qa_enabled())
  );
drop policy "query_messages: investor reply" on public.query_messages;
create policy "query_messages: investor reply" on public.query_messages
  for insert to authenticated with check (
    author_id = (select auth.uid()) and not internal and (select public.my_board_qa_enabled())
    and exists (select 1 from public.queries q where q.id = query_id and q.user_id = (select auth.uid()) and q.status <> 'closed')
  );

create table public.holding_notes (
  holder_id uuid not null references public.holders (id) on delete cascade,
  share_class_id uuid not null references public.share_classes (id) on delete cascade,
  note text not null check (length(btrim(note)) between 1 and 1000),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (holder_id, share_class_id)
);

alter table public.holding_notes enable row level security;
create policy "holding_notes: holder members read" on public.holding_notes
  for select to authenticated using ((select public.is_holder_member(holder_id)) or (select public.is_admin()));
create policy "holding_notes: company admins" on public.holding_notes
  for all to authenticated
  using (exists (select 1 from public.share_classes c where c.id = share_class_id and public.is_entity_admin(c.entity_id)))
  with check (exists (select 1 from public.share_classes c where c.id = share_class_id and public.is_entity_admin(c.entity_id)));
revoke all on public.holding_notes from anon;
