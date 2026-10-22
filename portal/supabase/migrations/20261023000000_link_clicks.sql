-- Clicks on tracked outbound links (/go/<link>?src=<where>), e.g. the
-- LinkedIn follow campaign. Written by the server only; admins read them.
-- user_id is null when the person clicked without being signed in (an email link).

create table public.link_clicks (
  id bigint generated always as identity primary key,
  link text not null,
  source text not null,
  user_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index link_clicks_link_idx on public.link_clicks (link, created_at desc);

alter table public.link_clicks enable row level security;
create policy "link_clicks: admin read" on public.link_clicks
  for select to authenticated using ((select public.is_admin()));
revoke all on public.link_clicks from anon;
revoke insert, update, delete on public.link_clicks from authenticated;
