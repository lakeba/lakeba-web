-- Ask Lakeba conversations people can come back to (the Ask page lists them).
-- Deleting a conversation hides it from the person; the record stays for Ask
-- review until it is removed with everything else after 12 months (daily
-- clean-up in the portal's background worker).
alter table public.ask_exchanges add column hidden_at timestamptz;
create index ask_exchanges_user_conversation_idx on public.ask_exchanges (user_id, entity_id, created_at desc);
