-- CRM, phase 2 (docs/crm.md): selling every day. Quotes built from the company's Xero items and copied to Xero,
-- with approval for discounts over the company's limit; deal rooms (a private link per deal: the quote, files,
-- accepting, questions); Xero's invoices and payments on the deal (paid = won); the salespeople's mailboxes and
-- calendars read into the timeline, and sales emails with no deal yet; the forecast's categories and exchange
-- rates. Commission plans may pay on invoices paid instead of raised.

alter table public.commission_plans drop constraint commission_plans_basis_check;
alter table public.commission_plans add constraint commission_plans_basis_check check (basis in ('invoice_raised', 'invoice_paid'));

alter table public.approvals drop constraint approvals_item_type_check;
alter table public.approvals add constraint approvals_item_type_check check (item_type in ('document', 'post', 'newsletter', 'meeting', 'trade', 'quote'));

alter table public.entities
  add column crm_quote_prefix text not null default 'QU' check (crm_quote_prefix ~ '^[A-Z0-9-]{1,8}$'),
  -- Discounts above this (%) need a sales lead's approval before the quote goes out.
  add column crm_discount_limit numeric(5, 2) not null default 10 check (crm_discount_limit between 0 and 100),
  add column crm_quote_terms text not null default '',
  -- Units of the CRM's currency per unit of each other currency (CAD: 1.09 when 1 CAD = 1.09 AUD), for totals.
  add column crm_fx jsonb not null default '{"CAD": 1.10, "EUR": 1.65, "USD": 1.52, "GBP": 1.95, "NZD": 0.91, "SGD": 1.14}',
  -- Each salesperson's weekly target, in the CRM's currency (Today shows how the week is going).
  add column crm_week_target numeric(14, 2);

alter table public.crm_deals
  -- What the salesperson commits to the forecast.
  add column forecast text not null default 'pipeline' check (forecast in ('pipeline', 'best_case', 'commit')),
  add column xero_contact_id text,
  add column xero_invoice_ids text[] not null default '{}',
  add column invoiced_amount numeric(14, 2) not null default 0,
  add column paid_amount numeric(14, 2) not null default 0,
  add column paid_at timestamptz;

create table public.crm_quotes (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  deal_id uuid not null references public.crm_deals (id) on delete cascade,
  number text not null,
  version int not null default 1,
  -- draft → (approval) → ready → sent (in the deal room) → accepted / declined; expired after expiry_date.
  status text not null default 'draft' check (status in ('draft', 'ready', 'sent', 'accepted', 'declined', 'expired')),
  title text not null default '',
  summary text not null default '',
  terms text not null default '',
  currency text not null default 'AUD' check (currency ~ '^[A-Z]{3}$'),
  issue_date date not null default current_date,
  expiry_date date,
  -- Exclusive (prices before tax) or inclusive, as Xero's LineAmountTypes.
  amounts_are text not null default 'Exclusive' check (amounts_are in ('Exclusive', 'Inclusive', 'NoTax')),
  subtotal numeric(14, 2) not null default 0,
  tax numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  max_discount numeric(5, 2) not null default 0,
  xero_quote_id text,
  xero_quote_number text,
  xero_status text,
  xero_invoice_id text,
  accepted_at timestamptz,
  accepted_name text not null default '',
  accepted_title text not null default '',
  declined_reason text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, number, version)
);
create index crm_quotes_deal_idx on public.crm_quotes (deal_id, version desc);

create table public.crm_quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.crm_quotes (id) on delete cascade,
  sort int not null default 0,
  item_code text not null default '',
  description text not null default '',
  quantity numeric(14, 4) not null default 1 check (quantity >= 0),
  unit_price numeric(14, 4) not null default 0 check (unit_price >= 0),
  discount numeric(5, 2) not null default 0 check (discount between 0 and 100),
  account_code text not null default '',
  tax_type text not null default '',
  tax_rate numeric(6, 3) not null default 0,
  -- [{ name, option }] as Xero's tracking categories.
  tracking jsonb not null default '[]',
  amount numeric(14, 2) not null default 0
);
create index crm_quote_lines_quote_idx on public.crm_quote_lines (quote_id, sort);

