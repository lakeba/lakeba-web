import { EVENTS, eventScope } from '../integrations/events';
import { API_SCOPES } from './scopes';

// The company API, described once: the /developers guide, the reference at /developers/reference and the
// OpenAPI document (/api/v1/openapi.json) are all made from this list. Examples are made up (Example Ventures,
// EXV); the schemas are worked out from them, with the field descriptions below.

type Field = { name: string; type: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object'; required?: boolean; description: string; example?: unknown };
export type Op = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; scope: string; summary: string; description?: string; query?: Field[]; body?: Field[]; bodyType?: string; tag: string;
  /** What a successful answer looks like (made up), and its status when it isn't 200. */
  example?: unknown; status?: number;
};

const page: Field[] = [{ name: 'limit', type: 'integer', description: '1–200, default 50.', example: 50 }, { name: 'cursor', type: 'string', description: 'next_cursor from the previous page.' }];
const since: Field = { name: 'updated_since', type: 'string', description: 'Only records changed since this date-time (ISO 8601).', example: '2026-11-01T00:00:00Z' };

// Made-up records, used across the examples.
const ID = {
  company: '1f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0', holder: '0b6f3c1e-4a8d-4f2b-9c55-2e7d1a9b3f10', ord: '5a1d9e7c-2b3f-4c6a-8d0e-7f4b2a9c1e33', opts: '6b2e0f8d-3c4a-4d7b-9e1f-8a5c3b0d2f44',
  person: '51aa7c20-9d4e-4b8f-a1c3-6e2f0b8d4a77', doc: 'c3e81f4a-6b2d-4a9e-8f17-0d5c9b3a2e61', meeting: '9b2e4d6f-1a3c-4e5b-9d7f-8c0a2b4e6d18', resolution: '3d5f7b9e-2c4a-4f6e-8d0b-1a3c5e7f9b20',
  room: 'e4a7c9b1-3d5f-4a2e-8b6c-1f0d9e7a5c42', guest: 'f1c3e5a7-9b2d-4f6e-8a0c-3d5b7e9f1a24', query: '7d9f1b3e-5a7c-4e2f-9b1d-6c8e0a2f4b53', subscriber: '2c4e6a8b-0d1f-4a3c-9e5b-7f9d1c3e5a86',
  webhook: '6e8a0c2e-4f6b-4d8a-9c0e-2b4d6f8a0c97', post: 'a8c0e2f4-6b8d-4a0c-8e2f-4b6d8f0a2c19', import: 'b9d1f3a5-7c9e-4b1d-8f3a-5c7e9b1d3f28', event: 'd2f4a6c8-0e2a-4c4e-9a6c-8e0a2c4e6a35',
  announcement: '8f0b2d4f-6a8c-4e0a-9c2e-4a6c8e0a2c51', officer: '1c3e5a7c-9e1a-4c3e-8a5c-7e9a1c3e5a62', deadline: '2e4a6c8e-0a2c-4e6a-8c0e-2a4c6e8a0c73',
  contract: '3f5b7d9f-1b3d-4f7b-9d1f-3b5d7f9b1d84', pack: '4a6c8e0a-2c4e-4a8c-8e2a-4c6e8a0c2e95', board_meeting: '5b7d9f1b-3d5f-4b9d-9f3b-5d7f9b1d3fa6',
  deck: '6c8e0a2c-4e6a-4cae-8a4c-6e8a0c2e4ab7', employee: '7d9f1b3d-5f7b-4dbf-9b5d-7f9b1d3f5bc8', grant: '8e0a2c4e-6a8c-4ec0-8c6e-8a0c2e4a6cd9', plan: '9f1b3d5f-7b9d-4fd1-9d7f-9b1d3f5b7de0',
};
const holding = { company: 'EXV', share_class: 'ORD', share_class_id: ID.ord, shares: 250000, as_at: '2026-10-31', ownership_pct: 2.5 };
const holder = { id: ID.holder, name: 'Harbour Street Investments Pty Ltd <Harbour Street Fund A/C>', kind: 'company', registry_ref: 'H00042', is_group_stake: false, represents_company: null, external_ids: { hubspot: '18205531', xero: '4d2b7c1e-90aa-4f3e-b1f2-6c0d8e2a7b55' }, holdings: [holding] };
const person = { id: ID.person, email: 'alex.morgan@example.com', first_name: 'Alex', last_name: 'Morgan', phone: '+61 400 000 000', status: 'active', last_sign_in_at: '2026-11-02T22:41:07Z', created_at: '2026-08-14T03:12:45Z', updated_at: '2026-10-30T05:01:19Z', holders: [{ holder_id: ID.holder, name: holder.name, access: 'owner' }], external_ids: { hubspot: '90311' } };
const doc = { company: 'EXV', id: ID.doc, title: 'Annual Report 2026', summary: 'Results for the year to 30 June 2026.', category: 'report', audience: 'all_investors', mime_type: 'application/pdf', size_bytes: 2483011, published_at: '2026-10-28T23:00:00Z', created_at: '2026-10-27T04:12:00Z' };
const meeting = { company: 'EXV', id: ID.meeting, title: '2026 Annual General Meeting', kind: 'agm', starts_at: '2026-11-27T00:00:00Z', location: 'Level 5, 1 Example Street, Sydney NSW', livestream_url: 'https://example.com/live/agm-2026', proxy_deadline: '2026-11-25T00:00:00Z', status: 'open', notice_document_id: ID.doc, minutes_document_id: null, created_at: '2026-10-20T01:30:00Z' };
const room = { id: ID.room, company: 'EXV', name: 'Series B due diligence', description: 'Financials and contracts for prospective investors.', closed_at: null, created_at: '2026-10-15T02:00:00Z' };
const figures = {
  pl: { revenue: { period: 412000, ytd: 1236000 }, other_income: { period: 0, ytd: 4000 }, cost_of_sales: { period: 151000, ytd: 448000 }, employee_costs: { period: 168000, ytd: 497000 }, other_expenses: { period: 61000, ytd: 180000 }, depreciation: { period: 6000, ytd: 18000 }, interest: { period: 2000, ytd: 6000 }, income_tax: { period: 0, ytd: 0 }, net_profit: { period: 24000, ytd: 91000 } },
  bs: { cash: 2380000, receivables: 310000, other_current_assets: 45000, non_current_assets: 220000, payables: 140000, borrowings: 0, other_liabilities: 96000, equity: 2719000 },
};
const list = (item: unknown, total = 86) => ({ data: [item], total, next_cursor: total > 1 ? 'NTA' : null });

