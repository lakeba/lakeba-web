-- Ventures, phase 3: each venture's own lists and limits.
--
-- Shareholder mail: a venture can have its own address on a shared Lakeba
-- mailbox (mist.shareholders@lakeba.com, an alias of shareholders@); mail is
-- filed to the venture it was sent to. Newsletters: each venture keeps its own
-- subscriber list (entity_id null = Lakeba's, as before). Press: Lakeba's media
-- list (entity_id null) is used by Lakeba and its controlled ventures; a
-- non-controlling venture keeps its own. Opt-outs follow the list they came
-- from. Ask: an optional monthly budget per venture.

alter table public.entities
  add column shareholder_address text unique check (shareholder_address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column ask_monthly_budget_usd numeric(10, 2) check (ask_monthly_budget_usd >= 0);

-- Newsletter subscribers: one list per company.
alter table public.newsletter_subscribers add column entity_id uuid references public.entities (id) on delete cascade;
drop index public.newsletter_subscribers_email_idx;
create unique index newsletter_subscribers_email_idx on public.newsletter_subscribers
  (coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(email));

-- Media list: Lakeba's shared one, or a non-controlling venture's own.
alter table public.media_outlets add column entity_id uuid references public.entities (id) on delete cascade;
alter table public.media_contacts add column entity_id uuid references public.entities (id) on delete cascade;
alter table public.media_research_runs add column entity_id uuid references public.entities (id) on delete cascade;
drop index public.media_outlets_name_idx;
create unique index media_outlets_name_idx on public.media_outlets
  (coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
drop index public.media_contacts_email_idx;
create unique index media_contacts_email_idx on public.media_contacts
  (coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(email)) where email is not null;

-- Opt-outs: from Lakeba's press office (entity_id null) or from one venture's.
alter table public.media_optouts drop constraint media_optouts_pkey;
alter table public.media_optouts add column entity_id uuid references public.entities (id) on delete cascade;
create unique index media_optouts_list_idx on public.media_optouts
  (coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(email));
