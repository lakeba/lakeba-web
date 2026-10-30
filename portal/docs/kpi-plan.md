# KPI management: plan

Status: **being built** (started 30 October 2026): phases 1–5 built on staging, not deployed. HR owns it; it lives
under Admin → People (commissions: Finance, under Admin → Finance).
Decisions taken: commission is earned when an **invoice is raised**; reviews use a **formal 1–5 rating
scale**; **HR enters results**, on Finance's indication; HubSpot attribution is **later**.

## Vision

Everyone knows what good looks like, sees how they're tracking, and is paid fairly for it. Company goals
break down into a few KPIs per person; results come in by hand first and from Xero (and later other
systems) next; managers run check-ins and reviews on real numbers; sales commissions are worked out,
explained and approved in the portal; the board sees a short summary per venture.

## Concepts

- **KPI definition** (library): name, what it measures, unit (`aud`, `percent`, `count`, `days`,
  `hours`, `score`), direction (higher or lower is better), how results add up over a period (`sum`,
  `average`, `last`), family (revenue, delivery, engineering, customer, compliance, other) and source
  (`manual`, or an automatic source, below). Group-wide definitions (no company) are offered to every
  company; a company can add its own.
- **Role set**: a named bundle of definitions with default weights ("Sales rep", "Developer", "Account
  manager"), to give someone sensible KPIs in one click.
- **Period**: a month, quarter or year per company, with a status: planning → open → closed.
- **Goal**: a company goal for a period, optionally broken into team goals (parent goal); a scorecard
  item can say which goal it serves.
- **Scorecard**: one person, one period. 3–6 **items**, each a definition with a target, a weight (the
  weights add up to 100), and two thresholds: *below* (under it is off track) and *stretch*.
- **Result**: a value for an item, dated, with a note and optional evidence. Finance (accounting.do) can
  **propose** a result; HR (hr.do) **confirms** it, and only confirmed results count. HR can also enter a
  result directly. Automatic sources write confirmed results and say where they came from.
- **Score**: per item, attainment = actual ÷ target (or target ÷ actual when lower is better), capped at
  150%; the scorecard score is the weighted average. It suggests a rating; it never sets it.
- **Check-in**: a dated comment on a scorecard (by HR, the manager or the person); HR and the manager can
  mark one private (HR's sealed notes approach).
- **Review** (end of period): the person's self-assessment, the manager's assessment, an agreed **rating
  1–5** (1 Below expectations · 2 Partly meets · 3 Meets · 4 Exceeds · 5 Outstanding), HR sign-off
  (hr.approve), then the person acknowledges it in My HR and may add a comment.

## Commissions (Finance)

- **Plan**: per company; basis **invoice raised** (Xero ACCREC invoices, AUTHORISED or PAID, by invoice
  date, amounts excluding GST); tiers as % of the rep's period target (e.g. 8% up to 100%, 12% above);
  optional cap; clawback when an invoice is later voided or credited.
- **Assignment**: which people are on a plan, their period target, from/to dates.
- **Attribution** (who sold to whom, which Xero can't hold): a Xero contact → a person, with a share
  (splits add up to 100%) and from/to dates, set by hand in the portal. HubSpot deal owners can feed it
  later.
- **Run**: per company and period: fetch the period's invoices from Xero (or upload a CSV of invoices
  when Xero isn't connected), credit them to reps by attribution, work out commission per rep by tier,
  list unattributed invoices to fix, Finance approves (accounting.approve), then it's marked paid.
  Lines keep the invoice number, contact, date, amount, share, rate and commission.
- **Statements**: each rep sees their approved runs in My HR → Commissions, line by line.
- **Link to KPIs**: a definition with source `sales_attributed` takes its result from the latest run
  (revenue credited to that person in the period).

As built (phase 3, migration `20261227000000_commissions.sql`, `src/lib/commissions.ts`):

- **Targets** are per run period (a quarterly run needs a quarter's target); not pro-rated. One plan at a time
  per person (overlapping assignments are refused).
- **Tiers** are marginal: the part of credited revenue up to the first tier's % of target earns its rate, the
  part above the next rate, and so on; a line that crosses a tier gets a blended rate, so lines add up to the
  rep's total. The **cap** (per rep per run) scales the rep's earned lines down to it; clawbacks aren't capped.
- **Attribution** is saved as a split from a date (to a date, or open); it replaces what the client had for
  those days. Invoices match by Xero contact id, or by name (CSV invoices, typed clients). A run of one plan
  credits only people on that plan; an all-plans run also lists people on no plan (no commission).
- **Runs** can't overlap for the same plan(s). Building stores the invoices it read, so "Build again" and
  "Assign" (an unattributed invoice → a person from the run's period on) rebuild without calling Xero again;
  "Fetch from Xero and build" reads it again. Xero amounts are SubTotal net of credit notes allocated
  (AmountCredited × SubTotal ÷ Total), converted at the invoice's rate when in another currency.
- **Clawback**: an invoice in an earlier approved or paid run that is now VOIDED/DELETED (or, from Xero, credited)
  gives a negative line in the next run: the commission paid × the part gone, less what earlier runs already
  took back. CSV runs: a row with status VOIDED names an earlier invoice by number; CSV credit notes aren't read.
- **Approval** (four eyes, like Approvals): built → "Send for approval" (Finance approvers are told, kind
  `reporting`) → approved by someone with Finance "approve" who didn't build or send it → marked paid. Building
  again takes a run back from approval. Reps with a portal account are told (kind `my_hr`).
- **KPIs**: on approval, each rep with an active or in-review scorecard whose period overlaps the run gets a
  confirmed result on items whose KPI has source `sales_attributed`: the revenue credited in the run (earned
  lines, not clawbacks), dated the run's last day clamped into the scorecard's period, one per run (source_ref =
  run id). Seeded group-wide KPI: "Sales credited (A$)".

## Automatic sources

Phase 1 sources (no new accounts needed): `sales_attributed` (above), `policies_accepted` (% of the
person's required policies accepted, from HR) and `onboarding_done` (% of their checklist done). Later,
as connectors: HubSpot (deals by owner), GitHub/GitLab (pull requests merged, cycle time), Jira/Linear
(roadmap items done), the help desk. A daily job refreshes automatic results; each shows "updated
<date> from <source>". Engineering: we track delivery (roadmap items shipped vs committed, cycle time,
incidents); lines of code may be shown as activity, never scored.

As built (phase 4, migration `20261228000000_kpi_automation.sql`, `src/lib/kpi-sources.ts`, `src/lib/kpis.ts`):

- **Registry**: `AUTO_SOURCES` in `kpi-sources.ts` is one map of source key → label, short name ("from HR
  policies"), the library hint and a daily loader (or none, when the source writes its own results, like
  `sales_attributed`). A connector is one more entry with its loader: `(svc, people) → person id → value`.
- **`policies_accepted`**: published policies that need accepting, for the person's company and the group, of
  which they've accepted the current version (`policy_acks`), as %. **`onboarding_done`**: done ÷ all of their
  `person_tasks` of kind onboarding, as %. Nothing to measure (no such policies, no checklist): no result, and
  an earlier automatic one is removed. The library sets these sources to % and Latest when chosen.
- **Seeded**: "Policies accepted" (…0108) switched to `policies_accepted` (only if it was still manual); a new
  group-wide "Onboarding done" (…0110).
- **Daily refresh** (`kpiJobs`, in the notification worker, claim `kpi_refresh:YYYY-MM-DD`, from 7am Sydney):
  every active or in-review scorecard in an open period gets one confirmed result per daily-source item, dated
  today clamped into the period, `source_ref = 'auto'`. It replaces the item's previous automatic result (a
  unique index keeps one per item and source), so it never piles up whatever the aggregation. "Refresh now"
  on the Performance page (hr.do) does the same for one company, without alerts. A run that changed something
  leaves one `kpi_daily_refresh` row in the audit log.
- **"Updated <date> from <source>"**: on every automatic result (the result lists on the admin scorecard, My
  performance and My team, and under the actual in the KPI table), from the result's `confirmed_at`.
- **Off-track alerts** (same morning job, after the refresh): active scorecards in open periods, people not
  left; items whose state is Off track (`trackOf`) and whose `off_track_alerted_at` is empty or over 14 days
  old. One message per scorecard listing those items (actual against target): to `hrTeam` (kind `hr`, link to
  the scorecard) and to the person's manager when they have a portal account and aren't already in the HR list
  (kind `my_hr`, link to My team). The items' `off_track_alerted_at` is then set, so each repeats at most every
  14 days while it stays off track. With nobody to tell (no HR people, no manager with an account) nothing is
  set, so it's told once someone is.

## Insight (phase 5), as built

- **`/admin/hr/performance/insights`** (HR, hr.view, per company; "Insights" on the Performance page): for a
  company and period, scorecards that aren't drafts: coverage (scorecards against current people, drafts
  besides), average score and agreed rating, off-track count; how scores spread over the rating bands; agreed
  ratings 1–5; by team and by manager (calibration: each manager's average agreed rating against the company's,
  half a point or more flagged, with counts); the off-track list (person, KPI, actual, target); and the trend
  over the company's last six periods (average score bar, average agreed rating). Plain HTML bars.
- **Board summary** (Finance → Board summary): a People block per company for its latest open or closed period
  started by the board month: people with scorecards, average score, agreed ratings as counts, and commission in
  approved or paid runs for periods ending in that month's quarter. Counts only; not in the PDF.
- **Overview → To do**: reviews in review waiting for sign-off (hr.approve) and results Finance proposed for HR
  to confirm (hr.do), for the companies in view.

## Who sees what

- Admin → People → Performance: HR (hr.view / hr.do / hr.approve), per company, ventures walled.
- Admin → Finance → Commissions: Finance (accounting.view / do / approve).
- My HR → My performance: the person's own scorecards, results, check-ins (not private ones), reviews
  (acknowledge, comment). My HR → My team: a manager's reports (everyone below them in the org chart):
  scorecards, check-ins, the manager's review part. My HR → My commissions: approved statements.
- Everything is in the audit log; performance records are employee records (keep them like HR documents).

## Pages

- `/admin/hr/performance`: the period's scorecards: person, score, suggested and agreed rating,
  status; create a period; give scorecards from role sets.
- `/admin/hr/performance/library`: KPI definitions and role sets.
- `/admin/hr/performance/goals`: goals by company and period, with team goals under them.
- `/admin/hr/performance/[id]`: a scorecard: items, targets and weights, results (enter, confirm
  proposals), score, check-ins, review and sign-off.
- `/admin/accounting/commissions`: plans, assignments, attribution, runs.
- `/admin/accounting/commissions/[id]`: a run: lines by rep, unattributed invoices, approve, mark paid.
- `/my-hr/performance`, `/my-hr/team`, `/my-hr/commissions`.
- Dashboards (phase 5): `/admin/hr/performance/insights`: trends against target, ratings by manager
  (calibration), off-track list; a people line in the board summary.

## Phases

1. **Foundations**: library and role sets, periods, goals, scorecards, results (HR, Finance proposals),
   scores, check-ins, My HR "My performance" and "My team".
2. **Reviews**: self and manager assessment, 1–5 rating, HR sign-off, acknowledgement, history.
3. **Commissions**: plans, assignments, attribution, Xero invoice runs (and CSV), approval, statements,
   the `sales_attributed` source. *Built 30 October 2026 (staging).*
4. **Automation**: the daily refresh, `policies_accepted` and `onboarding_done`, off-track alerts
   (notifications), "updated from" on every automatic result. Connectors (HubSpot, GitHub, Jira) later.
   *Built 30 October 2026 (staging).*
5. **Insight**: dashboards, calibration, board summary line. *Built 30 October 2026 (staging).*
