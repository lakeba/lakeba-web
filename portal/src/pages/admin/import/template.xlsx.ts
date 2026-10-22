import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The blank investor data workbook (no data in it). */
export const GET: APIRoute = async () => {
  // The server runs from the portal folder (locally and in the release bundle).
  const file = await readFile(join(process.cwd(), 'templates', 'Lakeba-investor-data-template.xlsx'));
  return new Response(file, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="Lakeba-investor-data-template.xlsx"',
    },
  });
};
