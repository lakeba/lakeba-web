import type { APIRoute } from 'astro';
import { readFile } from 'node:fs/promises';

/** The blank investor data workbook (no data in it). */
export const GET: APIRoute = async () => {
  const file = await readFile(new URL('../../../../templates/Lakeba-investor-data-template.xlsx', import.meta.url));
  return new Response(file, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="Lakeba-investor-data-template.xlsx"',
    },
  });
};