export const OPS: Op[] = [
  { tag: 'Company', method: 'GET', path: '/company', scope: 'investors.view', summary: 'The company and its share classes, with shares on issue.',
    example: { data: [{ id: ID.company, code: 'EXV', name: 'Example Ventures', legal_name: 'Example Ventures Pty Ltd', company_number: '123 456 789', country: 'AU', relationship: 'portfolio', website: 'https://example.com', holdings_from_register: true, share_classes: [{ id: ID.ord, code: 'ORD', name: 'Ordinary shares', kind: 'ordinary', voting: true, counts_toward_ownership: true, on_issue: 10000000, official_on_issue: 10000000, official_as_at: '2026-10-31' }] }] } },
  { tag: 'Company', method: 'GET', path: '/share-classes', scope: 'investors.view', summary: 'Share classes and shares on issue (the official figure where there is one).',
    example: { data: [{ id: ID.ord, company: 'EXV', code: 'ORD', name: 'Ordinary shares', kind: 'ordinary', voting: true, currency: 'AUD', counts_toward_ownership: true, on_issue: 10000000, official_on_issue: 10000000, official_as_at: '2026-10-31' }, { id: ID.opts, company: 'EXV', code: 'OPTS', name: 'Options', kind: 'option', voting: false, currency: 'AUD', counts_toward_ownership: false, on_issue: 400000, official_on_issue: null, official_as_at: null }] } },
  { tag: 'Register', method: 'GET', path: '/holders', scope: 'investors.view', summary: 'Holders (holding entities) with their latest holdings and % ownership.', query: [...page, { name: 'include_zero', type: 'boolean', description: 'Also holders whose shares are now nil.' }], example: list(holder) },
  { tag: 'Register', method: 'GET', path: '/holders/{id}', scope: 'investors.view', summary: 'One holder.', example: { data: holder } },
  { tag: 'Register', method: 'POST', path: '/holders/{id}/holdings', scope: 'investors.do', summary: 'A dated balance for a holder (not for companies whose holdings come from their register).', status: 201,
    body: [{ name: 'share_class', type: 'string', required: true, description: 'Class code.', example: 'ORD' }, { name: 'shares', type: 'integer', required: true, description: 'Balance (0 or more).', example: 260000 }, { name: 'as_at', type: 'string', required: true, description: 'YYYY-MM-DD.', example: '2026-11-03' }, { name: 'reason', type: 'string', required: true, description: 'Why (kept in the audit log).', example: 'Placement of 10,000 shares' }],
    example: { data: { holder_id: ID.holder, share_class: 'ORD', shares: 260000, as_at: '2026-11-03' } } },
  { tag: 'Register', method: 'PUT', path: '/holders/{id}/external-ids/{system}', scope: 'investors.do', summary: 'Your system’s ID for this holder (returned as external_ids). DELETE removes it.',
    body: [{ name: 'external_id', type: 'string', required: true, description: 'Your ID.', example: 'CUST-00042' }], example: { data: { system: 'crm', external_id: 'CUST-00042' } } },
  { tag: 'Register', method: 'GET', path: '/holdings', scope: 'investors.view', summary: 'The latest holding per holder and class.', query: [...page, { name: 'holder_id', type: 'string', description: 'One holder.' }, { name: 'share_class', type: 'string', description: 'One class.', example: 'ORD' }],
    example: list({ holder_id: ID.holder, ...holding }, 89) },
  { tag: 'Register', method: 'GET', path: '/holdings/history', scope: 'investors.view', summary: 'Every dated balance, newest first.', query: [...page, { name: 'holder_id', type: 'string', description: 'One holder.' }, { name: 'share_class', type: 'string', description: 'One class.', example: 'ORD' }, { name: 'from', type: 'string', description: 'YYYY-MM-DD.' }, { name: 'to', type: 'string', description: 'YYYY-MM-DD.' }],
    example: list({ holder_id: ID.holder, company: 'EXV', share_class: 'ORD', shares: 250000, as_at: '2026-10-31' }, 412) },
  { tag: 'Register', method: 'GET', path: '/register/movements', scope: 'investors.view', summary: 'Movements on the register of members (allotments, transfers…).', query: [...page, { name: 'holder_id', type: 'string', description: 'One holder.' }],
    example: list({ holder_id: ID.holder, company: 'EXV', share_class_id: ID.ord, share_class: 'ORD', seq: 3, moved_on: '2026-07-01', kind: 'allotment', shares: 50000, balance: 250000, party_holder_id: null, consideration: 25000, certificate: '17', paid_per_share: 0.5, unpaid_per_share: 0 }, 166) },
  { tag: 'Register', method: 'GET', path: '/register/imports', scope: 'investors.view', summary: 'Registers of members imported.',
    example: { data: [{ company: 'EXV', id: ID.import, as_at: '2026-10-31', company_name: 'EXAMPLE VENTURES PTY LTD', company_number: '123 456 789', file_name: 'register-of-members-2026-10-31.pdf', holders: 86, holdings: 89, movements: 166, totals: { ORD: 10000000, OPTS: 400000 }, created_at: '2026-11-01T03:20:00Z' }], total: 1, next_cursor: null } },
  { tag: 'Register', method: 'POST', path: '/register/imports', scope: 'investors.do', bodyType: 'application/pdf', status: 202, summary: 'Send a new register of members (the PDF as the body). Never applied straight away: an Admin checks, previews and confirms it in the portal. Optional header X-File-Name.',
    example: { data: { id: ID.import, status: 'needs_review' } } },
  { tag: 'People', method: 'GET', path: '/people', scope: 'people.read', summary: 'Investors: name, email, phone, portal status (not_invited, invited, active) and holders.', query: [...page, { name: 'status', type: 'string', description: 'not_invited, invited or active.', example: 'active' }], example: list(person, 61) },
  { tag: 'People', method: 'GET', path: '/people/{id}', scope: 'people.read', summary: 'One investor.', example: { data: person } },
  { tag: 'People', method: 'POST', path: '/people', scope: 'investors.do', status: 201, summary: 'Add an investor to a holder, with or without the invitation email. 200 instead of 201 when they already had an account.',
    body: [{ name: 'email', type: 'string', required: true, description: 'Their email.', example: 'alex.morgan@example.com' }, { name: 'first_name', type: 'string', description: 'First name.', example: 'Alex' }, { name: 'last_name', type: 'string', description: 'Last name.', example: 'Morgan' }, { name: 'holder_id', type: 'string', description: 'The holder (or holder_ref).', example: ID.holder }, { name: 'holder_ref', type: 'string', description: 'The holder’s register reference.' }, { name: 'access', type: 'string', description: 'owner (can vote, default) or viewer.', example: 'owner' }, { name: 'invite', type: 'boolean', description: 'Send the invitation now (default false).', example: false }],
    example: { data: { id: ID.person, email: 'alex.morgan@example.com', existing: false, invited: false } } },
  { tag: 'People', method: 'PATCH', path: '/people/{id}', scope: 'investors.do', summary: 'Change an investor’s name or phone (only if they are an investor of this company alone).',
    body: [{ name: 'first_name', type: 'string', description: 'First name.' }, { name: 'last_name', type: 'string', description: 'Last name.' }, { name: 'phone', type: 'string', description: 'Phone; empty removes it.', example: '+61 400 000 001' }],
    example: { data: { id: ID.person, first_name: 'Alex', last_name: 'Morgan', phone: '+61 400 000 001' } } },
  { tag: 'People', method: 'PUT', path: '/people/{id}/external-ids/{system}', scope: 'investors.do', summary: 'Your system’s ID for this investor. DELETE removes it.',
    body: [{ name: 'external_id', type: 'string', required: true, description: 'Your ID.', example: 'CONTACT-9031' }], example: { data: { system: 'crm', external_id: 'CONTACT-9031' } } },
  { tag: 'Documents', method: 'GET', path: '/documents', scope: 'documents.view', summary: 'Documents (not those for one holder).', query: [...page, since, { name: 'published', type: 'boolean', description: 'Only published, or only drafts.' }, { name: 'category', type: 'string', description: 'report, agm, update, governance or other.' }],
    example: list({ ...doc, shared_with_group: false }, 20) },
  { tag: 'Documents', method: 'GET', path: '/documents/{id}', scope: 'documents.view', summary: 'One document, with a download link valid for 5 minutes.',
    example: { data: { ...doc, download_url: 'https://investors.lakeba.com/storage/v1/object/sign/documents/…?token=…', download_expires_in: 300 } } },
  { tag: 'Documents', method: 'POST', path: '/documents', scope: 'documents.do', status: 201, summary: 'Upload a document. It arrives as a draft: it’s published (or approved) in the portal.',
    body: [{ name: 'title', type: 'string', required: true, description: 'Title.', example: 'Quarterly update Q1 FY27' }, { name: 'category', type: 'string', description: 'report, agm, update, governance or other.', example: 'update' }, { name: 'audience', type: 'string', description: 'all_investors (default) or board.', example: 'all_investors' }, { name: 'summary', type: 'string', description: 'One or two sentences.' }, { name: 'file_name', type: 'string', description: 'File name.', example: 'q1-fy27-update.pdf' }, { name: 'content_type', type: 'string', description: 'Default application/pdf.', example: 'application/pdf' }, { name: 'file_base64', type: 'string', required: true, description: 'The file, base64 (up to 25 MB).', example: 'JVBERi0xLjcK…' }, { name: 'knowledge_base', type: 'boolean', description: 'Use it in Ask Lakeba once published.', example: false }],
    example: { data: { id: ID.doc, title: 'Quarterly update Q1 FY27', published: false } } },
  { tag: 'News', method: 'GET', path: '/posts', scope: 'news.view', summary: 'News posts (for investors and public), published or not.', query: [...page, since, { name: 'published', type: 'boolean', description: 'Only published, or only drafts.' }, { name: 'full', type: 'boolean', description: 'Include the HTML.' }],
    example: list({ company: 'EXV', id: ID.post, slug: 'example-ventures-signs-distribution-deal', title: 'Example Ventures signs distribution deal', excerpt: 'A three-year agreement covering Australia and New Zealand.', visibility: 'public', categories: ['Company news'], cover_url: 'https://investors.lakeba.com/news-media/example-cover.jpg', published_at: '2026-10-30T22:00:00Z', created_at: '2026-10-29T05:10:00Z', updated_at: '2026-10-30T21:58:00Z', on_lakeba_site: false, on_venture_site: true }, 152) },
  { tag: 'News', method: 'POST', path: '/posts', scope: 'news.do', status: 201, summary: 'A news post as a draft (the HTML is cleaned like the editor’s).',
    body: [{ name: 'title', type: 'string', required: true, description: 'Title.', example: 'Example Ventures opens Melbourne office' }, { name: 'excerpt', type: 'string', description: 'Short summary.' }, { name: 'body_html', type: 'string', description: 'The post, in HTML.', example: '<p>Example Ventures has opened…</p>' }, { name: 'visibility', type: 'string', description: 'shareholders (default) or public.', example: 'shareholders' }],
    example: { data: { id: ID.post, slug: 'example-ventures-opens-melbourne-office', title: 'Example Ventures opens Melbourne office', visibility: 'shareholders', published: false } } },
  { tag: 'News', method: 'GET', path: '/announcements', scope: 'news.view', summary: 'Dashboard announcements.', query: [...page, { name: 'current', type: 'boolean', description: 'Only those showing now.' }],
    example: list({ company: 'EXV', id: ID.announcement, title: 'Proxy voting is open', body: 'Lodge your votes for the 2026 AGM by 25 November.', link_url: '/meetings', link_label: 'Vote now', tone: 'info', starts_at: '2026-11-01T00:00:00Z', ends_at: '2026-11-25T00:00:00Z', created_at: '2026-10-31T23:00:00Z' }, 3) },
  { tag: 'Meetings', method: 'GET', path: '/meetings', scope: 'meetings.view', summary: 'Meetings (AGMs, EGMs).', query: [...page, { name: 'status', type: 'string', description: 'upcoming, open, closed or results.', example: 'open' }], example: list(meeting, 4) },
  { tag: 'Meetings', method: 'GET', path: '/meetings/{id}', scope: 'meetings.view', summary: 'A meeting, its resolutions, outcomes and proxy vote totals.',
    example: { data: { ...meeting, questions: 2, resolutions: [{ id: ID.resolution, number: 1, title: 'Re-election of a director', description: 'That Jordan Lee be re-elected as a director.', kind: 'ordinary', outcome: null, proxy_votes: { for: { holders: 31, shares: 6120000 }, against: { holders: 2, shares: 80000 }, abstain: { holders: 1, shares: 10000 } } }] } } },
  { tag: 'Meetings', method: 'POST', path: '/meetings', scope: 'meetings.do', status: 201, summary: 'Create a meeting (upcoming; opening proxy voting is done in the portal).',
    body: [{ name: 'title', type: 'string', required: true, description: 'Title.', example: '2026 Annual General Meeting' }, { name: 'kind', type: 'string', description: 'agm (default) or egm.', example: 'agm' }, { name: 'starts_at', type: 'string', required: true, description: 'ISO date-time.', example: '2026-11-27T00:00:00Z' }, { name: 'proxy_deadline', type: 'string', required: true, description: 'ISO date-time, before it starts.', example: '2026-11-25T00:00:00Z' }, { name: 'location', type: 'string', description: 'Where it’s held.' }, { name: 'livestream_url', type: 'string', description: 'Link to watch online.' }],
    example: { data: { id: ID.meeting, title: '2026 Annual General Meeting', status: 'upcoming' } } },
  { tag: 'Meetings', method: 'POST', path: '/meetings/{id}/resolutions', scope: 'meetings.do', status: 201, summary: 'Add a resolution (before proxy voting opens).',
    body: [{ name: 'number', type: 'integer', required: true, description: 'Its number on the notice.', example: 1 }, { name: 'title', type: 'string', required: true, description: 'Title.', example: 'Re-election of a director' }, { name: 'description', type: 'string', description: 'The resolution’s text.' }, { name: 'kind', type: 'string', description: 'ordinary (default) or special.', example: 'ordinary' }],
    example: { data: { id: ID.resolution, number: 1 } } },
  { tag: 'Board Q&A', method: 'GET', path: '/queries', scope: 'inbox.view', summary: 'Board Q&A questions and their messages (who asked needs people.read).', query: [...page, { name: 'status', type: 'string', description: 'open, answered or closed.' }],
    example: list({ id: ID.query, company: 'EXV', subject: 'Timing of the next capital raise', status: 'answered', created_at: '2026-10-21T09:15:00Z', updated_at: '2026-10-22T01:40:00Z', asked_by: { id: ID.person, email: 'alex.morgan@example.com', first_name: 'Alex', last_name: 'Morgan' }, messages: [{ from: 'investor', body: 'Is a capital raise planned before June?', created_at: '2026-10-21T09:15:00Z' }, { from: 'board', body: 'Nothing is planned before the AGM; we’ll update investors after it.', created_at: '2026-10-22T01:40:00Z' }] }, 12) },
  { tag: 'Board Q&A', method: 'POST', path: '/queries/{id}/replies', scope: 'inbox.do', status: 201, summary: 'Reply to a question; the investor is told.',
    body: [{ name: 'body', type: 'string', required: true, description: 'The reply.', example: 'Thank you for your question. The board will cover this at the AGM.' }], example: { data: { query_id: ID.query, replied: true } } },
  { tag: 'Data rooms', method: 'GET', path: '/data-rooms', scope: 'documents.view', summary: 'Data rooms.', example: { data: [{ ...room, document_ids: [ID.doc], active_guests: 3 }] } },
  { tag: 'Data rooms', method: 'GET', path: '/data-rooms/{id}', scope: 'documents.view', summary: 'A room, its documents, its guests and what they opened (names and emails need people.read).',
    example: { data: { ...room, documents: [{ id: ID.doc, title: 'Annual Report 2026' }], guests: [{ id: ID.guest, name: 'Sam Patel', email: 'sam.patel@example.com', organisation: 'Example Capital', status: 'agreed', expires_at: '2026-11-14T02:00:00Z', terms_accepted_at: '2026-10-16T00:12:00Z', last_seen_at: '2026-10-18T04:30:00Z', invited_at: '2026-10-15T02:05:00Z', views: [{ document_id: ID.doc, viewed_at: '2026-10-16T00:15:00Z' }] }] } } },
  { tag: 'Data rooms', method: 'POST', path: '/data-rooms/{id}/guests', scope: 'documents.do', status: 201, summary: 'Invite a guest; returns their personal link.',
    body: [{ name: 'name', type: 'string', required: true, description: 'Their name.', example: 'Sam Patel' }, { name: 'email', type: 'string', required: true, description: 'Their email.', example: 'sam.patel@example.com' }, { name: 'organisation', type: 'string', description: 'Who they’re with.', example: 'Example Capital' }, { name: 'days', type: 'integer', description: '1–180, default 30.', example: 30 }, { name: 'send_email', type: 'boolean', description: 'Email the link (default true).', example: true }],
    example: { data: { id: ID.guest, link: 'https://investors.lakeba.com/room/…', expires_in_days: 30, emailed: true } } },
  { tag: 'Data rooms', method: 'DELETE', path: '/data-rooms/{id}/guests/{guestId}', scope: 'documents.do', summary: 'Revoke a guest: their link stops working at once.', example: { data: { id: ID.guest, revoked: true } } },
  { tag: 'Newsletter', method: 'GET', path: '/newsletter/subscribers', scope: 'newsletters.view', summary: 'Newsletter subscribers (also needs people.read).', query: [...page, since, { name: 'status', type: 'string', description: 'pending, subscribed or unsubscribed.', example: 'subscribed' }],
    example: list({ id: ID.subscriber, email: 'jamie.chen@example.com', name: 'Jamie Chen', source: 'website', status: 'subscribed', confirmed_at: '2026-10-02T07:20:00Z', unsubscribed_at: null, created_at: '2026-10-02T07:18:00Z' }, 240) },
  { tag: 'Newsletter', method: 'POST', path: '/newsletter/subscribers', scope: 'newsletters.do', status: 201, summary: 'Subscribe someone who asked for the newsletter (you’re responsible for their consent). 200 instead of 201 when they were already on the list.',
    body: [{ name: 'email', type: 'string', required: true, description: 'Their email.', example: 'jamie.chen@example.com' }, { name: 'name', type: 'string', description: 'Their name.', example: 'Jamie Chen' }], example: { data: { id: ID.subscriber, status: 'subscribed' } } },
  { tag: 'Newsletter', method: 'DELETE', path: '/newsletter/subscribers/{id}', scope: 'newsletters.do', summary: 'Unsubscribe.', example: { data: { id: ID.subscriber, status: 'unsubscribed' } } },
  { tag: 'Legal', method: 'GET', path: '/legal/record', scope: 'legal.view', summary: 'The company’s legal record: ACN, ABN, type, registered office, principal place of business, year end, review date, auditor and ultimate holding company.',
    example: { data: [{ company: 'EXV', legal_name: 'Example Ventures Pty Ltd', acn: '123 456 789', abn: '12 123 456 789', company_type: 'proprietary', incorporated_on: '2019-03-14', registered_in: 'NSW', registered_office: 'Level 5, 1 Example Street, Sydney NSW 2000', principal_place: 'Level 5, 1 Example Street, Sydney NSW 2000', year_end: '06-30', review_date: '03-14', auditor: null, ultimate_holding: 'Example Holdings Pty Ltd', extract_dated: '2026-10-28', updated_at: '2026-10-29T01:12:00Z' }] } },
  { tag: 'Legal', method: 'GET', path: '/legal/officers', scope: 'legal.view', summary: 'The officers register: directors and secretaries with their dates. Names and emails need people.read; private details (address, date of birth) never leave the portal.', query: [...page, { name: 'current', type: 'boolean', description: 'Only those in office today.', example: true }],
    example: list({ company: 'EXV', id: ID.officer, position: 'director', appointed_on: '2019-03-14', ceased_on: null, consent_on: '2019-03-10', updated_at: '2026-10-29T01:12:00Z', full_name: 'Jordan Lee', email: 'jordan.lee@example.com' }, 4) },
  { tag: 'Legal', method: 'GET', path: '/legal/deadlines', scope: 'legal.view', summary: 'Legal deadlines (annual review, solvency resolution, financial report, AGM, notices to ASIC…), soonest first. added_by says whether the portal worked it out from the records or a person added it.', query: [...page, { name: 'status', type: 'string', description: 'open, done or not_needed.', example: 'open' }, { name: 'from', type: 'string', description: 'Due on or after (YYYY-MM-DD).' }, { name: 'to', type: 'string', description: 'Due on or before (YYYY-MM-DD).' }],
    example: list({ company: 'EXV', id: ID.deadline, kind: 'annual_review', title: 'Annual review 2027: check the company statement and pay the ASIC fee', detail: 'ASIC sends the annual statement on the review date; the fee is due within two months.', due_on: '2027-05-14', status: 'open', done_on: null, done_note: null, created_at: '2026-10-29T01:12:00Z', added_by: 'portal' }, 6) },
  { tag: 'Legal', method: 'PATCH', path: '/legal/deadlines/{id}', scope: 'legal.do', summary: 'Mark a deadline done, or not needed (with a note saying why), or open it again. Proof files are added in the portal.',
    body: [{ name: 'status', type: 'string', required: true, description: 'done, not_needed or open.', example: 'done' }, { name: 'done_on', type: 'string', description: 'YYYY-MM-DD (default today).', example: '2026-11-04' }, { name: 'note', type: 'string', description: 'What was done; required for not_needed.', example: 'Annual statement reviewed and fee paid.' }],
    example: { data: { id: ID.deadline, title: 'Annual review 2027: check the company statement and pay the ASIC fee', status: 'done', done_on: '2026-11-04' } } },
  { tag: 'Legal', method: 'GET', path: '/legal/contracts', scope: 'legal.view', summary: 'Contracts read by Lakeba AI and checked by a person (checked): parties, dates, renewal and notice, value and the clauses that matter. Soonest ending first.', query: [...page, { name: 'status', type: 'string', description: 'draft, active or ended.', example: 'active' }, { name: 'ends_before', type: 'string', description: 'Ending on or before (YYYY-MM-DD).' }],
    example: list({ company: 'EXV', id: ID.contract, title: 'Distribution agreement', counterparty: 'Example Retail Pty Ltd', contract_type: 'customer', status: 'active', signed_on: '2025-02-01', starts_on: '2025-02-01', ends_on: '2028-01-31', auto_renews: true, renewal_term: '12 months', notice_days: 90, value: 'About $1.2m a year', governing_law: 'New South Wales', change_of_control: 'Consent needed on a change of control', assignment: 'Not without consent', exclusivity: 'Exclusive in Australia and New Zealand', liability_cap: 'Fees paid in the previous 12 months', termination: 'Either party on 90 days’ notice after the first term', summary: 'Three-year distribution deal for Australia and New Zealand.', created_at: '2026-10-29T03:40:00Z', updated_at: '2026-10-29T03:52:00Z', checked: true }, 14) },
  { tag: 'Reporting', method: 'GET', path: '/reporting/packs', scope: 'reporting.view', summary: 'The company’s reporting packs for Lakeba: profit and loss (period and year to date) and balance sheet per period, newest first, with their status.', query: [...page, { name: 'status', type: 'string', description: 'open (to send), submitted (with Lakeba), returned (a question from Lakeba) or accepted.', example: 'open' }],
    example: list({ company: 'EXV', id: ID.pack, period_end: '2026-10-31', cadence: 'monthly', due_on: '2026-11-15', status: 'open', source: null, figures: {}, note: '', submitted_at: null, reviewed_at: null, updated_at: '2026-11-01T00:00:00Z' }, 9) },
  { tag: 'Reporting', method: 'GET', path: '/reporting/packs/{id}', scope: 'reporting.view', summary: 'A pack, its figures and the messages about it between Lakeba and the company.',
    example: { data: { company: 'EXV', id: ID.pack, period_end: '2026-09-30', cadence: 'monthly', due_on: '2026-10-15', status: 'returned', source: 'xero', figures, note: 'A strong month for distribution.', submitted_at: '2026-10-12T05:00:00Z', reviewed_at: '2026-10-14T02:30:00Z', updated_at: '2026-10-14T02:30:00Z', messages: [{ body: 'Employee costs are up 18% on August: is that the two new hires?', created_at: '2026-10-14T02:30:00Z' }] } } },
  { tag: 'Reporting', method: 'PUT', path: '/reporting/packs/{id}', scope: 'reporting.do', summary: 'Fill a pack from your accounting system (only while it’s open, or returned with a question): the standard lines in the schedule’s currency, whole units. Send it to Lakeba with send: true; Lakeba’s finance team is told.',
    description: 'P&L lines (each { period, ytd }): revenue, other_income, cost_of_sales, employee_costs, other_expenses, depreciation, interest, income_tax, net_profit. Balance sheet lines: cash, receivables, other_current_assets, non_current_assets, payables, borrowings, other_liabilities, equity. Lines left out are blank.',
    body: [{ name: 'figures', type: 'object', required: true, description: '{ pl: { <line>: { period, ytd } }, bs: { <line>: amount } }, whole units; null for blank.', example: figures }, { name: 'note', type: 'string', description: 'Your commentary for the period.', example: 'A strong month for distribution.' }, { name: 'send', type: 'boolean', description: 'Send to Lakeba now (default false: saved, still with you).', example: false }],
    example: { data: { company: 'EXV', id: ID.pack, period_end: '2026-10-31', cadence: 'monthly', due_on: '2026-11-15', status: 'open', source: 'api', figures, note: 'A strong month for distribution.', submitted_at: null, reviewed_at: null, updated_at: '2026-11-04T01:00:00Z' } } },
  { tag: 'Boardroom', method: 'GET', path: '/board-meetings', scope: 'boardroom.view', summary: 'Directors’ meetings (shareholder meetings are under Meetings), newest first: attendance, recording and the minutes’ status. Names need people.read.', query: page,
    example: list({ company: 'EXV', id: ID.board_meeting, title: 'Board meeting – November 2026', held_at: '2026-11-26T23:00:00Z', location: 'Level 5, 1 Example Street, Sydney', recording_status: 'done', created_at: '2026-11-10T04:00:00Z', updated_at: '2026-11-27T03:10:00Z', attendees: [{ role: 'director', present: true, name: 'Jordan Lee' }], has_transcript: true, minutes: { status: 'signed', signed_at: '2026-12-02T01:15:00Z', document_id: ID.doc } }, 7) },
  { tag: 'Boardroom', method: 'GET', path: '/board-meetings/{id}', scope: 'boardroom.view', summary: 'A directors’ meeting: agenda, attendance, the minutes’ status, the decks Lex presented and how many questions it answered. ?include=transcript adds the transcript (it names the speakers, so it also needs people.read).', query: [{ name: 'include', type: 'string', description: 'transcript to add the transcript.', example: 'transcript' }],
    example: { data: { company: 'EXV', id: ID.board_meeting, title: 'Board meeting – November 2026', held_at: '2026-11-26T23:00:00Z', location: 'Level 5, 1 Example Street, Sydney', agenda: '1. Minutes of the last meeting\n2. CFO report\n3. Risk report', recording_status: 'done', created_at: '2026-11-10T04:00:00Z', updated_at: '2026-11-27T03:10:00Z', attendees: [{ role: 'director', present: true, name: 'Jordan Lee' }], has_transcript: true, minutes: { status: 'signing', signed_at: null, document_id: null }, decks: [{ id: ID.deck, title: 'CFO report – October 2026', role: 'cfo', source: 'drafted', status: 'approved', presented_at: '2026-11-26T23:25:00Z' }], lex_answers: 3, transcript: 'Jordan Lee: Let’s start with the minutes of the last meeting…' } } },
  { tag: 'HR', method: 'GET', path: '/hr/people', scope: 'hr.view', summary: 'The company’s people in HR: role, team, employment type, dates and status. Names and emails need people.read; private details stay in the portal.', query: [...page, { name: 'status', type: 'string', description: 'onboarding, active, offboarding or left.', example: 'active' }],
    example: list({ company: 'EXV', id: ID.employee, job_title: 'Head of Product', team: 'Product', employment_type: 'full_time', manager_id: null, location: 'Sydney', start_date: '2025-07-01', end_date: null, status: 'active', created_at: '2025-06-20T02:00:00Z', updated_at: '2026-10-29T01:00:00Z', full_name: 'Riley Nguyen', email: 'riley.nguyen@example.com' }, 23) },
  { tag: 'HR', method: 'GET', path: '/hr/equity-grants', scope: 'hr.view', summary: 'Option and share grants under the company’s equity plans, with vesting terms and status. The holder’s name needs people.read.', query: [...page, { name: 'status', type: 'string', description: 'draft, granted, cancelled or lapsed.', example: 'granted' }],
    example: list({ company: 'EXV', plan: { id: ID.plan, name: 'Employee Share Option Plan', kind: 'options' }, id: ID.grant, person_id: ID.employee, number: 40000, exercise_price: 0.5, grant_date: '2025-07-01', vesting_start: '2025-07-01', vesting_months: 48, cliff_months: 12, frequency: 'monthly', expiry_date: '2032-07-01', status: 'granted', vesting_stopped_on: null, accepted_at: '2025-07-03T04:00:00Z', created_at: '2025-06-28T02:00:00Z', updated_at: '2025-07-03T04:00:00Z', holder_name: 'Riley Nguyen' }, 11) },
  { tag: 'Events and webhooks', method: 'GET', path: '/events', scope: 'any', summary: 'Events of the last 30 days, for tools that poll instead of receiving webhooks. Only the events your key’s scopes cover.', query: [{ name: 'after', type: 'integer', description: 'The last sequence you saw (0 to start).', example: 0 }, { name: 'type', type: 'string', description: 'One event type.', example: 'holdings.changed' }, { name: 'limit', type: 'integer', description: '1–200.', example: 100 }],
    example: { data: [{ sequence: 1042, id: ID.event, type: 'holdings.changed', description: EVENTS['holdings.changed'], occurred_at: '2026-11-03T02:14:09Z', company: { code: 'EXV', name: 'Example Ventures' }, data: { holder_id: ID.holder, share_class: 'ORD' } }], next_after: 1042 } },
  { tag: 'Events and webhooks', method: 'GET', path: '/webhooks', scope: 'any', summary: 'This key’s webhook subscriptions, and the events there are.',
    example: { data: [{ id: ID.webhook, url: 'https://hooks.example.com/lakeba', events: ['holdings.changed'], format: 'json', active: true, created_at: '2026-11-01T00:00:00Z' }], events: [{ type: 'holdings.changed', description: EVENTS['holdings.changed'], scope: 'investors.view' }] } },
  { tag: 'Events and webhooks', method: 'POST', path: '/webhooks', scope: 'any', status: 201, summary: 'Subscribe a URL to events (REST hooks, as Zapier and Make use them). Returns the signing secret once.',
    body: [{ name: 'target_url', type: 'string', required: true, description: 'https:// address.', example: 'https://hooks.example.com/lakeba' }, { name: 'events', type: 'array', required: true, description: 'Event types (see Webhooks).', example: ['holdings.changed', 'register.imported'] }, { name: 'format', type: 'string', description: 'json (default), slack or teams.', example: 'json' }],
    example: { data: { id: ID.webhook, target_url: 'https://hooks.example.com/lakeba', events: ['holdings.changed', 'register.imported'], format: 'json', secret: 'whsec_…' } } },
  { tag: 'Events and webhooks', method: 'DELETE', path: '/webhooks/{id}', scope: 'any', summary: 'Unsubscribe.', example: { data: { id: ID.webhook, deleted: true } } },
];

