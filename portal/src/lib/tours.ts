// Guided tours (Driver.js, components/Tour.astro): short step-by-step overlays that point at parts of a page.
// Each step points at an element marked data-tour="…"; a step whose element isn't on the page (a feature
// the person doesn't have, the phone layout) is skipped. A tour starts by itself once, on its start page, for
// the people it's meant for; "Take the tour" in the profile menu and What's new's "Show me" replay them.
// Guides (`guide: true`) are tours for one page's task: they never start by themselves; the page shows a
// "Guide me" button. A step can wait for the person to act (`advanceOn`), and a step whose element is inside
// a closed fold-out opens it. `start` may end in /* for pages with an id (/agm/*).
// npm run check:portal checks that every step's element exists and that shareholder tours are translated.
// No imports: the check script loads this file directly.

export type Who = 'investor' | 'staff' | 'director' | 'audit' | 'anyone' | 'documents' | 'register' | 'papers';
/** `when`: shown only to people who can switch views (`switch`), or who have Ask (`ask`). */
export type TourStep = { el: string; title: string; body: string; when?: 'switch' | 'ask'; advanceOn?: 'click' | 'change' };
export type Tour = {
  key: string;
  /** The page it runs on. */
  start: string;
  who: Who;
  /** Starts by itself on the first visit (otherwise only from a link). */
  auto: boolean;
  /** Shareholder tours are in every language (src/i18n); staff tours are in English, like the admin. */
  translate: boolean;
  /** A page's guide, started from its "Guide me" button. */
  guide?: boolean;
  steps: TourStep[];
};

