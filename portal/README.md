# Lakeba Investor Portal

Server-rendered Astro app for shareholders, backed by Supabase (Postgres with row-level security, sign-in, two-step verification). It shares the brand styles (`../src/styles/brand.css`) and logo with the marketing site.

## Run locally

Needs Docker Desktop running.

```bash
npm install
npm run db:start      # local Supabase: API :54321, Studio :54323, test mail inbox :54324
npm run db:reset      # apply migrations and supabase/seed.sql
cp .env.example .env  # then fill in the values printed by `npx supabase status`
npm run seed:dev      # create test accounts → .dev-users.json (gitignored)
npm run dev           # http://localhost:4322
```

Emails (sign-in links, password resets) are caught by the local inbox at http://127.0.0.1:54324.

## Checks

```bash
npm run test:rls   # signs in as each test account and checks what it can read and write
npm run build
```

## How access works

- **Sign-in**: email and password, or an emailed sign-in link. Password reset by email. Passwords need 12+ characters with upper- and lower-case letters and a number.
- **Two-step verification (TOTP)**: optional for investors, **required for admins**. Once someone has it, every new session must enter a code.
- **Admin access**: the `/admin` pages and admin rights in the database both require the `admin` role *and* a session that passed two-step verification (`aal2`).
- **Row-level security**: investors only read the holders linked to them (`holder_members`). Only admins can write. "Total on issue" comes from a database function, so investors never see other holders' rows.
- **Audit**: sign-ins, sign-outs, password and two-step changes go to `audit_log` through `log_event()`. Only admins can read it.
- **Sessions**: httpOnly cookies. Portal pages are sent with `Cache-Control: no-store` and anti-framing headers.
- **Bot protection**: set `TURNSTILE_SITE_KEY` (and enable captcha in Supabase Auth) to add Cloudflare Turnstile to the sign-in forms.

## Not done yet

- Hosting: the Node adapter is a placeholder until the Vercel or Cloudflare decision.
- A hosted Supabase project, and production email sending (SMTP or Resend).
- The dashboard is a first version. The full feature set is Phase 2; the admin tools are Phase 3.
