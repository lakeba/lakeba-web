-- Announcements as a one-time pop-up (Admin → Communications → Announcements; components/Tour.astro):
-- who it's for (the company's shareholders, its staff, or both), an optional staff section, an optional
-- place on the page to point at, translations, and who has seen the pop-up.
alter table public.announcements
  add column if not exists popup boolean not null default false,
  add column if not exists audience text not null default 'investors' check (audience in ('investors', 'staff', 'everyone')),
  add column if not exists staff_area text,
  add column if not exists point_at text,
  add column if not exists translations jsonb not null default '{}';

-- Shareholders never read staff-only announcements.
drop policy if exists "announcements: entity members read current" on public.announcements;
create policy "announcements: entity members read current" on public.announcements
  for select to authenticated using (
    (select public.is_admin())
    or (audience <> 'staff' and entity_id in (select public.my_entity_ids()) and starts_at <= now() and (ends_at is null or ends_at > now()))
  );

-- One row per person who has seen (and closed or followed) a pop-up. Written and read by the portal with the
-- service key only.
create table if not exists public.announcement_views (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);
alter table public.announcement_views enable row level security;