-- Deal rooms: one private link per deal for the buyer (no account). Files in the "crm" bucket under {entity}/rooms/.
create table public.crm_rooms (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  deal_id uuid not null references public.crm_deals (id) on delete cascade,
  token_hash text not null unique,
  -- The link again, for its owner to copy (secret-box.ts).
  token_sealed text not null,
  message text not null default '',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  views int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index crm_rooms_deal_idx on public.crm_rooms (deal_id);
create table public.crm_room_files (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.crm_rooms (id) on delete cascade,
  title text not null,
  file_path text not null,
  file_name text not null,
  size_bytes bigint not null default 0,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- The salespeople's mailboxes (and calendars) the CRM reads, each connected by its owner.
create table public.crm_mailboxes (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  address text not null check (address = lower(address)),
  provider text not null check (provider in ('microsoft', 'google')),
  status text not null default 'connected' check (status in ('connected', 'paused', 'failed')),
  delta_inbox text,
  delta_sent text,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (entity_id, address)
);

-- Emails that look like sales but match nobody in the CRM ("Found in your inbox"): made into a deal, or dismissed.
create table public.crm_inbox (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  message_ref text not null,
  from_email text not null,
  from_name text not null default '',
  subject text not null default '',
  snippet text not null default '',
  received_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'made', 'dismissed')),
  -- Lakeba AI's read of it (phase 3): is it sales, and what do they want.
  ai jsonb,
  created_at timestamptz not null default now(),
  unique (entity_id, message_ref)
);
create index crm_inbox_user_idx on public.crm_inbox (entity_id, user_id, status, received_at desc);

alter table public.crm_quotes enable row level security;
alter table public.crm_quote_lines enable row level security;
alter table public.crm_rooms enable row level security;
alter table public.crm_room_files enable row level security;
alter table public.crm_mailboxes enable row level security;
alter table public.crm_inbox enable row level security;
revoke all on public.crm_quotes, public.crm_quote_lines, public.crm_rooms, public.crm_room_files, public.crm_mailboxes, public.crm_inbox from anon, authenticated;

insert into storage.buckets (id, name, public) values ('crm', 'crm', false) on conflict (id) do nothing;

-- Webhook events: quotes sent and accepted, invoices paid (the whole mapping).
create or replace function public.integration_event_type(action text, d jsonb)
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
    when 'admin_saved_company_record' then 'company_record.updated'
    when 'admin_applied_asic_extract' then 'company_record.updated'
    when 'admin_added_officer' then 'officer.appointed'
    when 'admin_updated_officer' then 'officer.updated'
    when 'admin_removed_officer' then 'officer.removed'
    when 'admin_completed_legal_item' then 'deadline.done'
    when 'api_completed_legal_item' then 'deadline.done'
    when 'admin_marked_legal_item_not_needed' then 'deadline.not_needed'
    when 'api_marked_legal_item_not_needed' then 'deadline.not_needed'
    when 'admin_imported_contract' then 'contract.added'
    when 'sent_reporting_pack' then 'reporting_pack.sent'
    when 'admin_accept_reporting_pack' then 'reporting_pack.accepted'
    when 'admin_return_reporting_pack' then 'reporting_pack.returned'
    when 'admin_added_board_meeting' then 'board_meeting.created'
    when 'admin_finished_meeting_recording' then 'board_meeting.recorded'
    when 'board_paper_signed' then 'board_paper.signed'
    when 'admin_added_person' then 'employee.added'
    when 'admin_marked_person_left' then 'employee.left'
    when 'admin_granted_equity' then 'equity.granted'
    when 'crm_deal_created' then 'deal.created'
    when 'crm_deal_stage_changed' then 'deal.stage_changed'
    when 'crm_deal_won' then 'deal.won'
    when 'crm_deal_lost' then 'deal.lost'
    when 'crm_person_added' then 'lead.added'
    when 'crm_quote_sent' then 'quote.sent'
    when 'crm_quote_accepted' then 'quote.accepted'
    when 'crm_invoice_paid' then 'invoice.paid'
    else null end
$$;
