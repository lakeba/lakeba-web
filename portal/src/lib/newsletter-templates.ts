import type { IssueContent } from './newsletter';

// Built-in starting points for newsletters. {{company}}, {{quarter}},
// {{month_year}}, {{year}} and {{portal}} (the portal's address) are filled in when an issue starts from one;
// other {{placeholders}} (HTML mode) are filled per reader when it is sent.
// Text in [square brackets] is a prompt for the writer to replace.

export type Template = {
  id: string; name: string; description: string; audience: 'shareholders' | 'public' | 'any';
  subject: string; preheader: string; mode: 'compose' | 'html' | 'design'; content: IssueContent; html_body: string; mjml?: string;
  builtIn?: boolean; entity_id?: string | null;
};


// Designer (MJML) building blocks shared by the built-in designs. #276ae7 is
// the brand colour: an issue started from a template gets its company's colour.
const HEAD = `<mj-head><mj-attributes><mj-all font-family="Inter, Arial, sans-serif"></mj-all><mj-text font-size="15px" line-height="1.6" color="#0b1d37" padding="6px 0"></mj-text><mj-button background-color="#276ae7" color="#ffffff" font-weight="600" border-radius="10px" inner-padding="12px 22px"></mj-button></mj-attributes><mj-style>a { color: #276ae7; }</mj-style></mj-head>`;
const top = (kind: string) => `<mj-section background-color="#276ae7" padding="0"><mj-column><mj-spacer height="6px"></mj-spacer></mj-column></mj-section>
    <mj-section background-color="#ffffff" padding="22px 28px 4px"><mj-column><mj-text font-size="18px" font-weight="700">{{company}} <span style="font-weight:400;color:#6b7a90;font-size:14px">· ${kind}</span></mj-text></mj-column></mj-section>`;
const hero = (eyebrow: string, title: string, lead: string) => `<mj-section background-color="#ffffff" padding="10px 28px"><mj-column background-color="#0b1d37" border-radius="14px" padding="22px 24px">
      <mj-text color="#9fb6dd" font-size="12px" letter-spacing="2px" text-transform="uppercase">${eyebrow}</mj-text>
      <mj-text color="#ffffff" font-size="26px" font-weight="700" line-height="1.25">${title}</mj-text>
      <mj-text color="#d5def0">${lead}</mj-text>
    </mj-column></mj-section>`;
const block = (placeholder: string) => `<mj-section background-color="#ffffff" padding="0 28px"><mj-column><mj-text>${placeholder}</mj-text></mj-column></mj-section>`;
const text = (html: string) => `<mj-section background-color="#ffffff" padding="0 28px"><mj-column><mj-text>${html}</mj-text></mj-column></mj-section>`;
const twoCols = (a: [string, string], b: [string, string]) => `<mj-section background-color="#ffffff" padding="8px 28px">
      <mj-column padding="0 8px 0 0"><mj-text font-size="16px" font-weight="700">${a[0]}</mj-text><mj-text font-size="14px" color="#3d4b60">${a[1]}</mj-text></mj-column>
      <mj-column padding="0 0 0 8px"><mj-text font-size="16px" font-weight="700">${b[0]}</mj-text><mj-text font-size="14px" color="#3d4b60">${b[1]}</mj-text></mj-column>
    </mj-section>`;
const button = (label: string, href: string) => `<mj-section background-color="#ffffff" padding="4px 28px"><mj-column><mj-button href="${href}" align="left">${label}</mj-button></mj-column></mj-section>`;
const close = (html: string) => `<mj-section background-color="#ffffff" padding="10px 28px 26px" border-radius="0 0 16px 16px"><mj-column><mj-text>${html}</mj-text></mj-column></mj-section>`;
/** The part Build with AI fills (an mj-wrapper with css-class "nl-content"). */
const content = (inner: string) => `<mj-wrapper css-class="nl-content" padding="0">${inner}</mj-wrapper>`;
const doc = (body: string) => `<mjml>${HEAD}<mj-body background-color="#eef2f8" width="620px"><mj-wrapper padding="24px 0 0">${body}</mj-wrapper></mj-body></mjml>`;

