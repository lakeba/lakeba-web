# Companies owned by companies: plan

Status: **built on staging** (30 October 2026), not committed or deployed; see “As built” at the end. Case: DoxAI Australia Pty Ltd (DOX) ran DoxAI's P&L
until 30 June 2026 (FY26). Since 1 July 2026 (FY27) DoxAI Operations Pty Ltd (DXO, ACN 696 297 211), 100% owned by
DoxAI Australia, runs it; DoxAI Australia is the holding company and the one DoxAI's investors hold.

## Decisions

- **Two companies in the portal.** DXO is its own company: controlled, *not in portal* (no investor side, like
  Lakeba Ventures), with its own legal record (ASIC extract read, directors), share register, Xero connection
  and reporting pack. DoxAI's investors still hold DOX; nothing changes for them.
- **Who owns whom comes from the share register.** A holder can *be* a company in the portal (`holders.
  represents_entity_id`, today used only for Lakeba's own stake). DoxAI Australia is a holder of DXO's 100 ORD
  shares and represents DOX. A company holding over 50% of another's shares that count toward % controls it.
  No separate "parent" field to keep in step.
- **A venture's group view.** A company and the companies it controls (at any depth) are added up, with what
  they report with each other removed (investment, loans, charges, management fees): DoxAI = DOX + DXO. FY26 is
  DOX alone, FY27 both, so year on year compares like with like. Lakeba's consolidation keeps every controlled
  company, now including DXO, with the same removals.
- **Lakeba's share through others.** Lakeba's effective stake in DXO = its stake in DOX × DOX's stake in DXO.
  Shown on the company page and used where the group stake is shown.
- **Back-office companies everywhere staff work:** a controlled company that's not in the portal is offered in
  Finance (schedules, packs, commissions), People (HR, performance) and Legal. Commissions of DoxAI from FY27 are
  DXO's (its Xero, its people); FY26 runs stay on DOX.
- **Who sees the venture group view:** Lakeba Finance (Accounting is Lakeba only) for now.

## Pieces

1. Holder page: "This holder is a company in the portal" (choose the company); register import keeps its
   meaning. Everything that reads `represents_entity_id` as "Lakeba's stake" checks it's the group's.
2. `src/lib/ownership.ts`: who controls whom from the register; effective Lakeba stake; the members of a
   company's group.
3. Finance → Consolidated: choose "Lakeba Group" or a venture's group (DoxAI); the same removals and pair-by-pair
   matching. Board summary: a venture with controlled companies shows its group figures, naming its companies.
4. Back-office companies in Finance, commissions, HR, performance; Xero can be connected for them.
5. Company page: "Owned by" and "Owns" lines with %, and Lakeba's share through them.
6. What's new, tours, docs.

## As built (30 October 2026, staging)

- **Holder page** (`admin/holders/[id].astro`): Details → “This holder is a company in the portal” (people who manage
  the whole register; not offered for individuals, nor for a company the holder holds shares in). Checked first,
  then saved and logged as `register_holder_updated` (so webhooks send `holder.updated`). A line under the name
  says which company it is. On staging, DoxAI Australia Pty Ltd (DXO-0001) represents DOX.
- **Lakeba's own stake** is now only a holder representing the *group* company: API `is_group_stake` checks the
  group, and holders gain `represents_company` (the code, or null). The investor data import keeps a holder's link
  when its reference isn't `…-GROUP` (before, a full import would have cleared it); a one-company import still
  leaves holders that are companies to Lakeba. The register import only ever links new “Lakeba …” holders to the
  group, as before. `lakeba_stakes()` (SQL, the portfolio) was already group-only and is unchanged.
- **`src/lib/ownership.ts`**: stakes between portal companies (latest balance per holder and class, classes that
  count toward %, official on issue where set, as `classesOf`), `controllerOf` (over 50%), `groupOf` (the members
  hold over half between them, any depth, loops can't recur), `ventureGroups()` and `lakeba(id)`: direct + through
  (owner's % × Lakeba's share of the owner; an owner without a register path uses its typed Lakeba stake). The typed
  `entities.lakeba_stake` is untouched and still what Board Ask states first; the computed share is shown next to it.
  Ownership is today's register, not as at the period.
- **Finance → Consolidated**: a Group choice (Lakeba Group, or each venture that controls another company, `?group=DOX`)
  with the same `consolidate()` and `matchPairs()` on the venture's companies that have a pack in the parent's
  currency; companies of the group without a schedule are listed under “Not consolidated”. The Excel export takes
  `group` too. Lakeba Group's view includes DXO (relationship *controlled*), as before.
- **Board summary** (PDF and Lakeba AI's draft input): `boardRows()` makes a venture with controlled companies one
  line with their figures added up and “DoxAI + DoxAI Operations, added up” under it; its companies have no line of
  their own. While only the parent reports (FY26), it's an ordinary line. The People block stays per company.
- **Intercompany names**: Xero account names are matched on display and legal names (longest first); checked:
  “Loan to DoxAI Operations” → DXO, “Loan from DoxAI Australia Pty Ltd” and “Loan - DoxAI” → DOX.
- **Back-office companies**: Commissions and Performance now list full-portal companies *and* group/controlled ones
  (DXO, LKV, LKS). HR, Legal, schedules and packs already listed every company. Xero can be connected on
  Companies → DXO → Integrations (nothing there depends on the portal access; integrations are on for DXO). The
  header company filter and investor-side lists still show full-portal companies only.
- **Company page**: an Ownership card (“Owned by”, “Owns” with % and classes, “controls it”, Lakeba's share with
  direct/through, the typed stake when it differs) and, for a venture with a group, a link to its consolidated view.
  Board Ask's company list also says who holds a company and Lakeba's share from the register.

Not done: a Finance role scoped to DXO alone can't be given yet (System → Users lists full-portal companies only);
Lakeba Finance covers it. The investor data workbook has no column for a holder's company link (it's kept, not
exported).
