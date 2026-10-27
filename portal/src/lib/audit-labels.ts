// Audit log actions in plain words (Admin → Overview, Audit log). The stored
// codes stay as they are (filters and exports use them); unknown codes are
// turned into words ("admin_saved_newsletter" → "Saved newsletter").

const LABELS: Record<string, string> = {
  sign_in: 'Signed in', sign_out: 'Signed out',
  mfa_enrolled: 'Set up two-step sign-in', mfa_verified: 'Passed two-step sign-in', mfa_removed: 'Removed two-step sign-in',
  passkey_added: 'Added a passkey', passkey_removed: 'Removed a passkey', password_changed: 'Changed their password',
  profile_updated: 'Updated their details', language_changed: 'Changed their language', notification_preferences_saved: 'Changed their notification choices',
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
};
const WORDS: Record<string, string> = { mfa: 'two-step sign-in', qa: 'Q&A', ai: 'AI', kb: 'Ask knowledge', agm: 'meeting', pdf: 'PDF', csv: 'CSV', nda: 'terms', ask: 'Ask', linkedin: 'LinkedIn' };

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