const DESIGNED: Template[] = [
  {
    id: 'quarterly-designed', builtIn: true, audience: 'shareholders', mode: 'design',
    name: 'Quarterly shareholder update',
    description: 'A designed layout: headline banner, highlights in two columns, then the news, documents, meetings and each reader’s holding.',
    subject: '{{company}} quarterly update – {{quarter}}', preheader: 'Highlights of the quarter, new documents and what’s coming up.',
    content: { meetings: true, holding: true }, html_body: '',
    mjml: doc(`${top('Shareholder newsletter')}
    ${hero('{{quarter}}', '[Headline of the quarter]', '[One or two sentences that sum up the quarter.]')}
    ${content(`${text('{{greeting}}')}
    ${text('<p>[Opening paragraph: the most important progress this quarter and what it means for shareholders.]</p>')}
    ${twoCols(['[First highlight]', '[A few lines about it.]'], ['[Second highlight]', '[A few lines about it.]'])}`)}
    ${block('{{holding}}')}${block('{{news}}')}${block('{{documents}}')}${block('{{meetings}}')}
    ${close('<p>Thank you for your continued support.</p><p>[Name]<br>[Chair / Chief Executive], {{company}}</p>{{portal_button}}')}`),
  },
  {
    id: 'meeting-designed', builtIn: true, audience: 'shareholders', mode: 'design',
    name: 'Meeting / AGM season',
    description: 'A designed invitation: the meeting up front, how to vote online, and a Vote online button.',
    subject: '{{company}}: your invitation to the meeting – {{month_year}}', preheader: 'The notice of meeting is available, and you can vote online.',
    content: { meetings: true, holding: false }, html_body: '',
    mjml: doc(`${top('Shareholder newsletter')}
    ${hero('Notice of meeting', 'You’re invited to the [annual general meeting]', '[Date, time and place, or online.]')}
    ${content(`${text('{{greeting}}')}
    ${text('<p>[The board invites you to the meeting. The notice of meeting explains the resolutions.]</p>')}
    ${text('<h3 style="margin:10px 0 6px">How to vote</h3><ul><li>Sign in to the investor portal and open <strong>Meetings</strong>.</li><li>Read the notice of meeting and the explanatory notes.</li><li>Lodge your proxy vote online before the deadline below.</li></ul>')}`)}
    ${block('{{meetings}}')}${button('Vote online', '{{portal}}/agm')}${block('{{documents}}')}
    ${close('<p>We look forward to seeing you.</p><p>[Name], Company Secretary</p>{{portal_button}}')}`),
  },
  {
    id: 'public-designed', builtIn: true, audience: 'public', mode: 'design',
    name: 'Public newsletter',
    description: 'For prospective investors and website subscribers: a headline banner, a venture spotlight and the latest public news.',
    subject: 'Lakeba newsletter – {{quarter}}', preheader: 'News from Lakeba Group and our ventures.',
    content: {}, html_body: '',
    mjml: doc(`${top('Newsletter')}
    ${hero('{{quarter}}', '[Headline]', '[A short welcome and the big picture of the quarter at Lakeba.]')}
    ${content(`${text('{{greeting}}')}
    ${text('<h3 style="margin:10px 0 6px">Venture spotlight</h3><p>[A few lines on one venture: what it does, who it helps and a recent milestone.]</p>')}`)}
    ${block('{{news}}')}${button('Visit lakeba.com', 'https://lakeba.com')}
    ${close('<p>Thank you for following Lakeba.</p>')}`),
  },
];

const p = (...lines: string[]) => lines.map((l) => `<p>${l}</p>`).join('');

