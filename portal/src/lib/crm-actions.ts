import type { serviceClient } from './admin';
import { field } from './forms';
import { TASK_KINDS, logActivity, salesTeam, type CrmScope } from './crm';
import { notifyMembers } from './notify';

// Form actions shared by the CRM's deal, person and company pages: notes and tasks. Each page checks that the
// record belongs to the CRM's company before calling these.

type Svc = ReturnType<typeof serviceClient>;
export type Target = { deal_id?: string | null; person_id?: string | null; company_id?: string | null };

/** Handles a note or task form; returns a message for the page, or null when the intent isn't one of these. */
export async function commonAction(svc: Svc, locals: App.Locals, scope: CrmScope, form: FormData, target: Target, origin: string, link: string): Promise<string | null> {
  const intent = field(form, 'intent');
  const me = locals.user!.id;
  const entity = scope.current!;
  const audit = (action: string, detail: Record<string, unknown>) => locals.supabase.rpc('log_event', { event_action: action, event_detail: { entity_id: entity.id, ...target, ...detail } });
  if (intent === 'note') {
    const body = field(form, 'body');
    if (!body) throw new Error('Write the note first.');
    await logActivity(svc, { entity_id: entity.id, kind: 'note', body, ...target, created_by: me });
    await audit('crm_note_added', {});
    return 'Note added.';
  }
  if (intent === 'task') {
    const title = field(form, 'title');
    if (!title) throw new Error('Say what needs doing.');
    const due = /^\d{4}-\d{2}-\d{2}$/.test(field(form, 'due_on')) ? field(form, 'due_on') : null;
    const owner = field(form, 'owner_id') || me;
    if (owner !== me && !(await salesTeam(svc, entity.id)).some((p) => p.id === owner)) throw new Error('Choose someone from the sales team.');
    const { data: t } = await svc.from('crm_tasks').insert({
      entity_id: entity.id, title: title.slice(0, 300), kind: field(form, 'kind') in TASK_KINDS ? field(form, 'kind') : 'todo', due_on: due, owner_id: owner, ...target, created_by: me,
    }).select('id').single().throwOnError();
    await audit('crm_task_added', { task_id: t!.id });
    if (owner !== me) {
      await notifyMembers({ kind: 'crm', origin, link, title: 'A CRM task for you', body: `${title}${due ? ` · due ${due}` : ''}`, userIds: [owner] }).catch(() => 0);
    }
    return 'Task added.';
  }
  if (intent === 'task-done' || intent === 'task-undo') {
    const { data: t } = await svc.from('crm_tasks').select('id, owner_id, title, deal_id, person_id, company_id').eq('id', field(form, 'task_id')).eq('entity_id', entity.id).maybeSingle();
    if (!t) throw new Error('That task isn’t here any more.');
    if (!scope.canApprove && t.owner_id && t.owner_id !== me) throw new Error('Only its owner or a sales lead can tick it off.');
    const done = intent === 'task-done';
    await svc.from('crm_tasks').update({ done_at: done ? new Date().toISOString() : null, done_by: done ? me : null, suggested: false }).eq('id', t.id);
    if (done) await logActivity(svc, { entity_id: entity.id, kind: 'task', subject: `Done: ${t.title}`, deal_id: t.deal_id, person_id: t.person_id, company_id: t.company_id, created_by: me });
    return done ? 'Done.' : 'Opened again.';
  }
  return null;
}

/** Moves a deal to a stage (won and lost close it; lost needs a reason), logging it on the deal's timeline. */
export async function moveDeal(svc: Svc, locals: App.Locals, entityId: string, deal: { id: string; stage_id: string; status: string; title: string }, stage: { id: string; name: string; kind: 'open' | 'won' | 'lost'; pipeline_id: string }, reason = '') {
  if (stage.id === deal.stage_id) return;
  if (stage.kind === 'lost' && !reason.trim()) throw new Error('Say why it was lost: it helps the next deal.');
  const now = new Date().toISOString();
  const { data: from } = await svc.from('crm_stages').select('name').eq('id', deal.stage_id).maybeSingle();
  await svc.from('crm_deals').update({
    stage_id: stage.id, pipeline_id: stage.pipeline_id, status: stage.kind, stage_changed_at: now, updated_at: now,
    won_at: stage.kind === 'won' ? now : null, lost_at: stage.kind === 'lost' ? now : null, lost_reason: stage.kind === 'lost' ? reason.trim().slice(0, 500) : '',
  }).eq('id', deal.id).eq('entity_id', entityId).throwOnError();
  await logActivity(svc, { entity_id: entityId, kind: 'stage', deal_id: deal.id, subject: `${from?.name ?? 'Stage'} → ${stage.name}`, body: stage.kind === 'lost' ? `Lost: ${reason.trim()}` : '', created_by: locals.user!.id });
  await locals.supabase.rpc('log_event', { event_action: stage.kind === 'won' ? 'crm_deal_won' : stage.kind === 'lost' ? 'crm_deal_lost' : 'crm_deal_stage_changed', event_detail: { entity_id: entityId, deal_id: deal.id, stage: stage.name } });
}
