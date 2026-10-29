// "Heard as" corrections for speech to text (the Observer, Lex): a company's "Words to listen for" may say
// how a name tends to be misheard, as "Lakeba = Kiwa, La Kiva, Makiva". The services are asked to listen for
// "Lakeba", and where they still write "Kiwa" or "La Kiva" the portal writes "Lakeba": in the live text, in
// what Lex is asked and in the full transcript. Used on the server and in the browser.

export type Correction = [heard: string, meant: string];

/** The word to listen for: the part before "=". */
export const termOf = (t: string) => t.split('=')[0].trim();

/** The corrections in a list of words to listen for. */
export function correctionsOf(terms: string[]): Correction[] {
  return terms.filter((t) => t.includes('=')).flatMap((t) => {
    const meant = termOf(t);
    return t.slice(t.indexOf('=') + 1).split(',').map((h) => h.trim()).filter((h) => meant && h.length >= 2 && h.toLowerCase() !== meant.toLowerCase())
      .map((h): Correction => [h, meant]);
  });
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text as meant: each misheard form, as a whole word or phrase, whatever its case. Longer forms first. */
export function correct(text: string, corrections: Correction[]) {
  let out = text;
  for (const [heard, meant] of [...corrections].sort((a, b) => b[0].length - a[0].length)) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(heard)}(?![\\p{L}\\p{N}])`, 'giu'), meant);
  }
  return out;
}
