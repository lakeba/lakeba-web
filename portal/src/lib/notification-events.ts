// What the portal notifies people about, grouped into the categories people
// switch on or off (Profile → Notifications). Each notification `kind` belongs
// to one category. Push texts stay generic: they can show on a locked screen.

export type Category = {
  key: string;
  label: string;
  description: string;
  audience: 'investor' | 'admin';
  email: boolean; // default
  push: boolean; // default
  locked?: boolean; // always on (security)
  emailOnly?: boolean; // no browser notification for this one
  kinds: string[];
};

export const CATEGORIES: Category[] = [
  { key: 'documents', audience: 'investor', label: 'New documents', description: 'Reports, updates and other documents published for you.', email: true, push: true, kinds: ['document'] },
  { key: 'meetings', audience: 'investor', label: 'Meetings and voting', description: 'Proxy voting opens, a reminder the day before it closes, and results.', email: true, push: true, kinds: ['meeting', 'proxy_reminder', 'meeting_results'] },
  { key: 'news', audience: 'investor', label: 'News and announcements', description: 'Company news, announcements and campaigns.', email: true, push: true, kinds: ['news', 'linkedin', 'reminder'] },
  { key: 'replies', audience: 'investor', label: 'Answers to your questions', description: 'The board answered your question, or your AGM question was answered.', email: true, push: true, kinds: ['query_reply', 'agm_answer'] },
  { key: 'holdings', audience: 'investor', label: 'Your holdings', description: 'A new holding statement is ready, or a note was added to one of your holdings.', email: true, push: true, kinds: ['holding_note', 'statement_ready'] },
  { key: 'digest', audience: 'investor', label: 'Weekly digest', description: 'One email each Monday with the week’s new documents, news and holding updates, instead of a separate email for each.', email: false, push: false, emailOnly: true, kinds: ['digest'] },
  { key: 'security', audience: 'investor', label: 'Account security', description: 'A passkey was added or removed, your password changed, or two-step verification changed.', email: true, push: true, locked: true, kinds: ['security'] },
  { key: 'admin_questions', audience: 'admin', label: 'Board Q&A', description: 'A new question or an investor’s reply.', email: false, push: true, kinds: ['admin_query'] },
  { key: 'admin_agm', audience: 'admin', label: 'AGM questions', description: 'An investor sent a question for a meeting.', email: false, push: true, kinds: ['admin_agm_question'] },
  { key: 'admin_votes', audience: 'admin', label: 'Proxy votes (daily summary)', description: 'Each morning, how many proxy votes were lodged the day before.', email: false, push: true, kinds: ['admin_votes_summary'] },
  { key: 'admin_signins', audience: 'admin', label: 'First sign-ins', description: 'An investor signed in for the first time.', email: false, push: true, kinds: ['admin_first_signin'] },
  { key: 'admin_emails', audience: 'admin', label: 'Shareholder emails', description: 'An email to a shareholder mailbox has a reply ready or needs a person.', email: false, push: true, kinds: ['admin_email'] },
  { key: 'admin_ask', audience: 'admin', label: 'Ask Lakeba', description: 'An answer was rated 👎, or a cost or usage limit was reached.', email: true, push: true, kinds: ['ask_alert', 'admin_ask_feedback'] },
  { key: 'admin_security', audience: 'admin', label: 'Admin security', description: 'An admin account signed in from a new device, or someone’s two-step was reset.', email: true, push: true, locked: true, kinds: ['admin_security'] },
];

/** Categories whose emails the weekly digest replaces (for people who chose it). */
export const DIGESTED = ['documents', 'news', 'holdings'];

const byKind = new Map(CATEGORIES.flatMap((c) => c.kinds.map((k) => [k, c] as const)));
export const categoryOf = (kind: string) => byKind.get(kind);

/** Generic push texts (lock-screen safe). `detail` is a public title such as a document name. */
export function pushText(kind: string, brand: string, detail?: string): { title: string; body: string } {
  const open = 'Open the portal to read it.';
  switch (kind) {
    case 'document': return { title: `New document from ${brand}`, body: detail ?? open };
    case 'meeting': return { title: `${brand}: proxy voting is open`, body: detail ?? open };
    case 'proxy_reminder': return { title: `${brand}: proxy voting closes in 24 hours`, body: detail ?? open };
    case 'meeting_results': return { title: `${brand}: meeting results are available`, body: detail ?? open };
    case 'news': case 'linkedin': case 'reminder': return { title: `News from ${brand}`, body: detail ?? open };
    case 'query_reply': return { title: 'The board answered your question', body: open };
    case 'agm_answer': return { title: 'Your meeting question was answered', body: open };
    case 'holding_note': return { title: 'A note was added to your holding', body: open };
    case 'statement_ready': return { title: 'Your holding statement is ready', body: open };
    case 'digest': return { title: 'Your week at Lakeba', body: open };
    case 'security': return { title: 'Security alert for your account', body: detail ?? open };
    case 'admin_query': return { title: 'Board Q&A: new message from an investor', body: open };
    case 'admin_agm_question': return { title: 'New AGM question', body: open };
    case 'admin_votes_summary': return { title: 'Proxy votes yesterday', body: detail ?? open };
    case 'admin_first_signin': return { title: 'An investor signed in for the first time', body: open };
    case 'admin_email': return { title: 'New shareholder email', body: open };
    case 'ask_alert': case 'admin_ask_feedback': return { title: 'Ask Lakeba needs a look', body: open };
    case 'admin_security': return { title: 'Admin security alert', body: detail ?? open };
  }
  return { title: `Update from ${brand}`, body: open };
}
