# Investor Portal: from Lakeba Group shareholders to all investors

Status: phases 1–4 and look-through built, 22 October 2026 (see portal/docs/multi-company.md). Decisions taken on 22 October 2026 (section 6). Nothing below is built yet.

## 1. The goal

Today the portal serves one company, Lakeba Group Limited. Every signed-in
shareholder sees the same group content, and holdings are Lakeba shares.

The next level: **one portal, many companies.** Anyone who holds shares in
Lakeba Group *or* in a venture signs in with one account (their email) and sees:

- **everything about the companies they hold shares in**, and
- **nothing about companies they don't**.

| Person | Sees |
|---|---|
| Group shareholder only | Lakeba Group, plus the group's portfolio view (what Lakeba owns in each venture, as the group reports it today), plus any venture document an admin has chosen to share with group shareholders |
| Group shareholder who also holds Ezifin shares | Lakeba Group + Ezifin (its documents, meetings, cap table position, prices) |
| Ezifin shareholder only | Ezifin, plus Lakeba's **public** News & Media (already on lakeba.com). No group documents, holdings, meetings or other ventures |
| Director of Bricklet | Bricklet board content; other companies only if they hold shares there |

## 2. The companies

| Company | Relationship | In the portal |
|---|---|---|
| Lakeba Group Limited | The group | Full portal (as today) |
| Ezifin, DoxAI, Bricklet, Shelfie | Controlled ventures: Lakeba majority, minority shareholders | **Full portal per venture**: their shareholders sign in and see that venture |
| Whitehawk, MIST, Assetora, Appreci, Zucoins, EziProp | Non-controlling investments | **Portfolio entries only**: shown to group shareholders as Lakeba's investments. Their own shareholders are not served (we don't run their registers) |

A non-controlled company can later be switched to "full portal" if Lakeba runs
its investor communications. It's one setting per company.

## 3. The key idea: everything belongs to a company

The data model already separates **people** (logins), **holders** (the legal
owner on a register: a person, company, trust or super fund) and **holdings**.
That stays. What changes is that we add a **company** (an "entity") as the
owner of share classes and content:

```
entity (Lakeba Group, Ezifin, …)
 ├─ share classes (LKB-ORD, LKB-F, EZF-ORD, …)
 │   └─ holdings  ← holder ← holder_members → person (login)
 ├─ documents, news posts, announcements
 ├─ meetings / AGMs, resolutions, proxy votes
 ├─ reference prices
 ├─ board (directors, per company)
 └─ Ask Lakeba knowledge base
```

**Who can see a company** is worked out from the register, never set by hand:
a person sees an entity if one of their holders holds shares in any of its
classes (latest holding > 0), or they are on that entity's board, or they are an
admin. This one rule (`can_see_entity(entity_id)` in the database) drives every
row-level security policy, so a mistake in a page can't leak another company's data.

**Lakeba Group Limited is itself a holder** in each venture's register, so each
venture's cap table adds up to 100%. It has no login.