// Short names for the reference's menu.
const TITLES: Record<string, string> = {
  'GET /company': 'Get the company', 'GET /share-classes': 'List share classes', 'GET /holders': 'List holders', 'GET /holders/{id}': 'Get a holder',
  'POST /holders/{id}/holdings': 'Record a holding', 'PUT /holders/{id}/external-ids/{system}': 'Set a holder’s external ID', 'GET /holdings': 'List holdings',
  'GET /holdings/history': 'Holdings history', 'GET /register/movements': 'List register movements', 'GET /register/imports': 'List register imports',
  'POST /register/imports': 'Send a register of members', 'GET /people': 'List investors', 'GET /people/{id}': 'Get an investor', 'POST /people': 'Add an investor',
  'PATCH /people/{id}': 'Update an investor', 'PUT /people/{id}/external-ids/{system}': 'Set an investor’s external ID', 'GET /documents': 'List documents',
  'GET /documents/{id}': 'Get a document', 'POST /documents': 'Upload a document', 'GET /posts': 'List news posts', 'POST /posts': 'Draft a news post',
  'GET /announcements': 'List announcements', 'GET /meetings': 'List meetings', 'GET /meetings/{id}': 'Get a meeting', 'POST /meetings': 'Create a meeting',
  'POST /meetings/{id}/resolutions': 'Add a resolution', 'GET /queries': 'List questions', 'POST /queries/{id}/replies': 'Reply to a question',
  'GET /data-rooms': 'List data rooms', 'GET /data-rooms/{id}': 'Get a data room', 'POST /data-rooms/{id}/guests': 'Invite a guest',
  'DELETE /data-rooms/{id}/guests/{guestId}': 'Revoke a guest', 'GET /newsletter/subscribers': 'List subscribers', 'POST /newsletter/subscribers': 'Add a subscriber',
  'DELETE /newsletter/subscribers/{id}': 'Unsubscribe', 'GET /events': 'List events', 'GET /webhooks': 'List webhook subscriptions', 'POST /webhooks': 'Subscribe a webhook',
  'DELETE /webhooks/{id}': 'Remove a webhook subscription', 'GET /legal/record': 'Get the legal record', 'GET /legal/officers': 'List officers',
  'GET /legal/deadlines': 'List legal deadlines', 'PATCH /legal/deadlines/{id}': 'Complete a deadline', 'GET /legal/contracts': 'List contracts',
  'GET /reporting/packs': 'List reporting packs', 'GET /reporting/packs/{id}': 'Get a reporting pack', 'PUT /reporting/packs/{id}': 'Fill or send a reporting pack',
  'GET /board-meetings': 'List board meetings', 'GET /board-meetings/{id}': 'Get a board meeting', 'GET /hr/people': 'List people', 'GET /hr/equity-grants': 'List equity grants',
};