export const TOURS: Tour[] = [
  {
    key: 'investor', start: '/', who: 'investor', auto: true, translate: true,
    steps: [
      { el: 'holding', title: 'Your holding', body: 'Your shares, what they’re worth and their history. The buttons give you your holding statement and the tax-time pack.' },
      { el: 'nav-documents', title: 'Documents', body: 'Annual reports, shareholder updates and meeting papers, newest first.' },
      { el: 'nav-agm', title: 'Meetings', body: 'Notices of meeting, proxy voting online and the results.' },
      { el: 'nav-ask', title: 'Ask a question', body: '{ask} answers from the company’s documents, any time, with the sources it used.', when: 'ask' },
      { el: 'nav-board', title: 'Ask the board', body: 'For questions the documents don’t answer: they go to the board, and the answer comes back here.' },
      { el: 'inbox', title: 'Your inbox', body: 'Replies, new documents and meeting notices. Choose what reaches you by email in Notifications.' },
      { el: 'account-menu', title: 'Your account', body: 'Your profile and photo, language, sign-in security and notifications. You can take this tour again from here.' },
    ],
  },
  {
    key: 'staff', start: '/admin', who: 'staff', auto: true, translate: false,
    steps: [
      { el: 'admin-todo', title: 'Your to-do list', body: 'What waits for you today, from your roles: emails to answer, approvals, deadlines.' },
      { el: 'admin-company', title: 'Company filter', body: 'Pick a company, or All companies. Every admin page that works by company follows it, and it’s remembered as you move around.' },
      { el: 'admin-menu', title: 'Your sections', body: 'The admin by what you do. Your roles open: {sections}.' },
      { el: 'admin-approvals', title: 'Approvals', body: 'Changes that need a second person: what you’ve sent, and what waits for you.' },
      { el: 'admin-whats-new', title: 'What’s new', body: 'Changes to the portal you may notice, with a “Show me” for the bigger ones.' },
      { el: 'account-menu', title: 'Three views', body: 'View all shows every menu. View as admin shows only your work; View as investor shows what shareholders see, if you hold shares.', when: 'switch' },
      { el: 'account-menu', title: 'Your account', body: 'Your profile and photo, two-step sign-in and notifications. Take this tour again from here.' },
    ],
  },
  {
    key: 'director', start: '/sign', who: 'director', auto: true, translate: false,
    steps: [
      { el: 'sign-list', title: 'Papers to sign', body: 'Directors’ resolutions and minutes sent to you. Open one to read it and sign in the portal.' },
      { el: 'nav-sign', title: 'Always here', body: 'The number shows how many wait for you.' },
      { el: 'account-menu', title: 'Your account', body: 'Your profile, two-step sign-in and notifications. Take this tour again from here.' },
    ],
  },
  {
    key: 'audit-conditions', start: '/admin/audit', who: 'audit', auto: false, translate: false,
    steps: [
      { el: 'audit-rules', title: 'Conditions', body: 'Each line is a field, a rule and a value: for example Person · is not · you. Every condition must match.' },
      { el: 'audit-add', title: 'More conditions', body: 'Add as many as you need, then Filter. × removes one.' },
      { el: 'audit-export', title: 'Export', body: 'The CSV has exactly the events you filtered. Deleting events follows the same conditions too.' },
    ],
  },
  {
    key: 'profile-photo', start: '/profile', who: 'anyone', auto: false, translate: true,
    steps: [
      { el: 'profile-photo', title: 'Your photo', body: 'Choose a picture, then drag it and zoom until your face sits in the circle. It shows next to your name in the portal.' },
      { el: 'profile-language', title: 'Language', body: 'The portal’s menus and pages in English, Spanish, Italian or Chinese.' },
    ],
  },

  // ── Guides: one page's task, from its "Guide me" button ────────────────────────────────────────────
  {
    key: 'guide-proxy', start: '/agm/*', who: 'investor', auto: false, translate: true, guide: true,
    steps: [
      { el: 'agm-papers', title: 'Read the papers first', body: 'The notice of meeting explains each resolution and how the board recommends you vote.' },
      { el: 'agm-resolution', title: 'Choose for each resolution', body: 'Pick For, Against or Abstain for each of your holdings. Try it now: choose one.', advanceOn: 'change' },
      { el: 'agm-lodge', title: 'Lodge your proxy', body: 'Lodge proxy sends your choices to the chair. You can change them and lodge again until the deadline shown here.' },
      { el: 'agm-question', title: 'Questions before the meeting', body: 'Send the board a question in advance. The answer appears here and in your inbox.' },
    ],
  },
  {
    key: 'guide-passkey', start: '/account/security', who: 'anyone', auto: false, translate: true, guide: true,
    steps: [
      { el: 'security-passkeys', title: 'Passkeys', body: 'A passkey signs you in with Face ID, Touch ID, Windows Hello or your phone, instead of your password. Nobody can phish or guess it.' },
      { el: 'passkey-add', title: 'Add one on this device', body: 'Press Add a passkey and follow your device’s prompt. Give it a name you’ll recognise, such as “My iPhone”. Add one on each device you use.' },
      { el: 'security-two-step', title: 'Two-step verification', body: 'An extra code from an authenticator app when you sign in with your password. A passkey counts as two-step on its own.' },
    ],
  },
  {
    key: 'guide-share', start: '/profile', who: 'anyone', auto: false, translate: true, guide: true,
    steps: [
      { el: 'share-section', title: 'Share with your accountant', body: 'Give someone view-only access to a holding you own: its holdings, statements and tax-time packs. They can’t vote, sell or change anything.' },
      { el: 'share-form', title: 'Who to share with', body: 'Choose the holding, then their name and email. If they don’t have an account, they get an invitation.' },
      { el: 'share-list', title: 'Who can see your holdings', body: 'Everyone with access is listed here. Remove them at any time.' },
    ],
  },
  {
    key: 'guide-documents', start: '/admin/documents', who: 'documents', auto: false, translate: false, guide: true,
    steps: [
      { el: 'doc-upload', title: 'Upload a document', body: 'Open the form to add a document. Click it now.', advanceOn: 'click' },
      { el: 'doc-file', title: 'The file and its title', body: 'Choose the PDF, then give it the title shareholders will see. The summary shows in the list and in the notification.' },
      { el: 'doc-audience', title: 'Who can see it', body: 'All shareholders of the company, the board only, or one holder (for example a statement for that holder only).' },
      { el: 'doc-publish', title: 'When it goes out', body: 'Publish now tells shareholders straight away. Schedule publishes and tells them at the time you set. A draft stays with admins.' },
      { el: 'doc-approval', title: 'A second pair of eyes', body: 'Tick this to have someone approve it first. It stays a draft until they do.' },
      { el: 'doc-submit', title: 'Upload', body: 'It appears in the list below, where you can publish, unpublish or share it with the group later.' },
    ],
  },
  {
    key: 'guide-register', start: '/admin/import/register', who: 'register', auto: false, translate: false, guide: true,
    steps: [
      { el: 'reg-company', title: 'Pick the company', body: 'The register you’re importing belongs to one company.' },
      { el: 'reg-check', title: '1. Check the register', body: 'Choose the company secretary’s “register of members” PDF and press Check. Nothing changes yet: the portal reads it and checks every balance adds up.' },
      { el: 'reg-summary', title: 'What the register says', body: 'The holders, classes and balances the portal read from the PDF, as at its date. If something looks wrong, stop here.' },
      { el: 'reg-match', title: '2. Match the holders', body: 'Each register holder is matched to a holder in the portal, or added as new. Fix any wrong match, then update the preview. Matches are remembered next time.' },
      { el: 'reg-preview', title: '3. Preview', body: 'Every change to holdings, old to new. Still nothing has changed.' },
      { el: 'reg-confirm', title: '4. Confirm', body: 'Tick that you’ve reviewed it and import. Holdings take the register’s figures, with their history; afterwards you can tell shareholders their statements are ready.' },
    ],
  },
  {
    key: 'guide-paper', start: '/admin/legal/papers/*', who: 'papers', auto: false, translate: false, guide: true,
    steps: [
      { el: 'paper-text', title: 'The text', body: 'Write the resolution or minutes here. “## ” starts a heading and “1. ” a numbered resolution; the company’s name, ACN and signature lines are added to the PDF.' },
      { el: 'paper-preview', title: 'Check the PDF', body: 'Save the draft, then preview the PDF exactly as directors will sign it.' },
      { el: 'paper-signers', title: 'Who signs', body: 'A circular resolution is signed by every director in office; minutes by the chair. People marked “not invited” need a portal account first.' },
      { el: 'paper-send', title: 'Send for signing', body: 'Each signer gets an email and signs in the portal. The text is locked once someone signs; you can remind or take it back.' },
      { el: 'paper-signatures', title: 'Signatures', body: 'Who has signed, and when. When everyone has, the signed PDF goes to the minute book.' },
    ],
  },
];

