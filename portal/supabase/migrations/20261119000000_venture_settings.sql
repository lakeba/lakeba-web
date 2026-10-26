-- Ventures, phase 1: each company's own settings, its own switches for Ask and
-- Board Q&A, and audit log entries tagged with the company they are about.
--
-- Settings left empty fall back to Lakeba's (what the portal showed before),
-- so nothing changes for a company until someone fills them in. The address
-- fields are stored now and used when venture addresses go live.

alter table public.entities
  add column slug text unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  add column custom_domain text unique check (custom_domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$'),
  add column sender_name text check (char_length(sender_name) <= 80),
  add column reply_to text check (reply_to ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column contact_email text check (contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column ask_name text check (char_length(ask_name) <= 40),
  add column email_footer text check (char_length(email_footer) <= 500),
  add column document_footer text check (char_length(document_footer) <= 300),
  add column ask_enabled boolean not null default true,
  add column board_qa_enabled boolean not null default true;

-- Every venture gets its Lakeba address name now ({slug}.investors.lakeba.com later).
-- From the display name ("DoxAI" → doxai), or the code when two names would clash.
with named as (
  select id, code, regexp_replace(lower(display_name), '[^a-z0-9]', '', 'g') as name,
         count(*) over (partition by regexp_replace(lower(display_name), '[^a-z0-9]', '', 'g')) as same
  from public.entities where relationship <> 'group'
)
update public.entities e set slug = case when n.same = 1 and n.name ~ '^[a-z0-9]{1,40}$' then n.name else lower(n.code) end
from named n where n.id = e.id;

-- Board Q&A switched off for a company: nobody can ask or reply there.
create function public.entity_board_qa_enabled(e uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select board_qa_enabled from public.entities where id = e), false);
$$;
revoke execute on function public.entity_board_qa_enabled(uuid) from public, anon;
grant execute on function public.entity_board_qa_enabled(uuid) to authenticated;

drop policy "queries: members create own" on public.queries;
create policy "queries: members create own" on public.queries
  for insert to authenticated with check (
    user_id = (select auth.uid()) and (select public.can_see_entity(entity_id)) and (select public.my_board_qa_enabled())
    and (select public.entity_board_qa_enabled(entity_id))
  );
drop policy "query_messages: investor reply" on public.query_messages;
create policy "query_messages: investor reply" on public.query_messages
  for insert to authenticated with check (
    author_id = (select auth.uid()) and not internal and (select public.my_board_qa_enabled())
    and exists (select 1 from public.queries q where q.id = query_id and q.user_id = (select auth.uid()) and q.status <> 'closed'
      and (select public.entity_board_qa_enabled(q.entity_id)))
  );

-- Audit log: which company an entry is about (null for things like signing in).
alter table public.audit_log add column entity_id uuid references public.entities (id) on delete set null;
create index audit_log_entity_idx on public.audit_log (entity_id, created_at desc);

-- Fills entity_id from what the entry's details name: a company code, or the
-- id of a document, meeting, question, release and so on. Writers that know
-- the company can set it themselves; this catches everything else.
create function public.audit_entity(d jsonb)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  found uuid;
  id_of text;
begin
  if d ? 'company' then
    select id into found from public.entities where code = d->>'company';
    if found is not null then return found; end if;
  end if;
  foreach id_of in array array['entity_id', 'document_id', 'meeting_id', 'query_id', 'exchange_id', 'interest_id', 'match_id',
    'room_id', 'release_id', 'email_id', 'issue_id', 'post_id', 'class_id', 'share_class_id', 'template_id', 'approval_id'] loop
    continue when not (d ? id_of) or (d->>id_of) !~ '^[0-9a-fA-F-]{36}$';
    found := case id_of
      when 'entity_id' then (select id from public.entities where id = (d->>id_of)::uuid)
      when 'document_id' then (select entity_id from public.documents where id = (d->>id_of)::uuid)
      when 'meeting_id' then (select entity_id from public.meetings where id = (d->>id_of)::uuid)
      when 'query_id' then (select entity_id from public.queries where id = (d->>id_of)::uuid)
      when 'exchange_id' then (select entity_id from public.ask_exchanges where id = (d->>id_of)::uuid)
      when 'interest_id' then (select entity_id from public.trade_interests where id = (d->>id_of)::uuid)
      when 'match_id' then (select entity_id from public.trade_matches where id = (d->>id_of)::uuid)
      when 'room_id' then (select entity_id from public.data_rooms where id = (d->>id_of)::uuid)
      when 'release_id' then (select entity_id from public.press_releases where id = (d->>id_of)::uuid)
      when 'email_id' then (select entity_id from public.shareholder_emails where id = (d->>id_of)::uuid)
      when 'issue_id' then (select entity_id from public.newsletter_issues where id = (d->>id_of)::uuid)
      when 'post_id' then (select entity_id from public.posts where id = (d->>id_of)::uuid)
      when 'class_id' then (select entity_id from public.share_classes where id = (d->>id_of)::uuid)
      when 'share_class_id' then (select entity_id from public.share_classes where id = (d->>id_of)::uuid)
      when 'template_id' then (select entity_id from public.newsletter_templates where id = (d->>id_of)::uuid)
      when 'approval_id' then (select entity_id from public.approvals where id = (d->>id_of)::uuid)
    end;
    if found is not null then return found; end if;
  end loop;
  return null;
end;
$$;
revoke execute on function public.audit_entity(jsonb) from public, anon, authenticated;

create function public.audit_log_set_entity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.entity_id is null then new.entity_id := public.audit_entity(new.detail); end if;
  return new;
end;
$$;
create trigger audit_log_set_entity before insert on public.audit_log
  for each row execute function public.audit_log_set_entity();

-- Entries already in the log.
update public.audit_log set entity_id = public.audit_entity(detail) where entity_id is null;
