// Guided tours (Driver.js, components/Tour.astro): short step-by-step overlays that point at parts of a page.
// Each step points at an element marked data-tour="…"; a step whose element isn't on the page (a feature
// the person doesn't have, the phone layout) is skipped. A tour starts by itself once, on its start page, for
// the people it's meant for; "Take the tour" in the profile menu and What's new's "Show me" replay them.
// npm run check:portal checks that every step's element exists and that shareholder tours are translated.
// No imports: the check script loads this file directly.

export type Who = 'investor' | 'staff' | 'director' | 'audit' | 'anyone';
/** `when`: shown only to people who can switch views (`switch`), or who have Ask (`ask`). */
export type TourStep = { el: string; title: string; body: string; when?: 'switch' | 'ask' };
export type Tour = {
  key: string;
  /** The page it runs on. */
  start: string;
  who: Who;
  /** Starts by itself on the first visit (otherwise only from a link). */
  auto: boolean;
  /** Shareholder tours are in every language (src/i18n); staff tours are in English, like the admin. */
  translate: boolean;
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
];

export const tourByKey = (key: string | null | undefined) => TOURS.find((t) => t.key === key) ?? null;

/** Texts of the buttons, translated with the shareholder tours. */
export const TOUR_BUTTONS = ['Next', 'Back', 'Done', 'Take the tour'];
