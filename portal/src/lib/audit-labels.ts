// Audit log actions in plain words (Admin → Overview, Audit log). The stored
// codes stay as they are (filters and exports use them); unknown codes are
// turned into words ("admin_saved_newsletter" → "Saved newsletter").

const LABELS: Record<string, string> = {
  sign_in: 'Signed in', sign_out: 'Signed out',
  mfa_enrolled: 'Set up two-step sign-in', mfa_verified: 'Passed two-step sign-in', mfa_removed: 'Removed two-step sign-in',
  passkey_added: 'Added a passkey', passkey_removed: 'Removed a passkey', password_changed: 'Changed their password',
  profile_updated: 'Updated their details', profile_photo_changed: 'Changed their profile photo', profile_photo_removed: 'Removed their profile photo', language_changed: 'Changed their language', notification_preferences_saved: 'Changed their notification choices',
  push_enabled: 'Turned on browser notifications', push_disabled: 'Turned off browser notifications',
  statement_downloaded: 'Downloaded a holding statement', tax_pack_downloaded: 'Downloaded a tax-time pack',
  holding_note_banner_closed: 'Closed a holding note', holding_shared: 'Shared a holding with someone', holding_unshared: 'Stopped sharing a holding',
  proxy_lodged: 'Lodged a proxy vote', query_created: 'Asked the board a question', ask_question: 'Asked Ask Lakeba', ask_answered: 'Ask Lakeba answered',
  ask_daily_limit_hit: 'Reached the daily Ask limit',
  trade_interest_registered: 'Registered a trading interest', trade_interest_withdrawn: 'Withdrew a trading interest',
  newsletter_subscribed: 'Someone subscribed to the newsletter', newsletter_unsubscribed: 'Someone unsubscribed from the newsletter',
  press_unsubscribed: 'A journalist unsubscribed from press emails',
  investor_data_imported: 'Investor data imported', investor_welcomed: 'Welcome email sent',
  data_room_nda_accepted: 'A data room guest accepted the terms', data_room_deleted: 'Deleted a data room',
  shareholder_email_auto_cancelled: 'An automatic reply was cancelled', shareholder_email_to_board_qa: 'A shareholder email was moved to Board Q&A',
  approval_requested: 'Asked for approval', approval_withdrawn: 'Withdrew an approval request', approval_given: 'Approved', approval_changes_requested: 'Asked for changes',
  admin_granted_role: 'Gave a role', admin_removed_role: 'Removed a role', admin_changed_role_permissions: 'Changed a role’s permissions',
  admin_created_role: 'Created a role', admin_deleted_role: 'Deleted a role', admin_invited_user: 'Invited someone', admin_added_investor: 'Added an investor (not invited yet)', admin_deleted_user: 'Deleted an account', admin_deleted_meeting: 'Deleted a meeting',
  admin_reset_mfa: 'Reset someone’s two-step sign-in', admin_exported_investor_data: 'Downloaded the investor data workbook',
  admin_checked_import: 'Checked an import file', admin_applied_import: 'Applied an import',
  admin_asked_board_ask: 'Asked Board Ask', admin_rated_board_ask: 'Rated a Board Ask answer', admin_deleted_board_ask_conversation: 'Deleted a Board Ask conversation',
  admin_added_law_source: 'Added to the law library', admin_removed_law_source: 'Removed from the law library',
  admin_drafted_board_deck: 'Had Lex draft a board deck', admin_uploaded_board_deck: 'Uploaded a board deck for Lex to present', admin_saved_board_deck: 'Changed a board deck', admin_approved_board_deck: 'Approved a board deck for Lex to present', admin_deleted_board_deck: 'Deleted a board deck', admin_presented_board_deck: 'Lex presented a board deck',
  company_board_assistant_switched: 'Switched the board assistant on or off for a company',
  admin_added_board_meeting: 'Added a board meeting',
  admin_asked_lex: 'Asked Lex, the board assistant, during a meeting',
  admin_recorded_meeting_consent: 'Recorded everyone’s agreement to record a meeting', admin_started_meeting_recording: 'Started recording a meeting', admin_finished_meeting_recording: 'Finished recording a meeting',
  admin_transcribed_meeting_recording: 'Transcribed a meeting’s recording again', admin_chose_meeting_transcript: 'Chose the transcript for a meeting', admin_named_meeting_speakers: 'Named the speakers in a meeting’s transcript',
  admin_saved_board_ask_test: 'Saved a Board Ask test', admin_deleted_board_ask_test: 'Deleted a Board Ask test', admin_ran_board_ask_tests: 'Ran the Board Ask tests',
  // Performance (KPIs and reviews)
  admin_added_kpi_period: 'Added a performance period', admin_changed_kpi_period: 'Opened, closed or reopened a performance period', admin_gave_kpi_scorecards: 'Gave people scorecards',
  admin_added_kpi_definition: 'Added a KPI to the library', admin_saved_kpi_definition: 'Changed a KPI in the library', admin_archived_kpi_definition: 'Archived or brought back a KPI',
  admin_added_kpi_role_set: 'Added a KPI role set', admin_saved_kpi_role_set: 'Changed a KPI role set', admin_archived_kpi_role_set: 'Archived or brought back a KPI role set',
  admin_added_kpi_goal: 'Added a goal', admin_saved_kpi_goal: 'Changed a goal', admin_deleted_kpi_goal: 'Deleted a goal',
  admin_saved_kpi_items: 'Changed a scorecard’s targets and weights', admin_added_kpi_item: 'Added a KPI to a scorecard', admin_removed_kpi_item: 'Removed a KPI from a scorecard',
  admin_activated_kpi_scorecard: 'Made a scorecard active', admin_returned_kpi_scorecard_to_draft: 'Put a scorecard back to draft', admin_started_kpi_review: 'Started a performance review',
  admin_added_kpi_result: 'Added a KPI result', admin_proposed_kpi_result: 'Proposed a KPI result (Finance)', admin_confirmed_kpi_result: 'Confirmed a proposed KPI result', admin_rejected_kpi_result: 'Rejected a proposed KPI result', admin_deleted_kpi_result: 'Deleted a KPI result',
  admin_added_kpi_checkin: 'Added a check-in to a scorecard', admin_saved_kpi_manager_review: 'Saved the manager’s part of a review', admin_signed_off_kpi_review: 'Signed off a performance review',
  added_kpi_checkin: 'Commented on their scorecard', submitted_kpi_self_review: 'Sent their self-assessment', acknowledged_kpi_review: 'Acknowledged their review',
  manager_added_kpi_checkin: 'Added a check-in for someone in their team', manager_saved_kpi_review: 'Saved their part of a team member’s review',
  admin_refreshed_kpi_results: 'Refreshed the KPIs that fill themselves in', kpi_daily_refresh: 'Morning KPI refresh: automatic results updated, off-track KPIs alerted',
  // Commissions
  admin_added_commission_plan: 'Added a commission plan', admin_saved_commission_plan: 'Changed a commission plan',
  admin_added_commission_assignment: 'Put someone on a commission plan', admin_saved_commission_assignment: 'Changed someone’s commission target or dates', admin_removed_commission_assignment: 'Took someone off a commission plan',
  admin_saved_commission_attribution: 'Credited a client to a sales rep', admin_ended_commission_attribution: 'Ended a client’s sales credit', admin_deleted_commission_attribution: 'Deleted a client’s sales credit',
  admin_built_commission_run: 'Built a commission run', admin_rebuilt_commission_run: 'Built a commission run again', admin_submitted_commission_run: 'Sent a commission run for approval', admin_withdrew_commission_run: 'Took a commission run back from approval',
  admin_approved_commission_run: 'Approved a commission run', admin_marked_commission_run_paid: 'Marked a commission run paid', admin_deleted_commission_run: 'Deleted a draft commission run', admin_exported_commission_run: 'Downloaded a commission run’s lines',
};
const WORDS: Record<string, string> = { mfa: 'two-step sign-in', qa: 'Q&A', ai: 'AI', kb: 'Ask knowledge', agm: 'meeting', pdf: 'PDF', csv: 'CSV', nda: 'terms', ask: 'Ask', linkedin: 'LinkedIn' };