// What the common fields mean, wherever they appear.
const FIELDS: Record<string, string> = {
  id: 'Lakeba’s ID (a UUID).', company: 'The company’s code.', code: 'Short code.', share_class: 'Share class code.', share_class_id: 'The share class.', holder_id: 'The holder.',
  shares: 'Number of shares.', as_at: 'The date the balance is at.', ownership_pct: 'Percentage of the class on issue (null for classes that don’t count toward ownership).',
  on_issue: 'Shares on issue: the official figure where set, otherwise the sum of holdings.', official_on_issue: 'Official shares on issue, if set.', official_as_at: 'Date of the official figure.',
  counts_toward_ownership: 'Whether holdings of this class count toward % ownership.', registry_ref: 'The holder’s reference on the register of members.', is_group_stake: 'The holder is Lakeba Group itself (its own stake in the company).', represents_company: 'When the holder is a company in the portal (Lakeba Group, or a venture’s holding company), that company’s code; else null.',
  external_ids: 'IDs in your systems, by system name.', holdings: 'Latest holding per class.', total: 'How many there are in all.', next_cursor: 'Pass as ?cursor= for the next page; null on the last page.',
  next_after: 'Pass as ?after= next time.', data: 'The result.', status: 'Status.', kind: 'Kind.', created_at: 'When it was created.', updated_at: 'When it last changed.', published_at: 'When it was published (null for drafts).',
  holders_from_register: 'Holdings come from the register of members (changed by importing a register).', holdings_from_register: 'Holdings come from the register of members (changed by importing a register).',
  relationship: 'group, controlled or portfolio.', access: 'owner (can vote) or viewer.', audience: 'all_investors or board.', category: 'report, agm, update, governance or other.', visibility: 'shareholders or public.',
  email: 'Personal data (people.read).', phone: 'Personal data (people.read).', first_name: 'Personal data (people.read).', last_name: 'Personal data (people.read).',
  sequence: 'Ever-increasing number, for ?after=.', occurred_at: 'When it happened.', proxy_votes: 'Proxy votes lodged so far, by choice.', seq: 'Order of the movement for that holder and class.',
  balance: 'Balance after the movement.', consideration: 'Amount paid.', paid_per_share: 'Amount paid per share.', unpaid_per_share: 'Amount unpaid per share.', party_holder_id: 'The other holder in a transfer.',
  full_name: 'Personal data (people.read).', holder_name: 'Personal data (people.read).', position: 'director, alternate_director or secretary.', added_by: 'portal (worked out from the records) or person.',
  period_end: 'Last day of the period.', cadence: 'monthly or quarterly.', due_on: 'When it is due.', source: 'Where the figures came from: upload, xero, typed or api.', figures: 'P&L lines (period and year to date) and balance sheet lines, whole units.',
  minutes: 'The minutes: draft, signing or signed (null when there are none yet).', has_transcript: 'A transcript was made from the recording.', recording_status: 'none, recording, paused, processing, done or failed.',
  lex_answers: 'Questions Lex answered in the meeting.', checked: 'A person checked what Lakeba AI read from the contract.', employment_type: 'full_time, part_time, casual, contractor or advisor.',
  download_url: 'Signed link to the file.', download_expires_in: 'Seconds the link works for.', secret: 'Signing secret for Lakeba-Signature: shown only now.', link: 'The guest’s personal link.',
};

