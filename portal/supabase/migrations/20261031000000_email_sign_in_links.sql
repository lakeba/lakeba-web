-- One-time sign-in links in replies to shareholder emails. Supabase keeps only
-- one magic link per person (a new one cancels the last), so each button gets
-- its own code here and the Supabase sign-in is created only when it's clicked.
-- Only a hash of the code is stored. Server-side only.
create table public.email_sign_in_links (
  token_hash text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  next_path text not null check (next_path ~ '^/[^/\\]'),
  email_id uuid references public.shareholder_emails (id) on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index email_sign_in_links_user on public.email_sign_in_links (user_id);
alter table public.email_sign_in_links enable row level security;
revoke all on public.email_sign_in_links from anon, authenticated;
