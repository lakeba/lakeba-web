import type { BsLine, Figures, PlLine } from './reporting';

// Xero's profit and loss and balance sheet reports, mapped to the reporting
// packs' standard lines (Accounting, phase 2). Xero groups accounts in
// sections ("Income", "Less Cost of Sales", "Less Operating Expenses", "Bank",
// "Current Liabilities"…); each account's line is placed by its section and,
// inside operating expenses and liabilities, by its name.

export type XeroCell = { Value?: string; Attributes?: { Id: string; Value: string }[] };
export type XeroRow = { RowType: string; Title?: string; Cells?: XeroCell[]; Rows?: XeroRow[] };

const amount = (c?: XeroCell) => { const v = Number(String(c?.Value ?? '').replace(/,/g, '')); return Number.isFinite(v) ? v : 0; };

/** Every account line with the titles of the sections it sits in. */
function lines(rows: XeroRow[], titles: string[] = []): { name: string; value: number; titles: string[] }[] {
  return (rows ?? []).flatMap((r) => {
    if (r.RowType === 'Section') return lines(r.Rows ?? [], r.Title ? [...titles, r.Title] : titles);
    if (r.RowType === 'Row' && r.Cells?.length) return [{ name: String(r.Cells[0].Value ?? ''), value: amount(r.Cells[1]), titles }];
    return [];
  });
}

const EMPLOYEE = /wage|salar|super(annuation)?\b|payroll|staff|employ|workcover|annual leave|long service|bonus|contractor/i;
const DEPRECIATION = /depreciat|amorti[sz]/i;
const INTEREST = /interest/i;
const TAX = /income tax|tax expense/i;

/** A profit and loss report as the standard P&L lines (one column). */
export function plFromXero(rows: XeroRow[]) {
  const out: Partial<Record<PlLine, number>> = {};
  const add = (k: PlLine, v: number) => { out[k] = Math.round((out[k] ?? 0) + v); };
  let netProfit: number | null = null;
  for (const l of lines(rows)) {
    const t = l.titles.join(' / ').toLowerCase();
    if (/net profit|net loss/i.test(l.name) && !l.titles.length) { netProfit = l.value; continue; }
    if (/gross profit/i.test(l.name) && !l.titles.length) continue;
    if (/other income/.test(t)) add('other_income', l.value);
    else if (/income|revenue|sales/.test(t) && !/cost of sales/.test(t)) add('revenue', l.value);
    else if (/cost of sales|direct cost/.test(t)) add('cost_of_sales', l.value);
    else if (/expense|overhead/.test(t)) {
      if (TAX.test(l.name)) add('income_tax', l.value);
      else if (DEPRECIATION.test(l.name)) add('depreciation', l.value);
      else if (INTEREST.test(l.name) && !/income|received/i.test(l.name)) add('interest', l.value);
      else if (EMPLOYEE.test(l.name)) add('employee_costs', l.value);
      else add('other_expenses', l.value);
    } else if (/tax/.test(t)) add('income_tax', l.value);
  }
  if (netProfit != null) out.net_profit = Math.round(netProfit);
  return out;
}

const RECEIVABLE = /receivable|debtor/i;
const PAYABLE = /payable|creditor|accru/i;
const BORROWING = /loan|borrow|convertible|note|overdraft|credit card|finance lease|hire purchase/i;
const PROVISION = /provision|deferred|leave|make good|employee benefit/i;

/** A balance sheet report as the standard balance sheet lines. */
export function bsFromXero(rows: XeroRow[]) {
  const out: Partial<Record<BsLine, number>> = {};
  const add = (k: BsLine, v: number) => { out[k] = Math.round((out[k] ?? 0) + v); };
  for (const l of lines(rows)) {
    const t = l.titles.join(' / ').toLowerCase();
    if (/^total|net assets/i.test(l.name)) continue;
    if (/equity/.test(t)) add('equity', l.value);
    // A liability account in credit the other way (e.g. a loan the other party owes us) is an asset.
    else if (/liabilit/.test(t) && l.value < 0) add('other_current_assets', -l.value);
    else if (/liabilit/.test(t)) {
      // Long-term liabilities are mostly loans (often from shareholders or group companies), unless they are provisions.
      const longTerm = /non-current|non current|long term/.test(t);
      if (BORROWING.test(l.name) || (longTerm && !PROVISION.test(l.name))) add('borrowings', l.value);
      else if (/current liabilit/.test(t) && !/non-current/.test(t) && PAYABLE.test(l.name)) add('payables', l.value);
      else add('other_liabilities', l.value);
    } else if (/bank/.test(t)) add('cash', l.value);
    else if (/fixed asset|non-current asset|non current asset/.test(t)) add('non_current_assets', l.value);
    else if (/asset/.test(t)) {
      if (RECEIVABLE.test(l.name)) add('receivables', l.value);
      else if (/cash|bank/i.test(l.name)) add('cash', l.value);
      else add('other_current_assets', l.value);
    }
  }
  return out;
}

/** The pack's figures from the period's and the year to date's P&L reports and the period-end balance sheet. */
export function figuresFromXero(period: XeroRow[], ytd: XeroRow[] | null, balance: XeroRow[]): Figures {
  const p = plFromXero(period), y = ytd ? plFromXero(ytd) : {};
  const keys = [...new Set([...Object.keys(p), ...Object.keys(y)])] as PlLine[];
  return {
    pl: Object.fromEntries(keys.map((k) => [k, { period: p[k] ?? null, ytd: ytd ? (y[k] ?? null) : null }])),
    bs: bsFromXero(balance),
  };
}

const bare = (n: string) => n.toLowerCase().replace(/\s+(pty\.?\s+)?(ltd|limited)\.?$/, '').trim();

/**
 * Balance sheet lines named after a group company (e.g. a loan account
 * "Lakeba Ventures"): which company (the longest name that matches), and
 * whether the company owes it (a liability) or is owed (an asset).
 */
export function groupLines(rows: XeroRow[], companies: { id: string; names: string[] }[]) {
  const named = companies.flatMap((c) => c.names.map((n) => ({ id: c.id, n: bare(n) }))).filter((x) => x.n.length >= 4).sort((a, b) => b.n.length - a.n.length);
  return lines(rows).flatMap((l) => {
    const hit = named.find((x) => l.name.toLowerCase().includes(x.n));
    if (!hit && !/lakeba/i.test(l.name)) return [];
    const t = l.titles.join(' / ').toLowerCase();
    // A negative liability is money owed to us (and a negative asset, money we owe).
    const base = /liabilit/.test(t) ? 'payable' : /asset|bank/.test(t) ? 'receivable' : null;
    const side = base && l.value < 0 ? (base === 'payable' ? 'receivable' : 'payable') : base;
    return [{ name: l.name, value: Math.abs(Math.round(l.value)), entity_id: hit?.id ?? null, side: side as 'payable' | 'receivable' | null }];
  });
}