type Schema = Record<string, unknown>;
/** A JSON schema worked out from an example, with the field descriptions. */
function schemaOf(v: unknown, name?: string): Schema {
  const d = name && FIELDS[name] ? { description: FIELDS[name] } : {};
  if (v === null) return { type: ['string', 'null'], ...d };
  if (Array.isArray(v)) return { type: 'array', items: v.length ? schemaOf(v[0]) : {}, ...d };
  if (typeof v === 'object') {
    if (name === 'external_ids' || name === 'totals') return { type: 'object', additionalProperties: { type: name === 'totals' ? 'integer' : 'string' }, ...d };
    return { type: 'object', properties: Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, schemaOf(x, k)])), ...d };
  }
  return { type: typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v, ...d };
}

const TAGS: Record<string, string> = {
  Company: 'The company the key belongs to and its share classes.',
  Register: 'Holders, holdings and the register of members. For a company whose holdings come from its register, holdings change only by importing a register, which an Admin confirms.',
  People: 'Investors (people with access to holders). Reading them needs **people.read**.',
  Documents: 'Documents for investors or the board. New ones arrive as drafts, to publish in the portal.',
  News: 'News posts and dashboard announcements.',
  Meetings: 'AGMs and EGMs, resolutions and proxy vote totals. Opening voting and publishing results stay in the portal.',
  'Board Q&A': 'Questions from investors to the board.',
  'Data rooms': 'Rooms for due diligence and their guests.',
  Newsletter: 'The company’s public newsletter list. Reading it needs **people.read**.',
  Legal: 'The company’s legal record, officers register, deadlines calendar and contracts, as kept in Legal (Lakeba’s company secretary). Names need **people.read**.',
  Reporting: 'Reporting packs the company sends Lakeba: fill them from your accounting system and send them.',
  Boardroom: 'Directors’ meetings recorded with the Observer: attendance, minutes, decks and transcripts.',
  HR: 'People and equity grants. Names and emails need **people.read**.',
  'Events and webhooks': 'Events to poll, and webhook subscriptions for tools like Zapier and Make.',
};

