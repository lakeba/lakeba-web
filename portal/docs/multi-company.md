# Multi-company portal: operations guide

The portal serves Lakeba Group and each controlled venture (Ezifin, DoxAI,
Bricklet, Shelfie). One account per email; what a person sees follows from
the register (holdings), company boards and company admins.

## Loading investor data

1. Fill in the investor data workbook (Admin → Import data → *Download the
   blank template*, or the pre-filled copy kept outside the repository).
2. Admin → Import data → upload → **Check**. The report lists problems to fix,
   what is new or changed, and how each class adds up against its official
   number on issue. Nothing changes at this step.
3. **Apply import**. Nothing is ever deleted; rows only in the portal are
   listed for review. Accounts are created without sending email, and nobody is
   made an admin from the file.

The same import runs from the command line, which also writes the report
next to the file:

```
node --env-file=.env scripts/import-investors.mjs <file.xlsx>           # dry run
node --env-file=.env scripts/import-investors.mjs <file.xlsx> --apply
```

Holder ID `LKB-GROUP` is Lakeba Group Limited itself (it holds the ventures);
its holdings give Lakeba's stake in each venture for look-through.

## Inviting shareholders

Admin → Investors → pick a company → **Welcome <company> shareholders** lists
people with a holding there who have never signed in. Up to 50 per send; each
gets an email in that company's name with a set-password link. Start with a
few friendly shareholders.

The link lasts 1 hour (Supabase `auth.email.otp_expiry`, also used for password
resets). People whose link expired use "Forgot password" on the sign-in page.

## Company admins

Add them on the workbook's Boards sheet (position *Company admin*) or in the
`entity_admins` table. They must set up two-step sign-in, and can then:
documents, news and announcements, meetings, Board Q&A, reference prices,
official shares on issue, Ask review and Ask knowledge, and welcome emails, all
for their company only. They can read their company's register but not change
it; register changes, roles, imports, Ask tests, limits and the audit log stay
with group admins.

## Ask

Each company has its own assistant (Ask Lakeba, Ask Ezifin, …) built from its
own documents, news about it, a facts sheet and its approved answers, with its
own house rules (Admin → Ask knowledge, one company at a time). Usage limits and
the daily budget are portal-wide.

## Demo stack (fake data)

A second local Supabase with fictional investors for every company, for
development and demos. It never has a Claude key, so Ask makes no paid calls.

```
npm run demo:db      # start it (ports 553xx)
npx supabase db reset --workdir demo-db && npm run seed:demo
npm run dev:demo     # http://localhost:4324 ; personas and passwords in .demo-users.json
```

## Tests

`npm run test:entities` checks that companies stay separate (venture-only,
group-only and both; venture directors; company admins with and without
two-step). It creates and removes its own test rows, so it is safe on real data.
