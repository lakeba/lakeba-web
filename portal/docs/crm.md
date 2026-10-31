# The CRM

Each company can switch on its own CRM (Admin → Sales → CRM, or the company's CRM address such as
`crm.doxai.com`). It is built into the portal and Xero: one sign-in, the portal's roles, approvals,
notifications, audit log, AI budgets, Xero connection, mailboxes, Recall and API. The vision and the
plan are the two Claude Docs linked from the CRM's memory notes; this page is the reference for how it works.

## The idea

A CRM that keeps itself up to date: emails, meetings, calls, WhatsApp messages, deal-room visits and Xero
changes land on the timeline without anyone typing them; Lakeba AI proposes the next step and the
salesperson confirms. Money is the truth: a deal is **won when Xero says it's paid**.

## Records (lib/crm.ts)

| Table | What | Scope |
|---|---|---|
| `crm_people`, `crm_companies` | One record per person and company for the whole group (matched by email, web domain, name) | Group |
| `crm_relationships` | A company's tie to a person or company: kind, owner, warmth, Xero contact, lead score, campaign, shareable | Company |
| `crm_pipelines`, `crm_stages` | Pipelines and stages per company (B2B, partners, students) with chance, exit criteria, cold-after days | Company |
| `crm_deals`, `crm_deal_people` | Deals (value in their own currency, forecast category, Xero invoices and payments) and the buying group | Company |
| `crm_tasks`, `crm_activities` | Follow-ups; the timeline (`source_ref` files each email or meeting once) | Company |
| `crm_fields` | The company's own fields on deals, people and companies | Company |
| `crm_quotes`, `crm_quote_lines` | Quotes, versions, Xero quote and invoice | Company |
| `crm_rooms`, `crm_room_files` | Deal rooms (`/deal/<token>`, files in the `crm` bucket) | Company |
| `crm_mailboxes`, `crm_inbox` | Salespeople's connected mailboxes; "Found in your inbox" | Company |
| `crm_ai_usage`, `crm_ask_log`, `crm_reviews`, `crm_recordings` | AI spend, Ask questions, Monday review notes, recorded sales meetings | Company |
| `crm_phones`, `crm_whatsapp` | Linked WhatsApp numbers; messages handled | Person |
| `crm_campaigns`, `crm_forms`, `crm_sequences`, `crm_enrolments`, `crm_consents` | Marketing; consent per person (one opt-out list) | Company / group |
| `crm_sharing`, `crm_introductions` | Sharing between two ventures; introductions (venture or shareholder) | Group |

All tables are read and written by the portal's server only (RLS on, no grants), like HR.

Migrations (CRM branch): `20261229000000_crm_foundation`, `…0100_crm_events`, `…0200_crm_selling`,
`…0300_crm_ai`, `…0400_crm_mobile`, `…0500_crm_marketing`, `…0600_crm_group`.

## Access

- Area **crm** (see, do, approve): **Sales** (see, do: their own deals and unassigned ones, the team's
  pipeline), **Sales lead** (also approve: every deal, discounts over the limit, settings), **Admin**.
- Area **leadgen** (CRM marketing, see and do): forms, campaigns, sequences, lead scores, without deals.
  The **Marketing** role has it; sales leads and Admins too.
- Switching a company's CRM on, its address, sharing with another venture and the AI budget: the
  company's Admins.

## Addresses

The CRM's pages are `/admin/crm/…` on the portal's address. A company can add its own CRM address
(CRM → Settings → The CRM's own address): a CNAME to the portal's address; once it points there, the CRM
opens at its root and everything else goes to the central address. Sign-in happens on the central address
and a one-time pass carries it across (`auth/pass`), **only for people whose every role is for that
company**; Lakeba staff use the CRM on the central address. Lakeba Group's own CRM address is a lakeba.com name
(crm.lakeba.com, only Lakeba Group may set one): it is in Lakeba's DNS, so Lakeba's staff sign in there too. Caddy's on-demand certificates are allowed for
verified CRM addresses (`/api/public/domain-check`).

## Xero, end to end (lib/crm-xero.ts)

1. A quote is built from the company's Xero items, prices, tax rates and tracking categories (cached ten
   minutes). Discounts over the company's limit need a sales lead's approval (Approvals, item type
   `quote`).
2. "Approve and copy to Xero": the deal's Xero contact is found or created, the quote is created in Xero
   (draft, same lines and tax), and the owner is credited with that client for commission (if they are in HR
   and nobody else is).
3. In the deal room the buyer accepts: the Xero quote is marked accepted, the deal moves to its last open
   stage.
4. "Raise the invoice in Xero": a draft invoice for Finance.
5. Every 15 minutes the CRM reads the deals' quotes, invoices and payments; paid in full → won.

Xero scopes: the portal's existing `accounting.invoices` and `accounting.settings.read` (quotes are invoices'
siblings). Commission plans can pay on **invoices paid** (`basis`), as the CRM counts a deal won.

## Mailboxes and calendars (lib/crm-mail.ts)

