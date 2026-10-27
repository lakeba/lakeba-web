-- The movements on a company's register of members (allotments, transfers in
-- and out…), as imported from the company secretary's register: each holding's
-- history, shown on its holder page and to the people who see the holding.
-- Each register imported replaces the movements of the holdings it lists;
-- holdings no longer on it keep theirs. Written by the server only.
create table public.register_movements (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  import_id uuid references public.register_imports (id) on delete set null,
  holder_id uuid not null references public.holders (id) on delete cascade,
  share_class_id uuid not null references public.share_classes (id) on delete cascade,
  seq integer not null,
  moved_on date not null,
  kind text not null,
  shares bigint not null,
  balance bigint not null,
  party text,
  party_holder_id uuid references public.holders (id) on delete set null,
  consideration numeric(14, 4),
  unique_numbers text,
  certificate text,
  paid_per_share numeric(14, 4),
  unpaid_per_share numeric(14, 4),
  beneficial boolean,
  unique (holder_id, share_class_id, seq)
);
create index register_movements_entity on public.register_movements (entity_id);
alter table public.register_movements enable row level security;

-- Read like the holdings themselves: the holder's people, admins, the
-- company's admins, and roles that see its register.
create policy "register_movements: members read" on public.register_movements
  for select to authenticated using ((select public.is_holder_member(holder_id)) or (select public.is_admin()));
create policy "register_movements: company admins read" on public.register_movements
  for select to authenticated using ((select public.is_entity_admin(entity_id)));
create policy "register_movements: role read" on public.register_movements
  for select to authenticated using ((select public.can('investors.view', entity_id)));
