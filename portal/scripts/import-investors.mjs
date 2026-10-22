// Imports the investor data workbook from the command line.
//
//   node --env-file=.env scripts/import-investors.mjs <file.xlsx>           dry run + report
//   node --env-file=.env scripts/import-investors.mjs <file.xlsx> --apply   write changes
//
// Writes a reconciliation report next to the file (<file>.import-report.md).
// The same import runs in the portal at Admin → Import data.
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { runImport } from '../src/lib/investor-import.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const apply = args.includes('--apply');
if (!file) { console.error('Usage: import-investors.mjs <file.xlsx> [--apply]'); process.exit(2); }
const url = process.env.SUPABASE_URL ?? '';
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url) && !args.includes('--allow-remote')) {
  console.error('Refusing to import into a non-local Supabase without --allow-remote.'); process.exit(2);
}
const svc = createClient(url, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const { lines, problems } = await runImport({ data: readFileSync(file), name: file.split('/').pop(), svc, apply, target: url });
const reportPath = `${file.replace(/\.xlsx$/i, '')}.import-report.md`;
writeFileSync(reportPath, lines.join('\n') + '\n', { mode: 0o600 });
console.log(lines.slice(0, 40).join('\n'));
console.log(`\nFull report: ${reportPath}`);
process.exitCode = problems.length ? 1 : 0;