const GUIDE = (origin: string) => `For a company’s other tools: its register, investors, documents, news, meetings, Board Q&A, data rooms, newsletter, legal records and deadlines, reporting packs, board meetings and HR.
The full guide (HubSpot, Xero, incoming webhooks, apps) is at [/developers](${origin}/developers).

## Keys
A company’s Admins make keys in **Admin → Companies → the company → Integrations → API keys**, choosing what each key may do.
A key belongs to that company only. Send it as \`Authorization: Bearer lk_live_…\`. Test keys (\`lk_test_…\`) work on staging only.

**Try it** sends real requests from your browser with the key you enter: on the live portal they read and change real data.
The key isn’t saved by this page.

## Scopes
“do” includes “view”. **people.read** (names, emails, phones, addresses) is never implied: without it, answers and webhooks leave personal details out.

${API_SCOPES.map((s) => `- \`${s.key}\`: ${s.label}`).join('\n')}

## Requests
- **Lists** return \`data\`, \`total\` and \`next_cursor\`: pass it back as \`?cursor=\`. \`limit\` is 1–200 (default 50).
- **Errors** are \`application/problem+json\` with \`status\`, \`code\` and a plain-English \`detail\`.
- **Rate limit**: 300 requests a minute per key (\`X-RateLimit-Remaining\`; 429 with \`Retry-After\` beyond).
- **Retries**: send \`Idempotency-Key: <your id>\` with writes; the same key gets the first answer again for a day.
- **Your IDs**: store your system’s ID on holders and investors (\`PUT …/external-ids/<system>\`); reads return them as \`external_ids\`.
- Every write is in the company’s audit log, as made by the key.

## Webhooks
For each event chosen, the portal POSTs JSON with the headers \`Lakeba-Event\`, \`Lakeba-Event-Id\` (to ignore repeats) and
\`Lakeba-Signature: t=<seconds>,v1=<hex>\`: the HMAC-SHA256 of \`"<t>.<body>"\` with the webhook’s secret. Answer with any 2xx within 15 seconds.
Failures are retried for about three days. The events are listed under **Webhooks**.

\`\`\`js
import { createHmac, timingSafeEqual } from 'node:crypto';

// raw: the request body exactly as received; header: Lakeba-Signature
function fromLakeba(raw, header, secret) {
  const m = /^t=(\\d+),v1=([0-9a-f]{64})$/.exec(header ?? '');
  if (!m || Math.abs(Date.now() / 1000 - Number(m[1])) > 300) return false;
  const expected = createHmac('sha256', secret).update(\`\${m[1]}.\${raw}\`).digest('hex');
  return timingSafeEqual(Buffer.from(expected), Buffer.from(m[2]));
}
\`\`\``;

