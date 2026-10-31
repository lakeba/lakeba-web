# Staff guides

One guide per department, offered as **Guide (PDF)** at the end of that department's admin menu
(`/admin/guides/<key>.pdf`, `src/lib/guides.ts`). Each guide walks through the real pages with annotated
screenshots: what to fill in, and why it matters.

| Guide | Text | Menu section | Who can download it |
|---|---|---|---|
| HR | `hr.md` | People | HR "see" for any company |
| Finance | `finance.md` | Finance | Accounting "see" for the group, or Reporting packs |
| Legal | `legal.md` | Legal | Legal "see" for the group |
| Compliance and admin | `compliance.md` | Settings | Audit log or Users "see" for the group |
| Marketing and press | `marketing.md` | Communications | News, Press or Newsletters "see" |
| Sales (the CRM) | `sales.md` | Sales, and the CRM's own menu | CRM or CRM marketing "see" for any company |

**Keep them up to date** (AGENTS.md, item 9): when a change adds, moves or removes something a guide shows
or describes, update its text and, if the page looks different, its pictures, then rebuild the PDFs.
`npm run check:portal` warns when a guide's pages (`covers` in `src/lib/guides.ts`) changed after the guide,
and when a guide changed after its PDF.

## Changing the text

Edit `docs/guides/<key>.md`, then:

```
npm run guides:pdf
```

This writes `templates/guides/<key>.pdf` (shipped with each release) using headless Edge or Chrome
(`GUIDES_BROWSER=/path/to/browser` if Edge isn't in Applications). Commit the text and the PDF together.

## Re-taking screenshots

Screens are taken on the **staging copy on this Mac** with clearly fake data, never real people's data:

1. Seed the department's sample data. It adds a company "Sample Co" (code `SMPL`; names end in "(sample)",
   emails in `@sample.example.invalid`) and a temporary group Admin account, and saves the ids it made:
   `node --env-file=.env scripts/guides/seed-<guide>.mjs` (hr, finance, legal, compliance, marketing).
2. Take the screens: `node scripts/guides/shoot.mjs scripts/guides/shots-<guide>.json [one-shot-name]`.
   Each shot in the list gives the page (`{{name}}` takes an id the seed saved), what to crop to, the
   numbered markers (`marks`: a CSS selector, optionally `|text=…`, the number, `dot` for a marker beside a
   label), and `keep` to hide rows that aren't sample data.
3. **Remove the sample data straight away:** `node --env-file=.env scripts/guides/seed-<guide>.mjs --remove`.
   Deadlines due soon would otherwise send real reminder emails, and staging must stay free of test data.
4. Check the pictures in `docs/guides/img/`, update the numbered notes in the text if markers moved, and
   rebuild the PDFs.

The Sales guide's screens (`shots-sales.json`) were taken on the CRM branch's own copy of staging, with records
named "(CRM test)" and `@test.example.invalid` addresses; `ids.json` (not committed) gives the deal, quote, deal-room
token and form they show.

The seeds refuse to run against anything but the local staging database. They never press buttons that send
email, call paid AI or touch Xero; opening pages only.
