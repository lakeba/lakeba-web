# Lakeba Investor Portal

Server-rendered Astro app for shareholders and directors, backed by Supabase: Postgres with row-level security, sign-in with two-step verification, and private file storage. It shares the brand styles (`../src/styles/brand.css`) and logo with the marketing site.

## What's in it

**For shareholders**
- **Dashboard**: holdings per entity and share class, % of total on issue, indicative value and reference-price chart, announcements, secondary-trading card, latest documents (new ones highlighted), next meeting, Board Q&A status, update video and news.
- **Holding statement**: a personal PDF for each holding, with history and indicative value.
- **Documents**: categories, year filter and search. Files open through short-lived signed links, and every open is recorded.
- **Portfolio**: Lakeba's ventures, its stake in each and their latest milestones.
- **Meetings (AGM)**: papers, livestream link, online proxy voting until the deadline (owners only; read-only viewers can't vote), questions sent in advance, results.
- **Ask Lakeba**: answers from published documents only, with citations to the document and page. It uses Claude Opus 5.5 when `ANTHROPIC_API_KEY` is set; otherwise it shows the matching passages. Limited to 20 questions per hour per user.
- **Board Q&A**: questions with message threads and a 7-working-day reply target.
- **Profile, inbox and security**: contact details and email preferences, in-app notifications, two-step verification and password.

**For admins** (`/admin`, admin role plus a two-step-verified session)
- Investors (invite, roles, holder links, disable, reset two-step), holders and CSV holdings import with preview, documents (upload, schedule, notify, reader counts), Board Q&A queue with internal notes, news and announcements, meetings and vote tallies, ventures and reference prices, and the audit log with CSV export.

## Run locally

Needs Docker Desktop running.

```bash
npm install
npm run db:start      # local Supabase: API :54321, Studio :54323, test mail inbox :54324
npm run db:reset      # apply migrations and supabase/seed.sql
cp .env.example .env  # then fill in the values printed by `npx supabase status`
npm run seed:dev      # test accounts (→ .dev-users.json, gitignored) and sample PDFs
npm run dev           # http://localhost:4322
```

Test accounts: `admin@lakeba.test` (must set up two-step), `investor.one@lakeba.test` (two holders), `investor.two@lakeba.test`, `director@lakeba.test` (board). All sample data is fictional. Emails are caught by the local inbox at http://127.0.0.1:54324.

## Checks

```bash
npm run test:rls   # 41 access checks: holdings, documents, file links, Q&A, proxies, search, notifications
npm run build
```

## How access works

- **Sign-in**: password or emailed link, with password reset. Passwords need 12+ characters with upper- and lower-case letters and a number. Optional Cloudflare Turnstile (`TURNSTILE_SITE_KEY`).
- **Two-step verification (TOTP)**: optional for investors, required for admins. Once someone has it, every new session must enter a code.
- **Row-level security**: every table has it. Investors read only what is linked to their holders. Content needs a holder link (or the board role). Admin rights need the admin role *and* an `aal2` session. "Total on issue", vote tallies and Ask search run in database functions, so investors never see other holders' rows.
- **Private files**: documents live in a private bucket. Access to the file follows access to its `documents` row.
- **Audit**: sign-ins, document opens, statements, proxies, profile and admin changes go to `audit_log`.
- **Pages**: `no-store` caching, anti-framing headers, and Astro's origin check on form posts.

## Moving from the WordPress portal

See [docs/migration.md](docs/migration.md) and `scripts/import-legacy.mjs` (dry run by default) with the CSV templates in `migration-templates/`.

## Not done yet

- Hosting: the Node adapter is a placeholder until the Vercel or Cloudflare decision.
- A hosted Supabase project, production email (SMTP), and an Anthropic API key for Ask Lakeba.
- Public holidays are not excluded from the 7-working-day reply target.