// What an event's data usually carries (IDs and facts; names and emails only with personal data).
const EVENT_DATA: Record<string, Record<string, unknown>> = {
  holder: { holder_id: ID.holder, name: holder.name }, holdings: { holder_id: ID.holder, share_class: 'ORD', shares: 260000, as_at: '2026-11-03' },
  register: { import_id: ID.import, as_at: '2026-10-31', holders: 86 }, share_class: { share_class_id: ID.ord, official_on_issue: 10000000 },
  person: { user_id: ID.person, holder_id: ID.holder }, holder_access: { user_id: ID.person, holder_id: ID.holder, access: 'owner' },
  document: { document_id: ID.doc, title: 'Annual Report 2026' }, news: { post_id: ID.post, title: 'Example Ventures signs distribution deal' },
  meeting: { meeting_id: ID.meeting, title: '2026 Annual General Meeting' }, proxy: { meeting_id: ID.meeting, user_id: ID.person },
  query: { query_id: ID.query, subject: 'Timing of the next capital raise' }, data_room: { room_id: ID.room, guest_id: ID.guest },
  newsletter: { subscriber_id: ID.subscriber }, company_record: { entity_id: ID.company }, officer: { officer_id: ID.officer, position: 'director' },
  deadline: { obligation_id: ID.deadline, title: 'Annual review 2027: check the company statement and pay the ASIC fee' }, contract: { contract_id: ID.contract, title: 'Distribution agreement' },
  reporting_pack: { pack_id: ID.pack, period_end: '2026-10-31' }, board_meeting: { meeting_id: ID.board_meeting, title: 'Board meeting – November 2026' },
  board_paper: { paper_id: '0b2d4f6b-8d0f-4b2d-8f4b-6d8f0b2d4fe1' }, employee: { person_id: ID.employee }, equity: { grant_id: ID.grant, number: 40000 }, approval: { approval_id: '0a2c4e6a-8c0e-4a2c-8e4a-6c8e0a2c4e66', area: 'documents' },
  trade_interest: { interest_id: '4c6e8a0c-2e4a-4c6e-8a0c-2e4a6c8e0a77', side: 'sell', share_class: 'ORD' }, inbound: { message_id: '1b3d5f7a-9c1e-4b3d-8f5a-7c9e1b3d5f88', kind: 'newsletter.subscribe' },
};

