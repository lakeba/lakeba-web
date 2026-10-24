// Interface languages. Texts are written in English in the pages and looked up
// in the catalogues in src/i18n/ (one file per area, each with es / it / zh),
// keyed by the English text itself. Anything missing falls back to English.
// Placeholders: {name}. Content people write (documents, news, answers) is not translated.

export const LOCALES = ['en', 'es', 'it', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];
export const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', es: 'Español', it: 'Italiano', zh: '中文（简体）' };
export const HTML_LANG: Record<Locale, string> = { en: 'en', es: 'es', it: 'it', zh: 'zh-Hans' };
/** Intl locale for dates and numbers (Australian conventions for English). */
export const INTL: Record<Locale, string> = { en: 'en-AU', es: 'es-ES', it: 'it-IT', zh: 'zh-CN' };

export type Catalogue = Partial<Record<Exclude<Locale, 'en'>, Record<string, string>>>;
const files = import.meta.glob<{ default: Catalogue }>('../i18n/*.ts', { eager: true });
const merged: Record<Exclude<Locale, 'en'>, Map<string, string>> = { es: new Map(), it: new Map(), zh: new Map() };
for (const file of Object.values(files)) {
  for (const [loc, entries] of Object.entries(file.default) as [Exclude<Locale, 'en'>, Record<string, string>][]) {
    for (const [k, v] of Object.entries(entries)) merged[loc].set(k, v);
  }
}

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);

export type Vars = Record<string, string | number>;
export type T = ((text: string, vars?: Vars) => string) & {
  locale: Locale;
  /** Singular or plural by count: t.n(n, '{n} share', '{n} shares'). */
  n: (count: number, one: string, other: string, vars?: Vars) => string;
  /** The same English word in a different sense: t.c('trade status', 'Open') looks up 'trade status|Open' first. */
  c: (context: string, text: string, vars?: Vars) => string;
};

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

export function translator(locale: Locale): T {
  const dict = locale === 'en' ? null : merged[locale];
  const t = ((text: string, vars?: Vars) => fill(dict?.get(text) ?? text, vars)) as T;
  t.locale = locale;
  t.n = (count, one, other, vars) => t(count === 1 ? one : other, { n: count, ...vars });
  t.c = (context, text, vars) => fill(dict?.get(`${context}|${text}`) ?? dict?.get(text) ?? text, vars);
  return t;
}

/** The first supported language in an Accept-Language header, if any. */
export function fromAcceptLanguage(header: string | null): Locale | null {
  for (const part of (header ?? '').split(',')) {
    const code = part.trim().split(';')[0].toLowerCase().split('-')[0];
    if (isLocale(code)) return code;
  }
  return null;
}

/** Strings a page's browser script needs, already translated (put in a data attribute as JSON). */
export const clientStrings = (t: T, texts: string[]) => JSON.stringify(Object.fromEntries(texts.map((s) => [s, t(s)])));
