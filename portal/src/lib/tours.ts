// Guided tours (Driver.js, components/Tour.astro): short step-by-step overlays that point at parts of a page.
// Each step points at an element marked data-tour="…"; a step whose element isn't on the page (a feature
// the person doesn't have, the phone layout) is skipped. A tour starts by itself once, on its start page, for
// the people it's meant for; "Take the tour" in the profile menu and What's new's "Show me" replay them.
// Guides (`guide: true`) are tours for one page's task: they never start by themselves; the page shows a
// "Guide me" button. A step can wait for the person to act (`advanceOn`), and a step whose element is inside
// a closed fold-out opens it. `start` may end in /* for pages with an id (/agm/*),
// or have a * in the middle (/admin/press/*/channels).
// npm run check:portal checks that every step's element exists and that shareholder tours are translated.
// No imports: the check script loads this file directly.

export type Who = 'investor' | 'staff' | 'director' | 'audit' | 'anyone' | 'documents' | 'register' | 'papers'
  | 'investors' | 'news' | 'newsletters' | 'data-rooms' | 'announcements' | 'roles' | 'equity' | 'reporting'
  /** Whoever may open the guide's page (the admin's own access check). */
  | 'page';
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
    key: 'audit-conditions', start: '/admin/audit', who: 'audit', auto: false, translate: false, guide: true,
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
  {
    key: 'guide-board', start: '/board', who: 'investor', auto: false, translate: true, guide: true,
    steps: [
      { el: 'board-form', title: 'Your question', body: 'Give it a short subject, then write your question. Keep it to the company’s operations, performance or governance.' },
      { el: 'board-terms', title: 'The terms', body: 'Tick to agree to the terms for shareholder queries. Open them to read what the board will and won’t answer.' },
      { el: 'board-send', title: 'Send it to the board', body: 'The board aims to reply within 7 working days. The answer appears on the question’s page and in your inbox.' },
      { el: 'board-list', title: 'Your questions', body: 'Each one shows whether it’s awaiting a reply or answered. Open it to read the answer or reply.' },
    ],
  },
  {
    key: 'guide-trade', start: '/trading', who: 'investor', auto: false, translate: true, guide: true,
    steps: [
      { el: 'trade-window', title: 'The trading window', body: 'Interests can only be registered while the window is open. Its dates are shown here.' },
      { el: 'trade-form', title: 'Register an interest', body: 'Choose to buy or sell, the holding and the share class, then how many shares and the price per share. It’s an interest, not a binding offer.' },
      { el: 'trade-ack', title: 'Confirm and register', body: 'Tick that you understand, then press Register interest. The company is told straight away.' },
      { el: 'trade-book', title: 'The order book', body: 'Other shareholders’ open interests, without names, if the company shows them. Prices are what they proposed, not a valuation.' },
      { el: 'trade-mine', title: 'What happens next', body: 'Your interests and where they stand. When the company pairs yours with another shareholder’s, it contacts you to arrange the signed transfer.' },
      { el: 'trade-withdraw', title: 'Changed your mind?', body: 'Withdraw takes back an open interest. Once part of it is paired, contact the company instead.' },
    ],
  },
  {
    key: 'guide-ask', start: '/ask', who: 'anyone', auto: false, translate: true, guide: true,
    steps: [
      { el: 'ask-examples', title: 'Not sure where to start?', body: 'Pick one of these to see how {ask} answers.' },
      { el: 'ask-input', title: 'Ask in your own words', body: 'Type your question and press Enter or the arrow. Ask follow-up questions in the same conversation.' },
      { el: 'ask-sources', title: 'Check the sources', body: 'Under each answer are the documents it used. Open one to read it in full; answers aren’t financial advice.' },
      { el: 'ask-rate', title: 'Was it useful?', body: '👍 or 👎 tells the company how the answer did. After 👎 you can say what was wrong.' },
      { el: 'ask-new', title: 'A new topic', body: 'New conversation starts afresh. The one you were in is kept.' },
      { el: 'ask-history', title: 'Your conversations', body: 'Kept for 12 months, and only you can see them. Open one to read it again or carry on, or search them by a word.' },
    ],
  },
  {
    key: 'guide-investors', start: '/admin/investors', who: 'investors', auto: false, translate: false, guide: true,
    steps: [
      { el: 'inv-filters', title: 'Find people', body: 'Search by name, email or holder, and narrow by role, status, two-step, Ask or Board Q&A. The filters stay in the address, so you can share the view.' },
      { el: 'inv-table', title: 'The list', body: 'Click a column heading to sort, and again to reverse. A holder’s name opens its holdings.' },
      { el: 'inv-add', title: 'Add an investor', body: 'Open the form to add a shareholder. Click it now.', advanceOn: 'click' },
      { el: 'inv-holder', title: 'Who they invest through', body: 'Every investor is linked to a holder: themselves, their company or their trust. Staff are added in System → Users instead.' },
      { el: 'inv-invite', title: 'Invite now or later', body: 'Add and send invitation emails them a link to choose a password. Add without inviting sends nothing until you’re ready.' },
      { el: 'inv-welcome', title: 'Welcome emails', body: 'With a company picked, invite its shareholders who have never signed in, up to 50 at a time. Start with a few friendly ones.' },
    ],
  },
  {
    key: 'guide-news', start: '/admin/news/*', who: 'news', auto: false, translate: false, guide: true,
    steps: [
      { el: 'news-text', title: 'Write the story', body: 'The toolbar adds headings, links, images, videos and tables. Paste from Word or Google Docs, or drag images in.' },
      { el: 'news-audience', title: 'Who sees it', body: 'Shareholders of the company see it in the portal only. Public puts it on the websites too, for every investor and visitor.' },
      { el: 'news-where', title: 'Where it appears', body: 'Public news goes on the company’s own website, and on lakeba.com when a Lakeba group editor adds it.' },
      { el: 'news-status', title: 'When it goes live', body: 'Draft keeps it hidden. Publish now puts it live when you save; Schedule at the date and time you choose.' },
      { el: 'news-notify', title: 'Tell shareholders', body: 'Tick this to notify the company’s shareholders when it goes live. They’re only told once.' },
      { el: 'news-actions', title: 'Check, then save', body: 'Preview opens it as readers will see it; Full screen puts a live preview beside the editor. Save keeps a version you can go back to.' },
    ],
  },
  {
    key: 'guide-newsletter', start: '/admin/newsletters/*', who: 'newsletters', auto: false, translate: false, guide: true,
    steps: [
      { el: 'nl-start', title: 'Start an issue', body: 'Write rough notes and Lakeba AI drafts the issue, or pick a template below. Everything stays editable before it goes out.' },
      { el: 'nl-modes', title: 'Compose, Designer or HTML', body: 'Three ways to write it. Switching keeps each version saved; the tab that’s active is the one sent.' },
      { el: 'nl-content', title: 'What goes in', body: 'Tick the news and documents to include. For shareholders you can add upcoming meetings, and in Compose each reader’s holding.' },
      { el: 'nl-audience', title: 'Who gets it', body: 'Pick the company and which shareholders. The count shows how many it goes to; people who unsubscribed are left out.' },
      { el: 'nl-test', title: 'Send yourself a test', body: 'Save, then send a test to your own inbox and check it there, on your phone too.' },
      { el: 'nl-send', title: 'Schedule or send', body: 'Schedule it for a date and time, or press Send now below. Sending can’t be undone; afterwards this page shows opens and clicks.' },
    ],
  },
  {
    key: 'guide-data-room', start: '/admin/data-rooms', who: 'data-rooms', auto: false, translate: false, guide: true,
    steps: [
      { el: 'dr-new', title: 'Create a room', body: 'One room per raise or deal, for one company. Give it a name and, if you like, a note for guests.' },
      { el: 'dr-terms', title: 'Confidentiality terms', body: 'Guests agree to these before they see anything. It’s a plain-English starting point: have your lawyer check it.' },
      { el: 'dr-documents', title: 'Choose the documents', body: 'Tick the company’s PDFs to share, then Save documents. They don’t need to be published to investors.' },
      { el: 'dr-test', title: 'Check it as a guest', body: 'Open TEST link shows the room as a guest sees it, in your name. No email is sent.' },
      { el: 'dr-invite', title: 'Invite a guest', body: 'Their name, email and how many days their link works. They get a personal link by email; every page shows their name.' },
      { el: 'dr-guests', title: 'Who has seen what', body: 'Each guest’s status, when they agreed to the terms and what they viewed. New link replaces their link; Revoke stops it.' },
    ],
  },
  {
    key: 'guide-announcement', start: '/admin/content', who: 'announcements', auto: false, translate: false, guide: true,
    steps: [
      { el: 'ann-text', title: 'The banner', body: 'A title and a line of text, at the top of the dashboard (shareholders) or the admin Overview (staff). The link is optional.' },
      { el: 'ann-audience', title: 'Who it’s for', body: 'Shareholders, staff or both. For staff you can narrow it to people with access to one section.' },
      { el: 'ann-popup', title: 'Show as a pop-up once', body: 'Each person it’s for also sees it as a pop-up, once, while it’s live. Point at makes the pop-up point at a place on the page.' },
      { el: 'ann-languages', title: 'Other languages', body: 'Spanish, Italian and Chinese, for shareholders using the portal in those languages. Anything left empty shows in English.' },
      { el: 'ann-list', title: 'Live and past announcements', body: 'Showing, scheduled or ended, and how many have seen each pop-up. Preview pop-up shows it to you without counting it.' },
    ],
  },
  {
    key: 'guide-role', start: '/admin/system/roles/*', who: 'roles', auto: false, translate: false, guide: true,
    steps: [
      { el: 'role-perms', title: 'See, Do, Approve', body: 'For each area: See opens its pages, Do lets people add and change things, and Approve lets them sign off where something asks for it. Do and Approve include See.' },
      { el: 'role-about', title: 'What it’s for, and Save', body: 'A line on when to give this role. Save applies the changes to everyone who has it, straight away.' },
      { el: 'role-holders', title: 'Who has it', body: 'A role is given for the whole group or for one company, sometimes until a date. Give it or take it away on a person’s page in Users.' },
    ],
  },
  {
    key: 'guide-grant', start: '/admin/hr/equity/*', who: 'equity', auto: false, translate: false, guide: true,
    steps: [
      { el: 'eq-position', title: 'Where it stands', body: 'How many have vested, how many haven’t yet, how many were exercised, and how many can be exercised now.' },
      { el: 'eq-actions', title: 'Grant it', body: 'Grant it makes the letter and asks the holder to accept it in My HR. Prepare the board resolution opens a paper in Legal, filled in from the grant.' },
      { el: 'eq-vesting', title: 'Vesting', body: 'The schedule from the grant’s terms: how many have vested by each date. Dates already passed are brighter.' },
      { el: 'eq-exercises', title: 'Exercises', body: 'Record a request, then approve it once it’s paid: issuing the shares and telling ASIC goes on the Legal calendar. Mark the shares issued when done.' },
    ],
  },
  {
    key: 'guide-pack', start: '/admin/reporting/*', who: 'reporting', auto: false, translate: false, guide: true,
    steps: [
      { el: 'rep-source', title: '1. The figures', body: 'With Xero connected, the figures are fetched for the period. Otherwise upload the profit and loss and balance sheet (Excel, CSV or PDF) and Lakeba AI reads them in.' },
      { el: 'rep-figures', title: '2. Check the figures', body: 'Check each line against your accounts and correct anything. Notes in orange point at what looks unusual next to the last pack.' },
      { el: 'rep-group', title: 'Other group companies', body: 'What’s owed between this company and the others in the group, and fees or recharges. Lakeba removes these when it adds the group up.' },
      { el: 'rep-note', title: '3. A note on the period', body: 'Big wins, one-offs, anything Lakeba should know when it reviews the figures.' },
      { el: 'rep-send', title: 'Send to Lakeba', body: 'Save keeps your changes. Send to Lakeba hands the pack to the finance team; if they have questions, it comes back to you.' },
      { el: 'rep-messages', title: 'Messages with Lakeba', body: 'Questions and answers about this pack. Once it’s sent, tell Lakeba about any change here.' },
    ],
  },

  // ── Marketing ──
  {
    key: 'guide-media', start: '/admin/press/media', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'media-add', title: 'Add journalists', body: 'Import a list (CSV or Excel), let Lakeba AI find journalists for a beat, or add one contact by hand. Each email is added once.' },
      { el: 'media-filters', title: 'Find contacts', body: 'Search by name, email, outlet or notes, and narrow by beat, outlet, role and status. Only active contacts show until you change Status.' },
      { el: 'media-table', title: 'The list', body: 'Open a name to change their details or notes. Last pitched shows when they last got a release from you.' },
    ],
  },
  {
    key: 'guide-press', start: '/admin/press/*', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'press-points', title: 'Start from the head points', body: 'What to announce, in a few lines. Draft with AI writes the headline, text, quotes and summary from them; [square brackets] mark what to fill in.' },
      { el: 'press-quotes', title: 'Quotes', body: 'Each quote must also be in the text exactly as written. Send for approval emails the person a link to approve or change their words.' },
      { el: 'press-checks', title: 'Check the release', body: 'Lakeba AI reads the text and lists points to check; serious ones are in red. Run it again after any change: approval needs a check of the final text.' },
      { el: 'press-release', title: 'Embargo and approval', body: 'Set an embargo if journalists get it early, save, then Send for approval. You can keep improving it while it waits.' },
      { el: 'press-approve', title: 'Approve and publish', body: 'For approvers: publish now or at a set time, and choose whether the company’s investors are told in the portal.' },
      { el: 'press-send', title: 'Send it out', body: 'Once approved, New distribution pitches it to journalists from the media database. Social and wires has the LinkedIn, Bluesky and X posts and the wire services.' },
    ],
  },
  {
    key: 'guide-channels', start: '/admin/press/*/channels', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'chan-social', title: 'Social posts', body: 'The texts for LinkedIn, Bluesky and X. Approvers post on Bluesky and X from here once the release is public; LinkedIn is shared by a page admin.' },
      { el: 'chan-save', title: 'Save the texts', body: 'Anyone writing the release can prepare and save them. Posting waits for an approver.' },
      { el: 'chan-wires', title: 'Wire services', body: 'Download the wire package (text, Word copy, PDF and images), or email it to a wire’s desk. Before publication it’s marked embargoed.' },
      { el: 'chan-record', title: 'Record where it went', body: 'After a wire submission or a LinkedIn post, record it with its link and any cost.' },
      { el: 'chan-history', title: 'Where it went', body: 'Every post and submission, with what it cost in all.' },
    ],
  },
  {
    key: 'guide-linkedin', start: '/admin/linkedin', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'li-stats', title: 'How it’s going', body: 'How many Lakeba Group members have clicked the link, all clicks, and when it was last sent. A click isn’t a follow: LinkedIn doesn’t say who follows.' },
      { el: 'li-message', title: 'The message', body: 'The title and text members get in their inbox, and by email if they’ve turned email on.' },
      { el: 'li-options', title: 'Email and banner', body: 'Untick email to send to the inbox only. The banner shows on the dashboard for the days you choose.' },
      { el: 'li-send', title: 'Send to all members', body: 'Sends the invitation to every Lakeba Group member: shareholders and the board.' },
      { el: 'li-remind', title: 'Remind the rest', body: 'Later, send a reminder only to members who haven’t clicked yet. It skips the banner.' },
      { el: 'li-sources', title: 'Where clicks come from', body: 'The banner, the inbox, email and other links, so you can see what works.' },
    ],
  },

  // ── Legal ──
  {
    key: 'guide-legal', start: '/admin/legal', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'legal-stats', title: 'At a glance', body: 'What’s overdue, what’s due in the next 30 days, open requests from the ventures, and records still to complete.' },
      { el: 'legal-due', title: 'What’s due', body: 'Open one to mark it done with its proof, say it isn’t needed, give it to someone or move the date. Lodging with ASIC stays with you.' },
      { el: 'legal-records', title: 'Records to complete', body: 'The calendar works out deadlines from each company’s record. Reading a current ASIC extract fills in most of it.' },
    ],
  },
  {
    key: 'guide-contracts', start: '/admin/legal/contracts', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'contracts-import', title: 'Import contracts', body: 'Drop in PDF or Word files, many at once. Lakeba AI reads each one’s parties, dates, renewal and notice terms.' },
      { el: 'contracts-show', title: 'Which contracts', body: 'In force, ending in the next four months, to check, not signed yet or ended. To check lists those Lakeba AI read that nobody has checked.' },
      { el: 'contracts-search', title: 'Search', body: 'By title, other party or what it’s about, and by company and kind.' },
      { el: 'contracts-list', title: 'Open a contract', body: 'Check what Lakeba AI read against the file and correct it. Its dates go on the calendar once it’s checked.' },
    ],
  },
  {
    key: 'guide-contract', start: '/admin/legal/contracts/*', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'contract-check', title: 'Read it beside the file', body: 'Open the contract and compare it with what Lakeba AI read. Choose who looks after it, and add notes.' },
      { el: 'contract-terms', title: 'The contract', body: 'The group company that’s a party, the other party, kind, state, value and what it is.' },
      { el: 'contract-dates', title: 'Dates', body: 'When it ends or next renews, whether it renews by itself, and the notice needed to end it. These set the calendar reminders.' },
      { el: 'contract-clauses', title: 'Clauses worth knowing', body: 'Change of control, assignment, exclusivity, liability cap, termination and our main obligations, with points a lawyer would want to know.' },
      { el: 'contract-calendar', title: 'Check, then calendar', body: 'Save and mark checked puts the last day to give notice and the end date on the Legal calendar.' },
    ],
  },
  {
    key: 'guide-company-legal', start: '/admin/legal/companies/*', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'co-tabs', title: 'The record’s parts', body: 'Record, Officers, Board (its resolutions, minutes and meetings) and Calendar, plus the company’s contracts.' },
      { el: 'co-extract', title: 'Read an ASIC extract', body: 'The quickest start: upload a current company extract and Lakeba AI reads the details and officers. You check them before anything is saved.' },
      { el: 'co-record', title: 'Company record', body: 'Keep it matching ASIC’s. The calendar works out the annual review, solvency resolution and other deadlines from it.' },
      { el: 'co-officers', title: 'Officers', body: 'Open someone to change their details, file their consent or invite them to sign in the portal. When they resign, set the date they stopped.' },
      { el: 'co-add-officer', title: 'Add an officer', body: 'A recent appointment adds “Tell ASIC” to the calendar, due 28 days after it.' },
      { el: 'co-calendar', title: 'What’s due', body: 'Open an item to mark it done with its proof, give it to someone or move it. Add your own items below.' },
    ],
  },
  {
    key: 'guide-legal-request', start: '/admin/legal/requests/*', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'lreq-thread', title: 'The conversation', body: 'The venture’s request and every reply. Internal notes, in orange, are for the Legal team only.' },
      { el: 'lreq-triage', title: 'Lakeba AI’s triage', body: 'A summary, what to watch for, what’s still needed, related contracts and a first view. Only the Legal team sees it; it’s a starting point, not advice.' },
      { el: 'lreq-reply', title: 'Reply or note', body: 'Reply to the venture tells them, and Then sets where it stands. Save as internal note keeps it in the team. Either can carry files.' },
      { el: 'lreq-details', title: 'Who has it', body: 'Its state, who it’s with, urgency and kind. Marking it done or cancelled tells the venture.' },
    ],
  },
  {
    key: 'guide-ask-legal', start: '/admin/legal-requests', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'lr-new', title: 'A new request', body: 'Choose the company it’s for and what you need: a contract to review or draft, a question, anything legal.' },
      { el: 'lr-details', title: 'Say what you need', body: 'What it’s about, who the other party is, what worries you and any deadline. Add the contract or other files.' },
      { el: 'lr-send', title: 'Send to Lakeba Legal', body: 'The Legal team is told straight away. You’re told when they reply.' },
      { el: 'lr-open', title: 'Your requests', body: 'Where each one stands. “Waiting for you” means Legal needs something from you: open it to reply.' },
    ],
  },
  {
    key: 'guide-legal-ask', start: '/admin/legal/ask', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'la-about', title: 'What it knows', body: 'The companies’ contracts, records, officers, deadlines, signed papers and governance documents in the portal. It finds and summarises; it doesn’t give legal advice.' },
      { el: 'la-question', title: 'Ask in your own words', body: 'A question within half an hour of your last follows on from it. Ask as a new topic starts afresh.' },
      { el: 'la-answer', title: 'Answers and sources', body: 'Each answer links to the records it used. Open one to check it before relying on the answer.' },
    ],
  },

  // ── Board & governance ──
  {
    key: 'guide-board-meeting', start: '/admin/legal/meetings/*', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'meet-agenda', title: 'Agenda and notes', body: 'Write the agenda, and your notes of what was discussed and decided, in any form. Lakeba AI turns them into minutes.' },
      { el: 'meet-attendees', title: 'Who was there', body: 'Untick a director who sent apologies, choose the chair, and add anyone else attending, one per line.' },
      { el: 'meet-observer', title: 'Record it in the room', body: 'Open the Observer on the boardroom tablet: connect it with the six-digit code it shows. After the meeting the transcript comes here; the audio is deleted once the minutes are signed.' },
      { el: 'meet-online', title: 'Lex in an online meeting', body: 'Paste the Teams, Zoom, Google Meet or Webex link and Send Lex: it joins, records and answers “Lex, …” questions. In Teams and Google Meet, admit it from the lobby.' },
      { el: 'meet-transcript', title: 'Or add a transcript', body: 'For a meeting recorded elsewhere, upload the transcript Teams, Zoom or Google Meet made (.vtt or .txt).' },
      { el: 'meet-minutes', title: 'Draft the minutes', body: 'Lakeba AI writes them from the agenda, notes and transcript. Check and change them before they go to the chair to sign.' },
    ],
  },
  {
    key: 'guide-boardroom', start: '/admin/boardroom', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'br-company', title: 'Each board you run', body: 'One card per company. The badge shows whether its board assistant (the Observer, Lex and the decks Lex presents) is switched on.' },
      { el: 'br-meetings', title: 'Its meetings', body: 'Newest first, and whether each was recorded and where its minutes stand. Open one for the agenda, recording and minutes.' },
      { el: 'br-new', title: 'A new meeting', body: 'Its title, when and where. Add opens it, ready for the agenda.' },
    ],
  },
  {
    key: 'guide-board-ask', start: '/admin/board-ask', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'bask-examples', title: 'Not sure where to start?', body: 'Pick one of these to see how Board Ask answers.' },
      { el: 'bask-input', title: 'Ask about the companies or the law', body: 'Their figures, records, contracts and deadlines, and the law that applies. Thorough answers take a minute or so.' },
      { el: 'bask-sources', title: 'Every fact has a source', body: 'Records, documents, the law library or official websites. Open one to check it; answers aren’t legal or financial advice.' },
      { el: 'bask-rate', title: 'Was it right?', body: 'Helpful, or Something’s wrong with a note: Lakeba’s admins use it to check the answers.' },
      { el: 'bask-history', title: 'Your conversations', body: 'Open one to read it again or carry on. New conversation starts afresh.' },
    ],
  },
  {
    key: 'guide-shareholder-meeting', start: '/admin/agm/*', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'sm-details', title: 'Meeting details', body: 'When it starts, the proxy deadline, where it is, a livestream link, and the notice of meeting from Documents.' },
      { el: 'sm-new-resolution', title: 'Add the resolutions', body: 'Number, title, ordinary or special, and the explanation shareholders read before they vote.' },
      { el: 'sm-status', title: 'Open proxy voting', body: 'Moving it to open tells shareholders and opens proxy voting. Results publishes the outcomes and tells them. If approval was asked for, both wait for it.' },
      { el: 'sm-votes', title: 'Votes as they come in', body: 'For, against and abstain, in shares and holders. After the meeting, set each resolution’s outcome.' },
      { el: 'sm-questions', title: 'Questions sent in advance', body: 'Answer each one here. The shareholder sees the answer and is told.' },
      { el: 'sm-preview', title: 'See what shareholders see', body: 'View as shareholder opens the meeting’s page in the portal.' },
    ],
  },
  {
    key: 'guide-minute-book', start: '/admin/legal/minute-book', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'mb-table', title: 'Each company’s minute book', body: 'How many minutes and resolutions are signed, and when the last one was.' },
      { el: 'mb-open', title: 'One PDF', body: 'Open the minute book: every signed minutes and resolution, in date order, as one PDF.' },
    ],
  },
  {
    key: 'guide-deadlines', start: '/admin/legal/calendar', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'cal-filters', title: 'What to show', body: 'By company, kind, who looks after it, and open or done.' },
      { el: 'cal-items', title: 'Deal with an item', body: 'Open one to mark it done with its proof (an ASIC receipt or signed resolution), say it isn’t needed, give it to someone or move the date.' },
      { el: 'cal-add', title: 'Add your own', body: 'Deadlines the portal can’t work out, such as renewing a business name.' },
      { el: 'cal-feed', title: 'In your own calendar', body: 'A private address for Outlook or Google Calendar with the open deadlines. Keep it to yourself: anyone with it can see them.' },
    ],
  },

  // ── HR ──
  {
    key: 'guide-people', start: '/admin/hr', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'hr-show', title: 'Who to show', body: 'Current staff, those who have left, or all, and by company.' },
      { el: 'hr-list', title: 'The list', body: 'Open someone for their checklist, documents, grants and policies. Starting and leaving show in orange.' },
      { el: 'hr-add', title: 'Someone starting', body: 'Their company, name, work email, role and start date. They’re added with the onboarding checklist.' },
    ],
  },
  {
    key: 'guide-person', start: '/admin/hr/people/*', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'person-checklist', title: 'Starting or leaving', body: 'The checklist, with who does each task and by when. Tick each one as it’s done.' },
      { el: 'person-stand', title: 'Where they stand', body: 'Mark that they’ve started and invite them to My HR. When they resign, set their last day to start the leaving checklist.' },
      { el: 'person-docs', title: 'Documents', body: 'Their contract, letters, reviews and other files. Tick They see it to share one with them in My HR.' },
      { el: 'person-grants', title: 'Option grants', body: 'Their grants and how many have vested. Grant options opens a new grant for them.' },
      { el: 'person-policies', title: 'Policies', body: 'The policies they must accept, and when they did.' },
      { el: 'person-private', title: 'Private details', body: 'Date of birth, home address, phone and emergency contact, kept encrypted. Each look is recorded in the audit log.' },
    ],
  },
  {
    key: 'guide-policy', start: '/admin/hr/policies/*', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'pol-text', title: 'The policy', body: 'Its text, in plain words: HR Ask answers staff questions from it. Or attach it as a PDF.' },
      { el: 'pol-ack', title: 'Must staff accept it?', body: 'Tick it and choose within how many days. Leave it unticked for a policy that’s for reference only.' },
      { el: 'pol-publish', title: 'Publish', body: 'Staff are asked to accept it in My HR. Changing a published policy makes a new version that everyone accepts again; Archive hides it.' },
      { el: 'pol-accepted', title: 'Who has accepted', body: 'Everyone it applies to, and when they accepted this version. “Not in the portal” means they haven’t been invited to My HR.' },
    ],
  },
  {
    key: 'guide-equity-plans', start: '/admin/hr/equity', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'eqp-plans', title: 'The plans', body: 'Each plan’s pool: how much is in use, vested, exercised and left.' },
      { el: 'eqp-grants', title: 'Every grant', body: 'Who holds it, how many have vested and been exercised. Open one to grant it, see its vesting and record exercises.' },
      { el: 'eqp-grant', title: 'A new grant', body: 'The plan, the person (or another holder’s name), how many and the exercise price. Empty vesting fields use the plan’s. It starts as a draft.' },
      { el: 'eqp-plan', title: 'A new plan', body: 'The company’s option, rights or share plan: its pool, usual vesting and cliff, and how long a leaver has to exercise.' },
    ],
  },
  {
    key: 'guide-my-hr', start: '/my-hr', who: 'anyone', auto: false, translate: false, guide: true,
    steps: [
      { el: 'myhr-accept', title: 'To read and accept', body: 'New and updated policies your employer asks you to accept. Open one to read it.' },
      { el: 'myhr-grants', title: 'Your option grants', body: 'How many have vested and how many you can exercise now. Open a grant to accept it or ask to exercise.' },
      { el: 'myhr-docs', title: 'Your documents', body: 'Files HR has shared with you, such as your contract.' },
      { el: 'myhr-policies', title: 'All policies', body: 'Everything your employer has published, and which ones you’ve accepted.' },
      { el: 'myhr-ask', title: 'Ask about a policy', body: 'HR Ask answers questions from your employer’s policies.' },
    ],
  },
  {
    key: 'guide-sign', start: '/sign/*', who: 'anyone', auto: false, translate: false, guide: true,
    steps: [
      { el: 'sign-doc', title: 'Read it first', body: 'The resolution or minutes exactly as they’ll be signed. Open it in a new tab to read it full size.' },
      { el: 'sign-verify', title: 'Confirm it’s you', body: 'Signing needs two-step verification, with an authenticator app or a passkey. The first time takes a minute to set up.' },
      { el: 'sign-form', title: 'Sign', body: 'Type your full name and tick that you’ve read it. Your electronic signature has the same effect as your handwritten one.' },
      { el: 'sign-decline', title: 'Can’t sign it?', body: 'Say why and decline. The company secretary sees your note.' },
      { el: 'sign-others', title: 'Who has signed', body: 'Each signer and where they stand. Once everyone has signed, the signed copy opens here.' },
    ],
  },

  // ── Compliance ──
  {
    key: 'guide-approvals', start: '/admin/approvals', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'appr-lists', title: 'Three lists', body: 'Waiting for your approval: what you can decide. Asked by you: your open requests and any sent back. Others: recent decisions in your areas.' },
      { el: 'appr-item', title: 'Open an item', body: 'See what it is and its history, then approve it or ask for changes. You can’t approve something you asked for yourself.' },
    ],
  },
  {
    key: 'guide-approval', start: '/admin/approvals/*/*', who: 'page', auto: false, translate: false, guide: true,
    steps: [
      { el: 'appr-what', title: 'What it is', body: 'The item’s key facts, a link to open or preview it, and who asked, approved or sent it back.' },
      { el: 'appr-state', title: 'Where it stands', body: 'Who asked and when. While it waits, the item is held back; once approved it can go ahead, and changing it asks again.' },
      { el: 'appr-decide', title: 'Your decision', body: 'Approve lets it go ahead. Ask for changes sends it back with your note, which is needed. The person who asked is told either way.' },
      { el: 'appr-ask', title: 'Ask for approval', body: 'Approval is optional. Ask, with a note for the approver if you like, and people who can approve are told.' },
    ],
  },
];

export const tourByKey = (key: string | null | undefined) => TOURS.find((t) => t.key === key) ?? null;
// Whether a tour's page is this one (`/agm/*`: any one page under /agm/; `/admin/press/*/channels`: a * in the
// middle stands for one part of the address).
export const onPage = (start: string, path: string) => {
  if (start.includes('/*/')) {
    const a = start.split('/'), b = path.split('/');
    return a.length === b.length && a.every((part, i) => (part === '*' ? b[i] !== '' : part === b[i]));
  }
  return start.endsWith('/*') ? path.startsWith(start.slice(0, -1)) && !path.slice(start.length - 1).includes('/') && path.length > start.length - 1 : start === path;
};

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
