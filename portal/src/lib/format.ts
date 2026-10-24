export const shares = new Intl.NumberFormat('en-AU');
export const percent = new Intl.NumberFormat('en-AU', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** For small shares such as look-through interests (three significant digits). */
export const smallPercent = new Intl.NumberFormat('en-AU', { style: 'percent', maximumSignificantDigits: 3 });
export const aud = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
export const audPrecise = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
export const longDate = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney' });
export const shortDate = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' });
export const dateTime = new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Australia/Sydney' });

export const fileSize = (bytes: number | null | undefined) =>
  bytes == null ? '' : bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${(bytes / 1e6).toFixed(1)} MB`;

export const categoryLabels: Record<string, string> = {
  report: 'Reports', agm: 'AGM', update: 'Shareholder updates', governance: 'Governance', register: 'Registers', video: 'Videos', other: 'Other',
};

export const holderKinds: Record<string, string> = { individual: 'Individual', company: 'Company', trust: 'Trust', super_fund: 'Super fund' };

/** The same formats in the reader's language (dates and numbers). */
const cache = new Map<string, ReturnType<typeof build>>();
const build = (tag: string) => ({
  shares: new Intl.NumberFormat(tag),
  percent: new Intl.NumberFormat(tag, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  smallPercent: new Intl.NumberFormat(tag, { style: 'percent', maximumSignificantDigits: 3 }),
  aud: new Intl.NumberFormat(tag, { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }),
  audPrecise: new Intl.NumberFormat(tag, { style: 'currency', currency: 'AUD', minimumFractionDigits: 2, maximumFractionDigits: 4 }),
  longDate: new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney' }),
  shortDate: new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' }),
  dateTime: new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Australia/Sydney' }),
});
export function formats(intlTag: string) {
  if (!cache.has(intlTag)) cache.set(intlTag, build(intlTag));
  return cache.get(intlTag)!;
}
