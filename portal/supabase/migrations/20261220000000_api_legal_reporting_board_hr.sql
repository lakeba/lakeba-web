-- The company API catches up with the portal (Legal, reporting packs, the
-- Boardroom and HR): webhook events for them, from the same audit log entries
-- the portal already writes, and "api" as a source for a reporting pack whose
-- figures came from a venture's accounting system through the API.

alter table public.reporting_packs drop constraint reporting_packs_source_check;
alter table public.reporting_packs add constraint reporting_packs_source_check check (source in ('upload', 'xero', 'typed', 'api'));

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
    else null end
$$;
