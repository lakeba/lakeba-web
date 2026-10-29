import type { APIRoute } from 'astro';
import { serviceClient } from '../../../../../lib/admin';
import { mayMeeting } from '../../../../../lib/boardroom';
import { PAPER_COLUMNS, POSITION_WORD, currentOfficers, reference, type Paper } from '../../../../../lib/legal-board';
import { paperPdf } from '../../../../../lib/legal-pdf';
import { madeUnder } from '../../../../../lib/legal-templates';

/** A draft's PDF as it would be sent (nothing stored), for whoever sees the company's legal records. */
export const GET: APIRoute = async ({ params, locals }) => {
  const svc = serviceClient();
  const { data } = await svc.from('board_papers').select(PAPER_COLUMNS).eq('id', params.id ?? '').maybeSingle();
  const paper = data as Paper | null;
  if (!paper || !(paper.kind === 'minutes' ? mayMeeting(locals.access, paper.entity_id) : locals.access.can('legal.view', paper.entity_id))) return new Response('Not found', { status: 404 });
  const [{ data: ent }, { data: rec }, officers, { data: meeting }] = await Promise.all([
    svc.from('entities').select('display_name, legal_name').eq('id', paper.entity_id).single(),
    svc.from('company_records').select('acn').eq('entity_id', paper.entity_id).maybeSingle(),
    currentOfficers(svc, paper.entity_id),
    paper.meeting_id ? svc.from('board_meetings').select('chair_officer_id').eq('id', paper.meeting_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const directors = officers.filter((o) => o.position === 'director');
  const signers = paper.kind === 'minutes' ? officers.filter((o) => o.id === meeting?.chair_officer_id) : directors;
  const pdf = await paperPdf({
    company: (ent?.legal_name as string | null) ?? (ent?.display_name as string), acn: rec?.acn ?? null, kind: paper.kind, title: paper.title, body: paper.body,
    reference: `${reference(paper)} · draft`, madeUnder: paper.kind === 'minutes' ? 'Minutes of a meeting of the directors' : madeUnder(directors.length),
    signers: signers.map((s) => ({ name: s.full_name, position: POSITION_WORD[s.position] ?? s.position })),
  });
  return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="draft.pdf"' } });
};
