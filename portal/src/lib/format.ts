export const shares = new Intl.NumberFormat('en-AU');
export const percent = new Intl.NumberFormat('en-AU', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
