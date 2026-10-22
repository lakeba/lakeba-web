/** Outbound links the portal tracks through /go/<key>. Only these can be redirected to. */
export const TRACKED_LINKS: Record<string, string> = {
  linkedin: 'https://www.linkedin.com/company/lakeba-group',
};

/** Where a tracked link was clicked from. Anything else is recorded as 'other'. */
export const LINK_SOURCES = ['card', 'banner', 'notification', 'email', 'footer', 'news', 'ask'] as const;
export const sourceNames: Record<string, string> = {
  card: 'Dashboard card', banner: 'Announcement banner', notification: 'Inbox notification', email: 'Email',
  footer: 'Footer', news: 'News page', ask: 'Ask Lakeba', other: 'Other',
};

export const trackedHref = (key: string, src: (typeof LINK_SOURCES)[number]) => `/go/${key}?src=${src}`;