/** The OpenAPI 3.1 document. */
export function openApi(origin: string) {
  const problem = { $ref: '#/components/responses/Problem' };
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPS) {
    const params = [...(op.path.match(/\{(\w+)\}/g) ?? []).map((p) => {
      const name = p.slice(1, -1);
      return { name, in: 'path', required: true, description: name === 'system' ? 'Your system’s name, e.g. crm or hubspot.' : 'The ID.', schema: { type: 'string' }, example: name === 'system' ? 'crm' : undefined };
    }), ...(op.query ?? []).map((q) => (
      // A filter's example goes in its description: as an "example", "Try it" fills it in and switches it on, so
      // a list comes back empty (e.g. updated_since in the future). Only "limit" is safe to fill in.
      q.name === 'limit' || q.example === undefined
        ? { name: q.name, in: 'query', required: false, description: q.description, schema: { type: q.type }, ...(q.example !== undefined ? { example: q.example } : {}) }
        : { name: q.name, in: 'query', required: false, description: `${q.description} For example: \`${q.example}\`.`, schema: { type: q.type } }
    ))];
    if (op.method !== 'GET') params.push({ name: 'Idempotency-Key', in: 'header', required: false, description: 'Your ID for this request: a repeat with the same key gets the first answer again (for a day).', schema: { type: 'string' }, example: undefined });
    const example = op.body && Object.fromEntries(op.body.filter((b) => b.example !== undefined).map((b) => [b.name, b.example]));
    const body = op.bodyType ? { required: true, content: { [op.bodyType]: { schema: { type: 'string', format: 'binary' } } } }
      : op.body ? { required: true, content: { 'application/json': {
        schema: { type: 'object', required: op.body.filter((b) => b.required).map((b) => b.name), properties: Object.fromEntries(op.body.map((b) => [b.name, { type: b.type, description: b.description, ...(b.type === 'array' ? { items: { type: 'string' } } : {}) }])) },
        ...(example && Object.keys(example).length ? { example } : {}) } } }
      : undefined;
    const ok = String(op.status ?? 200);
    (paths[op.path] ??= {})[op.method.toLowerCase()] = {
      tags: [op.tag], summary: TITLES[`${op.method} ${op.path}`] ?? op.summary,
      description: `${op.summary}${op.description ? `\n\n${op.description}` : ''}\n\n${op.scope === 'any' ? 'Any key.' : `Needs the \`${op.scope}\` scope.`}`, ...(op.scope !== 'any' ? { 'x-scope': op.scope } : {}),
      operationId: `${op.method.toLowerCase()}${op.path.replace(/\{(\w+)\}/g, 'By-$1').split(/[/-]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('')}`,
      ...(params.length ? { parameters: params } : {}), ...(body ? { requestBody: body } : {}),
      responses: {
        [ok]: { description: { 200: 'OK', 201: 'Created', 202: 'Received: waiting for an Admin' }[ok] ?? 'OK', ...(op.example ? { content: { 'application/json': { schema: schemaOf(op.example), example: op.example } } } : {}) },
        400: problem, 401: problem, 403: problem, 404: problem, ...(op.method !== 'GET' ? { 422: problem } : {}), 429: problem,
      },
    };
  }
  const webhooks = Object.fromEntries(Object.entries(EVENTS).map(([type, description]) => {
    const payload = { id: ID.event, type, occurred_at: '2026-11-03T02:14:09Z', company: { code: 'EXV', name: 'Example Ventures' }, description, data: EVENT_DATA[type.split('.')[0]] ?? {} };
    return [type, { post: {
      tags: ['Webhooks'], summary: type, description: `${description}. Sent to webhooks subscribed to \`${type}\`. Needs the \`${eventScope(type)}\` scope. \`data\` carries IDs and facts (the example shows typical fields; they vary with how it happened); names and emails only for webhooks allowed personal data.`,
      parameters: [
        { name: 'Lakeba-Event', in: 'header', required: true, schema: { type: 'string' }, example: type, description: 'The event type.' },
        { name: 'Lakeba-Event-Id', in: 'header', required: true, schema: { type: 'string' }, example: ID.event, description: 'The event’s ID: use it to ignore repeats.' },
        { name: 'Lakeba-Signature', in: 'header', required: true, schema: { type: 'string' }, example: 't=1793672049,v1=5f2b…', description: 'HMAC-SHA256 of "<t>.<body>" with the webhook’s secret.' },
      ],
      requestBody: { required: true, content: { 'application/json': { schema: schemaOf(payload), example: payload } } },
      responses: { 200: { description: 'Any 2xx within 15 seconds counts as received.' } },
    } }];
  }));
  return {
    openapi: '3.1.0',
    info: { title: 'Lakeba investor portal API', version: '1.0.0', description: GUIDE(origin), contact: { name: 'Lakeba', url: `${origin}/developers` } },
    servers: [{ url: `${origin}/api/v1`, description: 'This portal' }],
    security: [{ key: [] }],
    tags: [...Object.entries(TAGS).map(([name, description]) => ({ name, description })), { name: 'Webhooks', description: 'What the portal sends to your webhooks.' }],
    components: {
      securitySchemes: {
        key: { type: 'http', scheme: 'bearer', description: 'A company API key (lk_live_…) or an app’s access token (lk_oat_…).' },
        oauth: { type: 'oauth2', description: 'For apps registered with Lakeba (Zapier, marketplace apps).', flows: { authorizationCode: { authorizationUrl: `${origin}/oauth/authorize`, tokenUrl: `${origin}/oauth/token`, scopes: Object.fromEntries(API_SCOPES.map((s) => [s.key, s.label])) } } },
      },
      responses: { Problem: { description: 'An error (application/problem+json).', content: { 'application/problem+json': {
        schema: { type: 'object', properties: { type: { type: 'string' }, title: { type: 'string' }, status: { type: 'integer' }, code: { type: 'string', description: 'e.g. missing_key, invalid_key, insufficient_scope, not_found, register_company, rate_limited.' }, detail: { type: 'string', description: 'What went wrong, in plain English.' } } },
        example: { type: `${origin}/developers#insufficient_scope`, title: 'Forbidden', status: 403, code: 'insufficient_scope', detail: 'This key needs the “investors.view” scope.' } } } } },
    },
    paths,
    webhooks,
    'x-webhook-events': EVENTS,
  };
}
