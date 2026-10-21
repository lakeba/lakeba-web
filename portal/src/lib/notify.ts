import { serviceClient } from './admin';
import { sendMail } from './mail';

/**
 * Tells every portal member (or the given users) about something new: an
 * in-app notification for each, plus an email for those who opted in.
 */
export async function notifyMembers({ title, body, link, kind, userIds, origin }: {
  title: string; body: string; link: string; kind: string; userIds?: string[]; origin: string;
}) {
  const svc = serviceClient();
  let recipients = userIds;
  if (!recipients) {
    const [{ data: members }, { data: board }] = await Promise.all([
      svc.from('holder_members').select('user_id'),
      svc.from('profiles').select('id').eq('role', 'board'),
    ]);
    recipients = [...new Set([...(members ?? []).map((m) => m.user_id), ...(board ?? []).map((b) => b.id)])];
  }
  if (!recipients.length) return 0;

  await svc.from('notifications').insert(recipients.map((user_id) => ({ user_id, kind, title, body, link }))).throwOnError();
  const { data: profiles } = await svc.from('profiles').select('email, notify_email').in('id', recipients);
  await Promise.allSettled(
    (profiles ?? []).filter((p) => p.notify_email).map((p) => sendMail({ to: p.email, subject: title, text: body, link: new URL(link, origin).href })),
  );
  return recipients.length;
}