/** The actions with a wording of their own, for suggestions in the audit log's filters. */
export const KNOWN_ACTIONS = Object.keys(LABELS);

export function actionLabel(code: string) {
  if (LABELS[code]) return LABELS[code];
  let words = code.split('_');
  if (words[0] === 'admin') words = words.slice(1);
  const area = words[0] === 'register' || words[0] === 'press' ? `${words.shift() === 'register' ? 'Register' : 'Press'}: ` : '';
  const text = words.map((w) => WORDS[w] ?? w).join(' ');
  return area + text.charAt(0).toUpperCase() + text.slice(1);
}

/** A short line from an entry's details: the fields people recognise, then a few others. */
export function detailSummary(detail: unknown) {
  if (!detail || typeof detail !== 'object') return '';
  const d = detail as Record<string, unknown>;
  const scalar = (v: unknown) => (v == null || typeof v === 'object' ? null : String(v));
  const first = ['title', 'name', 'holder', 'email', 'role', 'company', 'class', 'file', 'subject', 'headline', 'method', 'note'];
  const keys = [...first.filter((k) => scalar(d[k])), ...Object.keys(d).filter((k) => !first.includes(k) && scalar(d[k]) && !/(^|_)id$/.test(k))].slice(0, 3);
  return keys.map((k) => `${k.replace(/_/g, ' ')}: ${scalar(d[k])!.slice(0, 60)}`).join(' · ');
}
