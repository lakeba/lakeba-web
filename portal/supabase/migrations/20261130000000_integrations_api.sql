-- Integrations, part 1: the company API and outgoing webhooks
-- (Admin → Companies → a company → Integrations).
--
-- API keys belong to one company and carry scopes named like the admin
-- permissions ("investors.view", "documents.do"…) plus "people.read" for
-- personal data. Only a hash of each key is kept. Each company's Admins manage
-- their own keys; a group Admin can switch a company's integrations off.
--
-- Events come from the audit log: every logged action that means something to
-- another tool (a holder added, a proxy lodged…) is turned into an event for
-- that company, and each event is queued for the company's webhook endpoints
-- that want it. Deliveries are signed and retried by the portal's worker.
-- Everything here is read and written by the portal server only.

alter table public.entities add column integrations_enabled boolean not null default true;

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  kind text not null default 'key' check (kind in ('key', 'oauth')),
  prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default '{}',
  -- A Lakeba Group key may cover every company (group Admins only).
  all_companies boolean not null default false,
  allowed_ips text[] not null default '{}',
  expires_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  -- Access tokens given to an app (kind 'oauth', see the OAuth migration): the app, and its refresh token's hash.
  client_id uuid,
  refresh_hash text unique,
  refresh_expires_at timestamptz
);
create index api_keys_entity_idx on public.api_keys (entity_id, created_at desc);

-- Requests per key, endpoint and day.
create table public.api_usage (
  key_id uuid not null references public.api_keys (id) on delete cascade,
  day date not null,
  endpoint text not null,
  requests integer not null default 0,
  errors integer not null default 0,
  primary key (key_id, day, endpoint)
);

