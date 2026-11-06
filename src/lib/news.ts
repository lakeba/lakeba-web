import { getCollection, type CollectionEntry } from 'astro:content';

export type NewsEntry = CollectionEntry<'news'>;

/** All news, newest first. */
export const allNews = async () => (await getCollection('news')).sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

export const newsDate = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Sydney' });

const accents: Record<string, string> = {
  'Lakeba Group': 'bg-lk-blue/15 text-lk-blue',
  Bricklet: 'bg-lk-orange/15 text-lk-orange',
  DoxAI: 'bg-lk-green/15 text-lk-green',
  Ezidox: 'bg-lk-green/15 text-lk-green',
  Verimoto: 'bg-lk-red/15 text-lk-red',
  Shelfie: 'bg-lk-red/15 text-lk-red',
};
export const ventureClass = (v: string) => accents[v] ?? 'bg-white/10 text-white/70';
