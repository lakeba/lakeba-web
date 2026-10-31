import type { serviceClient } from './admin';
import { addPipeline, pipelines, TEMPLATES } from './crm';
import type { Step } from './crm-marketing';

// Playbooks (CRM → Settings → Start from a playbook): a venture new to selling gets a working process on day one,
// its pipelines with what must be true to move on, starter email sequences and an ideal customer for lead
// scores. Everything can be changed afterwards.

type Svc = ReturnType<typeof serviceClient>;
export const PLAYBOOK_SEQUENCES: Record<string, { name: string; steps: Step[] }> = {
  after_demo: { name: 'After a demo', steps: [
    { day: 0, subject: 'Thanks for your time today, {first_name}', body: 'Hi {first_name},\n\nThank you for the time today. As promised, here is a short summary of what we saw and what we agreed as next steps.\n\n[What they want to achieve, in their words]\n[Next step and date]\n\nAnything I missed, just reply.\n\n{sender}' },
    { day: 4, subject: 'A question from the demo', body: 'Hi {first_name},\n\nA question that often comes up after a demo: who else at {company} should see this before you decide? I’m happy to run a short session for them.\n\n{sender}' },
    { day: 10, subject: 'Shall we set the next step?', body: 'Hi {first_name},\n\nI don’t want this to slip. Would 20 minutes next week suit you to agree the next step?\n\n{sender}' },
  ] },
  webinar: { name: 'After the webinar', steps: [
    { day: 0, subject: 'The recording, {first_name}', body: 'Hi {first_name},\n\nThanks for joining. Here is the recording and the slides: [link].\n\nIf you’d like to see how it would work at {company}, reply and I’ll set up a short call.\n\n{sender}' },
    { day: 3, subject: 'How others in your industry use it', body: 'Hi {first_name},\n\nA short case study from a company like {company}: [link]. The part most people ask about is [the result].\n\n{sender}' },
    { day: 7, subject: '15 minutes?', body: 'Hi {first_name},\n\nWould 15 minutes this week be useful to see if it fits {company}? Reply with a time that suits.\n\n{sender}' },
  ] },
  enquiry: { name: 'New enquiry (students)', steps: [
    { day: 0, subject: 'Thanks for your enquiry, {first_name}', body: 'Hi {first_name},\n\nThanks for your interest. Here is what happens next and the dates for the coming intake: [details].\n\nReply with any question; I’m here to help.\n\n{sender}' },
    { day: 5, subject: 'Your application', body: 'Hi {first_name},\n\nApplications for the next intake close on [date]. It takes about 15 minutes: [link].\n\n{sender}' },
  ] },
};

export const PLAYBOOKS: Record<string, { label: string; describe: string; pipelines: (keyof typeof TEMPLATES)[]; sequences: string[]; ideal: { industries: string[]; sizes: string[]; titles: string[] } }> = {
  b2b_software: { label: 'B2B software (e.g. DoxAI)', describe: 'Discovery to negotiation with exit criteria; after-demo and webinar sequences; operations and finance leaders at mid-size companies.', pipelines: ['b2b'], sequences: ['after_demo', 'webinar'], ideal: { industries: [], sizes: ['51-200', '201-1000', '1000+'], titles: ['ceo', 'cfo', 'coo', 'head', 'director', 'operations', 'finance'] } },
  education: { label: 'Education (e.g. MIST)', describe: 'Partner universities and the students they send; an enquiry sequence for students.', pipelines: ['partners', 'students'], sequences: ['enquiry'], ideal: { industries: ['Education', 'University'], sizes: [], titles: ['dean', 'director', 'head', 'international'] } },
  services: { label: 'Professional services', describe: 'A shorter B2B pipeline; after-demo sequence; partners and directors.', pipelines: ['b2b'], sequences: ['after_demo'], ideal: { industries: [], sizes: ['11-50', '51-200'], titles: ['partner', 'director', 'owner', 'ceo'] } },
};

/** Adds what the playbook brings that the company doesn't have yet (nothing is replaced). */
export async function applyPlaybook(svc: Svc, entityId: string, key: string, userId: string) {
  const pb = PLAYBOOKS[key];
  if (!pb) throw new Error('Choose a playbook.');
  const have = await pipelines(svc, entityId, true);
  const added: string[] = [];
  for (const t of pb.pipelines) if (!have.some((p) => p.kind === TEMPLATES[t].kind)) { await addPipeline(svc, entityId, t); added.push(`${TEMPLATES[t].name} pipeline`); }
  const { data: seqs } = await svc.from('crm_sequences').select('name').eq('entity_id', entityId);
  for (const s of pb.sequences) {
    const seq = PLAYBOOK_SEQUENCES[s];
    if ((seqs ?? []).some((x) => x.name === seq.name)) continue;
    await svc.from('crm_sequences').insert({ entity_id: entityId, name: seq.name, steps: seq.steps, active: false, created_by: userId });
    added.push(`“${seq.name}” sequence (off until you check it)`);
  }
  const { data: e } = await svc.from('entities').select('crm_ideal').eq('id', entityId).single();
  const ideal = (e?.crm_ideal ?? {}) as { industries?: string[]; sizes?: string[]; countries?: string[]; titles?: string[] };
  if (!(ideal.industries?.length || ideal.sizes?.length)) { await svc.from('entities').update({ crm_ideal: { ...ideal, ...pb.ideal, countries: ideal.countries ?? [] } }).eq('id', entityId); added.push('an ideal customer for lead scores'); }
  return added;
}