export const tourByKey = (key: string | null | undefined) => TOURS.find((t) => t.key === key) ?? null;
/** Whether a tour's page is this one (`/agm/*`: any one page under /agm/). */
export const onPage = (start: string, path: string) => (start.endsWith('/*') ? path.startsWith(start.slice(0, -1)) && !path.slice(start.length - 1).includes('/') && path.length > start.length - 1 : start === path);

/** Texts of the buttons, translated with the shareholder tours. */
export const TOUR_BUTTONS = ['Next', 'Back', 'Done', 'Take the tour'];

/** Places an announcement's pop-up can point at (Admin → Announcements), by the same data-tour marks. */
export const POINTS: { el: string; label: string; for: 'investors' | 'staff' }[] = [
  { el: 'holding', label: 'Their holding (dashboard)', for: 'investors' },
  { el: 'nav-documents', label: 'The Documents menu', for: 'investors' },
  { el: 'nav-agm', label: 'The Meetings menu', for: 'investors' },
  { el: 'nav-news', label: 'The News menu', for: 'investors' },
  { el: 'nav-ask', label: 'The Ask menu', for: 'investors' },
  { el: 'nav-board', label: 'Ask the board', for: 'investors' },
  { el: 'inbox', label: 'The inbox', for: 'investors' },
  { el: 'account-menu', label: 'Their account menu', for: 'investors' },
  { el: 'admin-todo', label: 'The to-do list (Overview)', for: 'staff' },
  { el: 'admin-company', label: 'The company filter', for: 'staff' },
  { el: 'admin-menu', label: 'The admin menu', for: 'staff' },
  { el: 'admin-approvals', label: 'Approvals', for: 'staff' },
  { el: 'admin-whats-new', label: 'What’s new', for: 'staff' },
];
