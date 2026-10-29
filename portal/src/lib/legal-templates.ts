// Directors' resolution templates (Admin → Legal → a company → Board → New
// resolution). Each asks for a few details and writes the background and the
// resolutions; the text can be changed before it is sent for signing. The
// wording is a starting point for Australian companies under the Corporations
// Act 2001 (Cth) and the replaceable rules: Lakeba's lawyer reviews it, and a
// company's constitution may say otherwise.
//
// Body text: "## " starts a heading, "1. " a numbered resolution, a blank line
// a new paragraph (legal-pdf.ts lays it out).

export type Field = {
  name: string; label: string; type: 'text' | 'date' | 'number' | 'textarea' | 'director' | 'select';
  options?: string[]; placeholder?: string; optional?: boolean; hint?: string;
};
export type Context = { company: string; acn: string | null; values: Record<string, string>; today: string };
export type Template = {
  key: string; group: 'Officers' | 'Shares' | 'Annual' | 'Banking and contracts'; label: string; description: string;
  fields: Field[];
  /** A calendar item this kind of resolution settles. */
  settles?: 'solvency';
  build: (c: Context) => { title: string; body: string };
};

const date = (d: string) => (d ? new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`)) : '');
const num = (v: string) => (v && !Number.isNaN(Number(v)) ? new Intl.NumberFormat('en-AU').format(Number(v)) : v);
const money = (v: string) => (v && !Number.isNaN(Number(v)) ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(Number(v)) : v);
const lines = (v: string) => v.split('\n').map((l) => l.trim()).filter(Boolean);
const numbered = (items: string[]) => items.map((t, i) => `${i + 1}. ${t}`).join('\n');
const doc = (background: string[], resolutions: string[]) => `## Background\n\n${background.join('\n\n')}\n\n## Resolutions\n\nThe directors resolve that:\n\n${numbered(resolutions)}`;
const NOTIFY = 'Any director or the company secretary is authorised to notify ASIC of these changes within the time required and to update the Company’s registers.';

export const TEMPLATES: Template[] = [
  {
    key: 'appoint_director', group: 'Officers', label: 'Appoint a director', description: 'A new director, with their consent and director ID.',
    fields: [
      { name: 'name', label: 'Full name', type: 'text' },
      { name: 'from', label: 'Appointed from', type: 'date' },
    ],
    build: ({ values: v }) => ({
      title: `Appointment of ${v.name} as a director`,
      body: doc([
        `${v.name} has consented in writing to act as a director of the Company and has given the Company their director identification number.`,
      ], [
        `${v.name} is appointed as a director of the Company with effect from ${date(v.from)}.`,
        `The consent to act is to be kept with the Company’s records.`,
        NOTIFY,
      ]),
    }),
  },
  {
    key: 'director_resigns', group: 'Officers', label: 'A director resigns', description: 'Accept a director’s written resignation.',
    fields: [
      { name: 'director', label: 'Director', type: 'director' },
      { name: 'letter', label: 'Resignation letter dated', type: 'date' },
      { name: 'from', label: 'Resigns from', type: 'date' },
    ],
    build: ({ values: v }) => ({
      title: `Resignation of ${v.director} as a director`,
      body: doc([
        `${v.director} has given the Company written notice, dated ${date(v.letter)}, of their resignation as a director.`,
        'A director of a proprietary company may be removed against their will only by the members (or as the constitution allows); this resolution records a resignation.',
      ], [
        `The resignation of ${v.director} as a director of the Company, with effect from ${date(v.from)}, is accepted and recorded.`,
        `The directors thank ${v.director} for their service to the Company.`,
        NOTIFY,
      ]),
    }),
  },
  {
    key: 'appoint_secretary', group: 'Officers', label: 'Appoint a company secretary', description: 'A new secretary, with their consent.',
    fields: [
      { name: 'name', label: 'Full name', type: 'text' },
      { name: 'from', label: 'Appointed from', type: 'date' },
    ],
    build: ({ values: v }) => ({
      title: `Appointment of ${v.name} as company secretary`,
      body: doc([`${v.name} has consented in writing to act as secretary of the Company.`], [
        `${v.name} is appointed as secretary of the Company with effect from ${date(v.from)}.`,
        NOTIFY,
      ]),
    }),
  },
  {
    key: 'registered_office', group: 'Officers', label: 'Change the registered office', description: 'A new registered office address.',
    fields: [
      { name: 'address', label: 'New address', type: 'text' },
      { name: 'from', label: 'From', type: 'date' },
      { name: 'occupier', label: 'Premises', type: 'select', options: ['The Company occupies the premises', 'Another occupier has consented in writing'] },
    ],
    build: ({ values: v }) => ({
      title: 'Change of registered office',
      body: doc([
        v.occupier === 'Another occupier has consented in writing'
          ? 'The Company does not occupy the premises; the occupier has consented in writing to the address being used as the Company’s registered office.'
          : 'The Company occupies the premises.',
      ], [
        `The registered office of the Company is changed to ${v.address} with effect from ${date(v.from)}.`,
        NOTIFY,
      ]),
    }),
  },
  {
    key: 'issue_shares', group: 'Shares', label: 'Issue shares', description: 'Allot and issue shares to one or more people.',
    fields: [
      { name: 'class', label: 'Class of shares', type: 'text', placeholder: 'Ordinary' },
      { name: 'price', label: 'Price per share (A$)', type: 'number' },
      { name: 'allottees', label: 'Who gets how many', type: 'textarea', placeholder: 'Jane Citizen – 10000\nACME Pty Ltd – 25000', hint: 'One per line.' },
      { name: 'on', label: 'Issue date', type: 'date' },
      { name: 'purpose', label: 'Why (optional)', type: 'text', optional: true, placeholder: 'e.g. Seed round, under the subscription agreements dated …' },
    ],
    build: ({ values: v }) => {
      const who = lines(v.allottees);
      return {
        title: `Issue of ${v.class || 'ordinary'} shares`,
        body: doc([
          `${v.purpose ? `${v.purpose}. ` : ''}The persons listed below have applied for ${v.class || 'ordinary'} shares in the Company at ${money(v.price)} per share.`,
          who.map((w) => `• ${w}`).join('\n'),
        ], [
          `The Company allots and issues the ${v.class || 'ordinary'} shares to the persons listed above, at ${money(v.price)} per share, on ${date(v.on)}, subject to receipt of the subscription money.`,
          'Their names are to be entered in the register of members and share certificates (or holding statements) issued.',
          'Any director or the company secretary is authorised to notify ASIC of the share issue within 28 days and to do anything else needed to give effect to these resolutions.',
        ]),
      };
    },
  },
  {
    key: 'issue_options', group: 'Shares', label: 'Grant options', description: 'Options over shares, e.g. under an employee plan.',
    fields: [
      { name: 'holder', label: 'Granted to', type: 'text' },
      { name: 'number', label: 'Number of options', type: 'number' },
      { name: 'exercise', label: 'Exercise price per option (A$)', type: 'number' },
      { name: 'expiry', label: 'Expiry date', type: 'date' },
      { name: 'plan', label: 'Plan or terms', type: 'text', placeholder: 'e.g. Employee Share Option Plan adopted 1 July 2025' },
      { name: 'vesting', label: 'Vesting (optional)', type: 'text', optional: true, placeholder: 'e.g. 25% after 12 months, then monthly over 36 months' },
    ],
    build: ({ values: v }) => ({
      title: `Grant of options to ${v.holder}`,
      body: doc([`The Company has adopted the ${v.plan}.`], [
        `The Company grants ${num(v.number)} options to ${v.holder}, each to acquire one share, with an exercise price of ${money(v.exercise)} and an expiry date of ${date(v.expiry)}, on the terms of the ${v.plan}${v.vesting ? `, vesting ${v.vesting}` : ''}.`,
        'The grant is to be entered in the Company’s register of options and an option certificate issued.',
      ]),
    }),
  },
  {
    key: 'approve_transfer', group: 'Shares', label: 'Approve a share transfer', description: 'Register a transfer between holders.',
    fields: [
      { name: 'from', label: 'From (transferor)', type: 'text' },
      { name: 'to', label: 'To (transferee)', type: 'text' },
      { name: 'number', label: 'Number of shares', type: 'number' },
      { name: 'class', label: 'Class', type: 'text', placeholder: 'Ordinary' },
      { name: 'price', label: 'Price per share (A$, optional)', type: 'number', optional: true },
    ],
    build: ({ values: v }) => ({
      title: `Transfer of ${num(v.number)} shares from ${v.from} to ${v.to}`,
      body: doc([`The Company has received a duly completed and stamped (if required) share transfer form for ${num(v.number)} ${v.class || 'ordinary'} shares from ${v.from} to ${v.to}${v.price ? ` at ${money(v.price)} per share` : ''}.`], [
        'The transfer is approved and is to be registered.',
        `${v.to} is to be entered in the register of members and a new share certificate (or holding statement) issued; ${v.from}’s certificate is cancelled.`,
        'Any director or the company secretary is authorised to notify ASIC of the change within 28 days.',
      ]),
    }),
  },
  {
    key: 'approve_financials', group: 'Annual', label: 'Approve the financial statements', description: 'The year’s financial statements and directors’ report.',
    fields: [
      { name: 'year_end', label: 'Financial year ended', type: 'date' },
      { name: 'signers', label: 'Directors who sign the declaration and report', type: 'text', placeholder: 'e.g. any two directors' },
    ],
    build: ({ values: v }) => ({
      title: `Financial statements for the year ended ${date(v.year_end)}`,
      body: doc([`The directors have considered the financial statements and notes, the directors’ report and (where required) the auditor’s report for the year ended ${date(v.year_end)}.`], [
        `In the directors’ opinion the financial statements and notes comply with the accounting standards and give a true and fair view, and there are reasonable grounds to believe the Company will be able to pay its debts as and when they become due and payable.`,
        `The financial statements, the directors’ declaration and the directors’ report for the year ended ${date(v.year_end)} are approved, and ${v.signers} are authorised to sign them for the directors.`,
        'Where the Company must lodge them, any director or the company secretary is authorised to lodge them with ASIC within the time required.',
      ]),
    }),
  },
  {
    key: 'solvency', group: 'Annual', label: 'Solvency resolution', description: 'Within two months of the annual review date (proprietary companies).', settles: 'solvency',
    fields: [{ name: 'review', label: 'Review date', type: 'date' }],
    build: ({ values: v }) => ({
      title: `Solvency resolution for the review date ${date(v.review)}`,
      body: doc([`The Company’s annual review date was ${date(v.review)}. Under section 347A of the Corporations Act, the directors pass a solvency resolution within two months of the review date, unless a negative solvency statement is lodged with ASIC.`], [
        'In the opinion of the directors, there are reasonable grounds to believe that the Company will be able to pay its debts as and when they become due and payable.',
      ]),
    }),
  },
  {
    key: 'appoint_auditor', group: 'Annual', label: 'Appoint an auditor', description: 'The first auditor, or one to fill a casual vacancy.',
    fields: [
      { name: 'firm', label: 'Auditor', type: 'text', placeholder: 'Firm and lead partner' },
      { name: 'reason', label: 'Why the directors appoint', type: 'select', options: ['First auditor of the Company', 'To fill a casual vacancy'] },
    ],
    build: ({ values: v }) => ({
      title: `Appointment of ${v.firm} as auditor`,
      body: doc([
        `${v.firm} has consented in writing to act as auditor of the Company.`,
        v.reason === 'To fill a casual vacancy' ? 'The office of auditor is vacant; the directors may fill a casual vacancy until the next annual general meeting.' : 'The directors may appoint the first auditor of the Company.',
      ], [`${v.firm} is appointed as auditor of the Company.`, NOTIFY]),
    }),
  },
  {
    key: 'bank_account', group: 'Banking and contracts', label: 'Open a bank account', description: 'A new account and who operates it.',
    fields: [
      { name: 'bank', label: 'Bank', type: 'text' },
      { name: 'account', label: 'Account', type: 'text', placeholder: 'e.g. Business transaction account' },
      { name: 'signatories', label: 'Authorised signatories', type: 'textarea', hint: 'One per line.' },
      { name: 'method', label: 'Operated by', type: 'select', options: ['Any one signatory', 'Any two signatories jointly'] },
    ],
    build: ({ values: v }) => ({
      title: `Opening of a ${v.bank} account`,
      body: doc([`The Company wishes to open a ${v.account} with ${v.bank}.`], [
        `The Company opens a ${v.account} with ${v.bank}, on the bank’s standard terms.`,
        `The authorised signatories for the account are: ${lines(v.signatories).join('; ')}; the account is operated by ${v.method.toLowerCase()}.`,
        'Any director is authorised to sign the bank’s forms and give it a copy of these resolutions.',
      ]),
    }),
  },
  {
    key: 'signatories', group: 'Banking and contracts', label: 'Change bank signatories', description: 'Add or remove who operates an account.',
    fields: [
      { name: 'bank', label: 'Bank and account', type: 'text' },
      { name: 'add', label: 'Add (optional)', type: 'textarea', optional: true, hint: 'One per line.' },
      { name: 'remove', label: 'Remove (optional)', type: 'textarea', optional: true, hint: 'One per line.' },
      { name: 'method', label: 'Operated by', type: 'select', options: ['Any one signatory', 'Any two signatories jointly'] },
    ],
    build: ({ values: v }) => ({
      title: `Change of signatories: ${v.bank}`,
      body: doc([`The directors wish to change the authorised signatories for the Company’s ${v.bank}.`], [
        ...(lines(v.add).length ? [`${lines(v.add).join('; ')} ${lines(v.add).length === 1 ? 'is' : 'are'} added as authorised signatories.`] : []),
        ...(lines(v.remove).length ? [`${lines(v.remove).join('; ')} ${lines(v.remove).length === 1 ? 'is' : 'are'} removed as authorised signatories.`] : []),
        `The account is operated by ${v.method.toLowerCase()}.`,
        'Any director is authorised to sign the bank’s forms and give it a copy of these resolutions.',
      ]),
    }),
  },
  {
    key: 'approve_contract', group: 'Banking and contracts', label: 'Approve and sign a contract', description: 'Enter into an agreement and say who signs it.',
    fields: [
      { name: 'contract', label: 'Contract', type: 'text', placeholder: 'e.g. Services agreement' },
      { name: 'counterparty', label: 'With', type: 'text' },
      { name: 'summary', label: 'What it is about', type: 'textarea', placeholder: 'Term, value, the main obligations' },
      { name: 'execution', label: 'Signed by', type: 'select', options: ['Two directors, or a director and the company secretary (section 127)', 'The sole director (section 127)', 'An authorised officer under a power of attorney'] },
    ],
    build: ({ values: v }) => ({
      title: `Approval of the ${v.contract} with ${v.counterparty}`,
      body: doc([`The directors have reviewed the ${v.contract} between the Company and ${v.counterparty}. ${v.summary}`, 'The directors consider that entering into it is in the best interests of the Company.'], [
        `The Company enters into the ${v.contract} with ${v.counterparty}, in the form tabled, with any changes that the person signing it approves as not material.`,
        `The ${v.contract} is to be signed by ${v.execution.charAt(0).toLowerCase()}${v.execution.slice(1)}.`,
      ]),
    }),
  },
  {
    key: 'blank', group: 'Banking and contracts', label: 'Other resolution', description: 'Write your own background and resolutions.',
    fields: [
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'background', label: 'Background', type: 'textarea' },
      { name: 'resolutions', label: 'Resolutions', type: 'textarea', hint: 'One per line; they are numbered.' },
    ],
    build: ({ values: v }) => ({ title: v.title, body: doc([v.background], lines(v.resolutions).map((l) => l.replace(/^\d+[.)]\s*/, ''))) }),
  },
];

export const templateOf = (key: string | null | undefined) => TEMPLATES.find((t) => t.key === key) ?? null;

/** The statement under the company's name: how the resolution is made. */
export const madeUnder = (directors: number) => (directors === 1
  ? 'Resolution of the sole director, made under section 248B of the Corporations Act 2001 (Cth)'
  : 'Circular resolution of the directors, passed under section 248A of the Corporations Act 2001 (Cth) when signed by all the directors entitled to vote');
