// What the portal notifies people about, grouped into the categories people
// switch on or off (Profile → Notifications). Each notification `kind` belongs
// to one category. Push texts stay generic: they can show on a locked screen.
// Each person sees only the categories that can reach them: admin ones by the
// areas they work in (`for`), shown under the admin menu's sections; investor
// ones by what they have (`when`). npm run check:portal keeps this list in step
// with what the code sends.

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
  /** Admin topics: the admin menu section they belong to. */
  section?: AdminSection;
  /** Admin topics: who may get them. Areas from permissions.ts (anyone who can see one of them), 'staff' (any
   *  staff role), 'approvers' (anyone who prepares or approves something). Without it: Admins only. */
  for?: string[];
  /** Investor topics shown only to people who have that: trading switched on, an employee record, papers to sign. */
  when?: 'trading' | 'employee' | 'signer';
};

export const ADMIN_SECTIONS = ['Overview', 'Investors', 'Communications', 'Board & governance', 'Legal', 'Finance', 'People', 'Companies', 'Settings'] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export const CATEGORIES: Category[] = [
  { key: 'documents', audience: 'investor', label: 'New documents', description: 'Reports, updates and other documents published for you.', email: true, push: true, kinds: ['document'] },
  { key: 'meetings', audience: 'investor', label: 'Meetings and voting', description: 'Proxy voting opens, a reminder the day before it closes, and results.', email: true, push: true, kinds: ['meeting', 'proxy_reminder', 'meeting_results'] },
  { key: 'news', audience: 'investor', label: 'News and announcements', description: 'Company news, announcements and campaigns.', email: true, push: true, kinds: ['news', 'linkedin'] },
  { key: 'replies', audience: 'investor', label: 'Answers to your questions', description: 'The board answered your question, or your AGM question was answered.', email: true, push: true, kinds: ['query_reply', 'agm_answer'] },
  { key: 'holdings', audience: 'investor', label: 'Your holdings', description: 'A new holding statement is ready, or a note was added to one of your holdings.', email: true, push: true, kinds: ['holding_note', 'statement_ready'] },
  { key: 'trading', audience: 'investor', label: 'Secondary trading', description: 'Your interest to buy or sell shares was matched, completed or cancelled.', email: true, push: true, when: 'trading', kinds: ['trade'] },
  { key: 'signing', audience: 'investor', label: 'Documents to sign', description: 'A directors’ resolution or minutes are waiting for your signature (the email always comes).', email: false, push: true, when: 'signer', kinds: ['board_sign'] },
  { key: 'my_hr', audience: 'investor', label: 'My HR', description: 'Policies to accept, option grants, documents, your KPIs and reviews, commission statements, KPIs off track in your team, and requests from your employer.', email: true, push: true, when: 'employee', kinds: ['my_hr'] },
  { key: 'newsletter', audience: 'investor', label: 'Quarterly newsletter', description: 'The company’s quarterly newsletter for shareholders, by email.', email: true, push: false, emailOnly: true, kinds: ['newsletter'] },
  { key: 'digest', audience: 'investor', label: 'Weekly digest', description: 'One email each Monday with the week’s new documents, news and holding updates, instead of a separate email for each.', email: false, push: false, emailOnly: true, kinds: ['digest'] },
  { key: 'security', audience: 'investor', label: 'Account security', description: 'A passkey was added or removed, your password changed, or two-step verification changed.', email: true, push: true, locked: true, kinds: ['security'] },
  { key: 'admin_questions', audience: 'admin', label: 'Board Q&A', description: 'A new question or an investor’s reply.', email: false, push: true, section: 'Communications', kinds: ['admin_query'] },
  { key: 'admin_agm', audience: 'admin', label: 'AGM questions', description: 'An investor sent a question for a meeting.', email: false, push: true, section: 'Board & governance', kinds: ['admin_agm_question'] },
  { key: 'admin_votes', audience: 'admin', label: 'Proxy votes (daily summary)', description: 'Each morning, how many proxy votes were lodged the day before.', email: false, push: true, section: 'Board & governance', kinds: ['admin_votes_summary'] },
  { key: 'board_meetings', audience: 'admin', label: 'Board meetings', description: 'A meeting’s recording and transcript are ready (or couldn’t be made), or Lex couldn’t join an online meeting.', email: true, push: true, section: 'Board & governance', for: ['boardroom', 'legal'], kinds: ['board_meeting'] },
  { key: 'admin_press', audience: 'admin', label: 'Press releases', description: 'A press release is waiting for approval, or yours was approved, published or sent back.', email: true, push: true, section: 'Communications', for: ['press'], kinds: ['admin_press'] },
  { key: 'admin_approvals', audience: 'admin', label: 'Approvals', description: 'Something is waiting for your approval, or what you asked to have approved was approved or sent back.', email: true, push: true, section: 'Overview', for: ['approvers'], kinds: ['admin_approval'] },
  { key: 'admin_signins', audience: 'admin', label: 'First sign-ins', description: 'An investor signed in for the first time.', email: false, push: true, section: 'Investors', kinds: ['admin_first_signin'] },
  { key: 'admin_emails', audience: 'admin', label: 'Shareholder emails', description: 'An email to a shareholder mailbox has a reply ready or needs a person.', email: false, push: true, section: 'Communications', kinds: ['admin_email'] },
  { key: 'admin_trading', audience: 'admin', label: 'Secondary trading', description: 'A shareholder registered or withdrew an interest to buy or sell.', email: false, push: true, section: 'Finance', kinds: ['admin_trade'] },
  { key: 'admin_ask', audience: 'admin', label: 'Ask Lakeba', description: 'An answer was rated 👎, or a cost or usage limit was reached.', email: true, push: true, section: 'Settings', kinds: ['ask_alert', 'admin_ask_feedback'] },
  { key: 'admin_legal', audience: 'admin', label: 'Legal deadlines', description: 'Each morning, what is overdue or due soon (in 30, 7 and 1 days) for the companies you look after as Legal.', email: true, push: true, section: 'Legal', for: ['legal'], kinds: ['admin_legal'] },
  { key: 'legal_requests', audience: 'admin', label: 'Legal requests', description: 'A legal request was sent, answered or changed.', email: true, push: true, section: 'Legal', for: ['staff'], kinds: ['legal_request'] },
  { key: 'reporting', audience: 'admin', label: 'Reporting packs', description: 'A reporting pack is due, overdue, sent, accepted or has a question, or a commission run is waiting for approval.', email: true, push: true, section: 'Finance', for: ['reporting', 'accounting'], kinds: ['reporting'] },
  { key: 'hr', audience: 'admin', label: 'HR', description: 'An employee accepted a grant, asked to exercise options or acknowledged their review, Finance proposed a KPI result, someone’s KPIs went off track, or a checklist needs a look.', email: true, push: true, section: 'People', for: ['hr'], kinds: ['hr'] },
  { key: 'admin_setup', audience: 'admin', label: 'Venture set-up', description: 'A venture’s own address or email finished a set-up step, or a venture asked Lakeba for help with it.', email: true, push: true, section: 'Companies', kinds: ['admin_setup'] },
  { key: 'admin_integrations', audience: 'admin', label: 'Integrations', description: 'An integration needs a look: a webhook was switched off, something received waits for review, or a HubSpot or Xero connection has a problem.', email: true, push: true, section: 'Settings', kinds: ['admin_integrations'] },
  { key: 'admin_security', audience: 'admin', label: 'Admin security', description: 'An admin account signed in from a new device, or someone’s two-step was reset.', email: true, push: true, locked: true, section: 'Settings', kinds: ['admin_security'] },
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
    case 'news': case 'linkedin': return { title: `News from ${brand}`, body: detail ?? open };
    case 'query_reply': return { title: 'The board answered your question', body: open };
    case 'agm_answer': return { title: 'Your meeting question was answered', body: open };
    case 'holding_note': return { title: 'A note was added to your holding', body: open };
    case 'statement_ready': return { title: 'Your holding statement is ready', body: open };
    case 'trade': return { title: `${brand}: update on your trading interest`, body: open };
    case 'admin_trade': return { title: 'Secondary trading: new interest', body: open };
    case 'admin_press': return { title: 'Press releases: an update', body: open };
    case 'admin_approval': return { title: 'Approvals: an update', body: open };
    case 'digest': return { title: 'Your week at Lakeba', body: open };
    case 'security': return { title: 'Security alert for your account', body: detail ?? open };
    case 'admin_query': return { title: 'Board Q&A: new message from an investor', body: open };
    case 'admin_agm_question': return { title: 'New AGM question', body: open };
    case 'admin_votes_summary': return { title: 'Proxy votes yesterday', body: detail ?? open };
    case 'admin_first_signin': return { title: 'An investor signed in for the first time', body: open };
    case 'admin_email': return { title: 'New shareholder email', body: open };
    case 'ask_alert': case 'admin_ask_feedback': return { title: 'Ask Lakeba needs a look', body: open };
    case 'board_sign': return { title: 'A document is waiting for your signature', body: open };
    case 'legal_request': return { title: 'Legal request: an update', body: open };
    case 'reporting': return { title: 'Reporting packs: an update', body: open };
    case 'my_hr': return { title: 'My HR: something for you', body: open };
    case 'hr': return { title: 'HR: an update', body: open };
    case 'admin_legal': return { title: 'Legal: deadlines to look at', body: open };
    case 'admin_setup': return { title: 'Venture set-up: an update', body: open };
    case 'admin_integrations': return { title: 'Integrations: something needs a look', body: open };
    case 'board_meeting': return { title: 'Board meetings: an update', body: open };
    case 'admin_security': return { title: 'Admin security alert', body: detail ?? open };
  }
  return { title: `Update from ${brand}`, body: open };
}