export const BUILT_IN: Template[] = [
  ...DESIGNED,
  {
    id: 'quarterly', builtIn: true, audience: 'shareholders', mode: 'compose',
    name: 'Quarterly update (simple)',
    description: 'Highlights of the quarter, a word on the numbers, then the news, documents and meetings since the last issue.',
    subject: '{{company}} quarterly update – {{quarter}}',
    preheader: 'Highlights of the quarter, new documents and what’s coming up.',
    content: {
      intro_html: p('[Two or three sentences on the quarter: the most important progress, and what it means for shareholders.]'),
      sections: [
        { title: 'Highlights of the quarter', html: '<ul><li>[Milestone or customer win]</li><li>[Product or partnership news]</li><li>[Team or governance update]</li></ul>' },
        { title: 'Financial snapshot', html: p('[Revenue, cash position or capital raised this quarter, as already reported to shareholders. Keep to facts that have been published.]') },
      ],
      closing_html: p('Thank you for your continued support.', '[Name]<br>[Chair / Chief Executive], {{company}}'),
      meetings: true, holding: true,
    },
    html_body: '',
  },
  {
    id: 'meeting', builtIn: true, audience: 'shareholders', mode: 'compose',
    name: 'Meeting / AGM season (simple)',
    description: 'Invites shareholders to the meeting and explains how to vote online before the proxy deadline.',
    subject: '{{company}}: your invitation to the meeting – {{month_year}}',
    preheader: 'The notice of meeting is available, and you can vote online.',
    content: {
      intro_html: p('[The board invites you to the meeting on [date] at [place / online]. The notice of meeting explains the resolutions.]'),
      sections: [
        { title: 'How to vote', html: '<ul><li>Sign in to the investor portal and open <strong>Meetings</strong>.</li><li>Read the notice of meeting and the explanatory notes.</li><li>Lodge your proxy vote online before the deadline shown below.</li></ul>' },
        { title: 'Questions for the board', html: p('You can send a question for the meeting from the meeting page in the portal. [The board will answer the most common questions at the meeting.]') },
      ],
      closing_html: p('We look forward to seeing you.', '[Name], Company Secretary'),
      meetings: true, holding: false, cta_label: 'Vote online', cta_url: '{{portal}}/agm',
    },
    html_body: '',
  },
  {
    id: 'public', builtIn: true, audience: 'public', mode: 'compose',
    name: 'Public newsletter (simple)',
    description: 'For prospective investors and website subscribers: what Lakeba and its ventures have been doing, with the latest public news.',
    subject: 'Lakeba newsletter – {{quarter}}',
    preheader: 'News from Lakeba Group and our ventures.',
    content: {
      intro_html: p('[A short welcome and the big picture of the quarter at Lakeba.]'),
      sections: [
        { title: 'Venture spotlight', html: p('[A few lines on one venture: what it does, who it helps and a recent milestone.]') },
      ],
      closing_html: p('Thank you for following Lakeba.'),
      cta_label: 'Visit lakeba.com', cta_url: 'https://lakeba.com',
    },
    html_body: '',
  },
];

/** Ready-made pieces for the HTML editor's Insert menu. */
export const SNIPPETS: { label: string; html: string }[] = [
  { label: 'Heading', html: '<h2 style="margin:24px 0 10px;font-size:20px;color:#0b1d37">Heading</h2>' },
  { label: 'Paragraph', html: '<p style="margin:0 0 14px;line-height:1.65">Text</p>' },
  { label: 'Button', html: '<p style="margin:22px 0"><a href="https://" style="background:#276ae7;color:#ffffff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block">Button text</a></p>' },
  { label: 'Two columns', html: '<table role="presentation" width="100%" style="border-collapse:collapse;margin:8px 0 18px"><tr><td width="50%" style="vertical-align:top;padding:0 10px 0 0"><h3 style="margin:0 0 6px;font-size:16px">Left</h3><p style="margin:0;font-size:14px">Text</p></td><td width="50%" style="vertical-align:top;padding:0 0 0 10px"><h3 style="margin:0 0 6px;font-size:16px">Right</h3><p style="margin:0;font-size:14px">Text</p></td></tr></table>' },
  { label: 'Highlight box', html: '<div style="margin:20px 0;padding:16px 18px;border-radius:12px;background:#f2f6fd;border:1px solid #dfe7f5"><p style="margin:0">Text</p></div>' },
  { label: 'Divider', html: '<hr style="border:0;border-top:1px solid #e3e9f3;margin:24px 0">' },
];