create function public.api_count(target_key uuid, target_endpoint text, failed boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.api_usage (key_id, day, endpoint, requests, errors)
  values (target_key, (now() at time zone 'Australia/Sydney')::date, target_endpoint, 1, case when failed then 1 else 0 end)
  on conflict (key_id, day, endpoint) do update set requests = public.api_usage.requests + 1, errors = public.api_usage.errors + excluded.errors;
$$;

-- Writes sent with an Idempotency-Key: the first answer is kept for a day and repeated.
create table public.api_idempotency (
  key_id uuid not null references public.api_keys (id) on delete cascade,
  idem_key text not null,
  request_hash text not null,
  status integer not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (key_id, idem_key)
);

create table public.integration_events (
  id bigint generated always as identity primary key,
  event_id uuid not null default gen_random_uuid() unique,
  entity_id uuid not null references public.entities (id) on delete cascade,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  audit_id bigint,
  occurred_at timestamptz not null default now()
);
create index integration_events_entity_idx on public.integration_events (entity_id, id desc);

create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  url text not null check (url ~ '^https?://'),
  -- Event types, or '*' for all.
  events text[] not null default '{*}',
  format text not null default 'json' check (format in ('json', 'slack', 'teams')),
  -- Encrypted with the portal's integrations key; signs every delivery.
  secret_enc text not null,
  personal_data boolean not null default false,
  active boolean not null default true,
  disabled_reason text,
  failures integer not null default 0,
  -- Made by a key (Zapier-style subscriptions) rather than on the page.
  created_by_key uuid references public.api_keys (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index webhook_endpoints_entity_idx on public.webhook_endpoints (entity_id);

create table public.webhook_deliveries (
  id bigint generated always as identity primary key,
  endpoint_id uuid not null references public.webhook_endpoints (id) on delete cascade,
  event_id bigint not null references public.integration_events (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed', 'gave_up')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_status integer,
  last_error text,
  response_excerpt text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (endpoint_id, event_id)
);
create index webhook_deliveries_due_idx on public.webhook_deliveries (next_attempt_at) where status in ('pending', 'failed');

-- The audit actions that are events for other tools.
create function public.integration_event_type(action text, d jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case action
    when 'admin_created_holder' then 'holder.created'
    when 'register_holder_updated' then 'holder.updated'
    when 'register_holder_deleted' then 'holder.deleted'
    when 'register_holding_deleted' then 'holdings.changed'
    when 'admin_imported_holdings' then 'holdings.changed'
    when 'admin_applied_import' then 'holdings.changed'
    when 'api_holdings_changed' then 'holdings.changed'
    when 'admin_applied_register' then 'register.imported'
    when 'admin_set_official_on_issue' then 'share_class.updated'
    when 'admin_added_investor' then 'person.added'
    when 'api_added_person' then 'person.added'
    when 'admin_invited_user' then 'person.invited'
    when 'investor_welcomed' then 'person.invited'
    when 'admin_deleted_user' then 'person.deleted'
    when 'register_access_added' then 'holder_access.added'
    when 'admin_linked_holder' then 'holder_access.added'
    when 'register_access_removed' then 'holder_access.removed'
    when 'admin_unlinked_holder' then 'holder_access.removed'
    when 'admin_uploaded_document' then 'document.added'
    when 'api_added_document' then 'document.added'
    when 'admin_published_document' then 'document.published'
    when 'admin_deleted_document' then 'document.deleted'
    when 'news_published' then 'news.published'
    when 'admin_created_meeting' then 'meeting.created'
    when 'meeting_opened' then 'meeting.opened'
    when 'meeting_results_published' then 'meeting.results_published'
    when 'admin_deleted_meeting' then 'meeting.deleted'
    when 'proxy_lodged' then 'proxy.lodged'
    when 'query_created' then 'query.created'
    when 'admin_replied_query' then 'query.answered'
    when 'data_room_guest_invited' then 'data_room.guest_invited'
    when 'data_room_nda_accepted' then 'data_room.terms_accepted'
    when 'data_room_document_viewed' then 'data_room.document_viewed'
    when 'newsletter_subscribed' then 'newsletter.subscribed'
    when 'newsletter_unsubscribed' then 'newsletter.unsubscribed'
    when 'admin_added_newsletter_subscriber' then 'newsletter.subscribed'
    when 'approval_requested' then 'approval.requested'
    when 'approval_given' then 'approval.decided'
    when 'approval_changes_requested' then 'approval.decided'
    when 'trade_interest_registered' then 'trade_interest.registered'
    when 'sign_in' then 'person.signed_in'
    when 'inbound_received' then 'inbound.received'
    else null end
$$;

-- An event for each such action, then a delivery for each endpoint of that company that wants it.
create function public.audit_to_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  kind text := public.integration_event_type(new.action, new.detail);
  ev bigint;
  target uuid;
  targets uuid[];
begin
  if kind is null then return new; end if;
  -- The company is known from the log entry; otherwise the companies of the holder or person it is about
  -- (a sign-in belongs to every company the person is an investor in).
  if new.entity_id is not null and kind <> 'person.signed_in' then
    targets := array[new.entity_id];
  elsif new.detail ? 'holder_id' and (new.detail->>'holder_id') ~ '^[0-9a-fA-F-]{36}$' then
    select array_agg(distinct sc.entity_id) into targets
    from public.holdings h join public.share_classes sc on sc.id = h.share_class_id
    where h.holder_id = (new.detail->>'holder_id')::uuid;
  elsif new.detail ? 'user_id' or kind = 'person.signed_in' then
    select array_agg(distinct sc.entity_id) into targets
    from public.holder_members m join public.holdings h on h.holder_id = m.holder_id join public.share_classes sc on sc.id = h.share_class_id
    where m.user_id = coalesce(case when (new.detail->>'user_id') ~ '^[0-9a-fA-F-]{36}$' then (new.detail->>'user_id')::uuid end, new.user_id);
  else
    targets := '{}';
  end if;
  foreach target in array coalesce(targets, '{}') loop
    continue when target is null;
    insert into public.integration_events (entity_id, type, data, audit_id, occurred_at)
    values (target, kind, new.detail || case when new.user_id is not null then jsonb_build_object('user_id', new.user_id) else '{}'::jsonb end, new.id, new.created_at)
    returning id into ev;
    insert into public.webhook_deliveries (endpoint_id, event_id)
    select w.id, ev from public.webhook_endpoints w join public.entities e on e.id = w.entity_id
    where w.entity_id = target and w.active and e.integrations_enabled and ('*' = any (w.events) or kind = any (w.events));
  end loop;
  return new;
end;
$$;
create trigger audit_log_to_event after insert on public.audit_log for each row execute function public.audit_to_event();

alter table public.api_keys enable row level security;
alter table public.api_usage enable row level security;
alter table public.api_idempotency enable row level security;
alter table public.integration_events enable row level security;
alter table public.webhook_endpoints enable row level security;
alter table public.webhook_deliveries enable row level security;
revoke all on public.api_keys, public.api_usage, public.api_idempotency, public.integration_events, public.webhook_endpoints, public.webhook_deliveries from anon, authenticated;
revoke execute on function public.api_count(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.api_count(uuid, text, boolean) to service_role;
