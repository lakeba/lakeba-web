-- News managed in the portal, for the portal and the public website.
-- A post is either for a company's shareholders (as before) or public: public
-- posts appear on the website (which reads /api/public/news.json when it is
-- built) and to every signed-in investor. Bodies are sanitised HTML from the
-- editor (body_md stays for older posts until they are converted). Every save
-- keeps a revision; autosave holds unsaved edits without touching the live post.

alter table public.posts
  add column visibility text not null default 'shareholders' check (visibility in ('shareholders', 'public')),
  add column body_html text not null default '',
  add column venture text not null default '',
  add column categories text[] not null default '{}',
  add column external boolean not null default false,
  add column source_url text,
  add column source_name text,
  add column seo_description text not null default '',
  add column share_image_url text,
  add column notify_on_publish boolean not null default false,
  add column notified_at timestamptz,
  add column created_by uuid references auth.users (id) on delete set null,
  add column updated_by uuid references auth.users (id) on delete set null,
  add column updated_at timestamptz not null default now(),
  add column autosave jsonb,
  add column autosave_at timestamptz;

create index posts_public_idx on public.posts (published_at desc) where visibility = 'public';

-- Public posts: every signed-in person can read them once published.
create policy "posts: public read" on public.posts
  for select to authenticated using (visibility = 'public' and published_at <= now());

create table public.post_revisions (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.posts (id) on delete cascade,
  title text not null,
  excerpt text not null default '',
  body_html text not null default '',
  seo_description text not null default '',
  cover_url text,
  reason text not null default 'save' check (reason in ('save', 'publish', 'restore', 'import')),
  saved_by uuid references auth.users (id) on delete set null,
  saved_at timestamptz not null default now()
);
create index post_revisions_post_idx on public.post_revisions (post_id, saved_at desc);
alter table public.post_revisions enable row level security;
revoke all on public.post_revisions from anon, authenticated;

-- Images for news (covers and images in the text). Private bucket: the portal
-- serves them at /news-media/<path> to anyone, because public posts are public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('news-media', 'news-media', false, 8388608, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- When public news last changed, and when the website was last asked to rebuild.
insert into public.portal_settings (key, value) values ('website_sync', '{"changed_at": null, "requested_at": null}')
on conflict (key) do nothing;
