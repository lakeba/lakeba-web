import { extractText, getDocumentProxy } from 'unpdf';

export type Chunk = { page: number; content: string };

/** Splits a PDF's text into ~1,200-character passages, keeping page numbers for citations. */
export async function pdfChunks(bytes: Uint8Array, size = 1200): Promise<Chunk[]> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return pageChunks(text, size);
}

/** The same passages from text already split into pages (page 1 first). */
export function pageChunks(text: string[], size = 1200): Chunk[] {
  const chunks: Chunk[] = [];
  text.forEach((pageText, i) => {
    const clean = pageText.replace(/\s+/g, ' ').trim();
    for (let start = 0; start < clean.length; start += size) {
      // Prefer to break at a sentence end so passages read naturally.
      let end = Math.min(clean.length, start + size);
      const stop = clean.lastIndexOf('. ', end);
      if (end < clean.length && stop > start + size / 2) end = stop + 1;
      chunks.push({ page: i + 1, content: clean.slice(start, end).trim() });
      start = end - size;
    }
  });
  return chunks.filter((c) => c.content.length > 20);
}