**Look-through** (optional): a group shareholder's indirect interest in a
venture (their % of Lakeba × Lakeba's % of the venture) can be shown as
"indicative look-through", clearly labelled. It never grants access to the
venture's own documents.

## 4. What changes for each feature

| Feature | Change |
|---|---|
| Sign-in, MFA, invitations | No change. One account per email. Invitations name the company ("You've been invited to the Ezifin investor portal") |
| Navigation | A **company switcher** (shown only when someone has 2+ companies). The dashboard becomes **"My ownership"**: every company and holding in one view, then a section per company |
| Branding | Each company has its own name, logo and colour on its pages and emails; the portal frame stays Lakeba's ("Investor Portal, powered by Lakeba") |
| Holdings and statements | Per company and class; % uses that class's shares on issue. **Options** are shown to their holders (number, and exercise price/expiry when recorded) but don't count toward ownership %. Holding statements (PDF) per company |
| Documents | Each document belongs to one company (plus the existing audiences: all shareholders / board / one holder). A venture document can be ticked **"also share with Lakeba Group shareholders"** (e.g. Ezifin's annual report); otherwise it stays with that venture's shareholders |
| News, announcements | Per company. Lakeba's public News & Media is shown to everyone (it is public anyway); shareholder-only group posts and announcements stay with group shareholders |
| AGMs and proxy voting | Per company. Only that company's voting classes vote |
| Board Q&A | Routed to that company's board; the shareholder picks the company when they have several |
| Reference prices and value | Per class, so per company. Indicative values never mix currencies |
| Ask Lakeba | Answers only from the companies the person can see. Each company has its own knowledge base and house rules. Cost: one cached knowledge base per company (smaller than today's for a venture), so a venture-only shareholder costs less per question |
| Notifications and campaigns | "Notify shareholders" asks *which company*. The LinkedIn campaign gains a per-company page link |
| Admin | Every admin list gets a company filter. New: **company admins** who manage only their venture (e.g. the Ezifin CFO), with MFA as today. Group admins keep access to everything |
| Audit log | Records the company on every event |

## 5. Phases

**Phase 0: data check (now, with the Excel file).**
Fill in `private/Lakeba-investor-data-current.xlsx` (or the blank
`Lakeba-investor-data-template.xlsx`): companies, share classes, holders,
people, access, holdings for every company, boards and prices. Its *Checks* sheet
flags the obvious problems: classes that don't add up to shares on issue,
unknown holders or emails, duplicates. The pre-filled copy holds today's
portal data for Lakeba Group so it can be checked line by line.

**Phase 1: entities underneath (no visible change).**
*Done 22 October 2026* (migration `20261023010000_entities.sql`, test
`npm run test:entities`, 28 checks). As built:
- Access comes from any holding row in a company's classes, so former holders
  keep access while they stay linked. A login linked to a holder with no
  holdings sees nothing until a holding is recorded.
- Proxy-vote tallies now count only voting classes of the meeting's company,
  so F class shares no longer add weight.
- Ask Lakeba is limited to people who can see Lakeba Group, and uses group
  documents plus venture documents shared with the group.
- Still group-only until Phase 3: holding statements (Lakeba-branded), the
  secondary trading card, Board Q&A (asks the group board).

- Add `entities`.
- Give share classes, documents, posts, announcements, meetings, prices,
  ventures and Ask data an `entity_id`.
- Move everything existing to Lakeba Group.
- Add `can_see_entity()` and rewrite the access rules on top of it.
- Extend the RLS test suite with "venture-only shareholder can't see the group"
  and "group-only shareholder can't see Ezifin documents" checks.

Shareholders notice nothing.

**Phase 2: import the ventures.** *Built 22 October 2026 and tested on fake data; waiting for the filled-in workbook.* Admin → Import data, or `scripts/import-investors.mjs`.
- An importer reads the Excel file: dry run first, then a reconciliation
  report per company, then apply.
- Ezifin, DoxAI, Bricklet and Shelfie registers go in.
- Existing accounts are matched by email, so group shareholders who also hold
  venture shares simply gain a company.

**Phase 3: multi-company experience.** *Built 22 October 2026.*
- My ownership dashboard, company switcher and per-company pages.
- Branding, per-company statements, Board Q&A, AGMs, notifications.
- Ask Lakeba scoped by company.

**Phase 4: company admins and invitations.** *Built 22 October 2026* (welcome emails per company from Admin → Investors).
- Per-company admin role.
- Invitations for venture-only shareholders (sent per company, in batches,
  starting with a pilot of a few friendly shareholders).

**Phase 5 (optional):** *Look-through built 22 October 2026* (Portfolio page). Not built: transfer requests, multi-currency.
- Look-through ownership.
- Portfolio pages for non-controlled investments.
- Share transfers / register changes requested through the portal (approved by
  the company secretary).
- Multi-currency.

## 6. Decisions (22 October 2026)

| # | Question | Decision |
|---|---|---|
| 1 | What do venture-only shareholders see of Lakeba Group? | **Public group news only**: Lakeba's public News & Media. No group documents, holdings, meetings or shareholder-only posts |
| 2 | Do group shareholders see venture documents? | **Per document**: admins tick "also share with Lakeba Group shareholders" on individual venture documents. Default: not shared |
| 3 | Branding | **One portal, venture branding**: same web address. Each venture's pages and emails carry its name and logo, framed as "Investor Portal, powered by Lakeba" |
| 4 | Who administers ventures | **Lakeba team only, for now.** Per-venture admins (with MFA) come in Phase 4 |
| 5 | Non-controlled companies | **Portfolio entries only.** Any of them can be switched to full portal later with one setting |
| 6 | Securities other than ordinary shares | **Options** exist. They get their own class per venture (type "Options", "Counts toward %" = No), are shown to holders, and are left out of ownership percentages. A fully diluted view can be added later |

What this changes in the build:
- The access rule adds two exceptions: public group news is visible to every
  signed-in investor, and a venture document marked "share with group" is visible
  to group shareholders.
- Documents get a `shared_with_group` flag; the RLS tests cover both directions.
- Share classes get `counts_toward_pct`, plus optional `exercise_price` and
  `expires_on` per option holding.
- The Excel file already supports options: add a class such as `EZF-OPT`, type
  Options, Counts toward % = No. Put each holder’s number of options on the
  Holdings sheet, and the exercise price and expiry in its Notes column for now.

## 7. Data check notes from today's portal

- 80 holders, 64 people with logins, 81 access links, 80 holdings; classes ORD and F.
- **Official shares on issue are not recorded** for ORD or F, so percentages
  use the sum of holdings in the portal. Please add them in the Excel file.
- The **Member Register** and **Debenture Register** were published to all
  shareholders. **Fixed on 22 October 2026:** both are now board-only, and the
  importer gives register documents the board audience by default.
- Only two reference prices are recorded.