Each salesperson connects their own mailbox (CRM → My mailbox). Microsoft 365: the venture's tenant
(`entities.ms_tenant_id`), Lakeba's app with Mail.Read (and Mail.Send for sequences) limited to the sales
team's mailboxes with an application access policy; calendars for meetings. Google Workspace: the service
account's domain-wide delegation. Every 5 minutes: Inbox and Sent Items (delta), emails with known people
filed on their timelines, business emails from unknown people to "Found in your inbox". The first read takes
the last 30 days (Microsoft). **Staging only reads (`MAILBOXES_READ_ONLY`): sequences never send from it.**

## Lakeba AI (lib/crm-ai.ts)

Sonnet 5.5 for deal reviews, briefs, meeting notes, Ask and the Monday review; Haiku 5.5 for sorting inbox
emails. Each company has a monthly budget (`entities.crm_ai_monthly_usd`, default US$50; 0 or empty switches
AI off); spend is logged in `crm_ai_usage` and shown in the CRM's header. Each morning (6 to 9 am Sydney) the
five biggest changed deals of each salesperson are reviewed; meetings in the next three hours get a brief.
The AI only drafts: nothing goes to a buyer or Xero without a person.

Recorded sales meetings (lib/crm-recall.ts): a notetaker named after the company joins through Recall with
the meeting's captions as transcript, asks everyone's agreement in the chat, and its media is deleted after
the notes are made. The webhook is the existing `/api/hooks/recall`.

## WhatsApp (lib/whatsapp.ts)

One Lakeba WhatsApp Business number (Meta Cloud API). Set on the server: `WHATSAPP_TOKEN` (a system user's
permanent token), `WHATSAPP_PHONE_ID`, `WHATSAPP_NUMBER` (for wa.me links), `WHATSAPP_VERIFY_TOKEN`,
`WHATSAPP_APP_SECRET`; webhook `https://<portal>/api/hooks/whatsapp` (messages field), signed. Production's
`OUTBOUND_ALLOWLIST` (if set) needs `https://graph.facebook.com/` and Meta's media host. A salesperson links
their number by sending a code (CRM → My phone); then text and voice messages update their own deals or are
answered (replies within 24 hours are free). Voice: Deepgram or AssemblyAI in, ElevenLabs out.

## Phone (android/crm, crm.webmanifest)

The Lakeba CRM app for Android (README in `android/`): the CRM in an app, "How did the call go?" after each
business call (READ_PHONE_STATE: only that a call ended), microphone and camera for the portal only. On
iPhone the CRM installs from Safari (Add to Home Screen).

## Marketing (lib/crm-marketing.ts)

- Forms: `<script src="https://<portal>/embed/crm-form.js" async></script><lakeba-form form="ID"></lakeba-form>`
  on the listed websites; or the hosted page `/f/<id>`. Submissions find or add the person and company, credit
  the campaign (the form's, or the page's `utm_campaign`), give the lead to one person or the team in turn,
  optionally make a deal and start a sequence, and notify the owner.
- Sequences: sent from the owner's own mailbox; stop on a reply, a meeting, a WhatsApp, an opt-out or by hand.
  Every email has an opt-out link (`/optout/<token>`).
- One opt-out list: `crm_consents` (sales emails), unsubscribed newsletter subscribers and the press
  office's `media_optouts`.
- Campaign results in cash: deals won (paid) per campaign; spend typed in or from Xero bills tagged with the
  campaign's tracking option.

## The group (lib/crm-group.ts)

Sharing between two ventures starts when both companies' Admins switch it on and stops when either switches
it off. Shared: that the other knows a person or company, the relationship's owner, work details, and the
deal stage where that side allows it. Never values, quotes, notes, emails, recordings, nor relationships
marked not shareable or people who said no to "ventures". Introductions go through the owner. Shareholders
introduce businesses at `/introduce` (translated) when a venture takes introductions; they see stages only.

## API and webhooks

`/api/v1/crm/deals` (GET, POST), `/api/v1/crm/deals/{id}` (GET, PATCH), `/api/v1/crm/people` (GET with
people.read, POST), `/api/v1/crm/companies` (GET); scopes `crm.view`, `crm.do`. Events: `deal.created`,
`deal.stage_changed`, `deal.won`, `deal.lost`, `lead.added`, `quote.sent`, `quote.accepted`, `invoice.paid`.

## Imports

CRM → Import: spreadsheets or CSV (columns recognised from HubSpot, Salesforce and Pipedrive exports) and
HubSpot directly through the company's connection. Records keep their outside id, so importing again adds
only what is new.

## To production (when told)

1. Back up; apply the seven CRM migrations with `migrate.sh`.
2. Deploy the CRM branch (merged into main).
3. Set `WHATSAPP_*` when Meta's number is ready; Recall, Deepgram/AssemblyAI and ElevenLabs keys are already
   there. Check `OUTBOUND_ALLOWLIST`.
4. Microsoft 365: the venture's administrator approves Mail.Read, Mail.Send and Calendars.Read for the
   portal's app, limited to the sales team's mailboxes.
5. Switch the CRM on for the company, give the Sales and Sales lead roles, set the AI budget.
