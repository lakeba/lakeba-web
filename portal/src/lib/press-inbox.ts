import type { serviceClient } from './admin';
import { getMessage, graphConfigured, newMessages, setCategory, type GraphMessage } from './graph';
import { optOut } from './media';
import { notifyMembers } from './notify';
import { pressSettings } from './press';

type Svc = ReturnType<typeof serviceClient>;

// Reading the press office's shared mailbox (press@) for answers to pitches:
// a reply, an automatic reply (out of office), a bounce, or a request to stop.
// Each is matched to its pitch by our Message-ID (In-Reply-To / References,
// or quoted in a bounce), else by the sender's address. The portal only
// reads and adds an Outlook category ("Portal: …"): the press team still
// answers in Outlook. Messages it can't match are left alone.

const BOUNCE_FROM = /^(postmaster|mailer-daemon|microsoftexchange[0-9a-f]*|mail-?daemon)@/i;
const BOUNCE_SUBJECT = /^(undeliverable|undelivered|delivery (status notification|has failed|failure)|mail delivery (failed|subsystem)|returned mail|failure notice|message not delivered)/i;
const AUTO_SUBJECT = /^(automatic reply|auto(matic)?[- ]?(reply|response)|out of (the )?office|absence|away from|on leave|ooo\b)/i;
const STOP = /^\s*(unsubscribe|remove me|please remove|stop|take me off|opt[- ]?out)\b/i;

type Hit = { id: string; distribution_id: string; email: string; contact_id: string | null; name: string; replied_at: string | null; bounced_at: string | null; auto_replied_at: string | null };
const COLS = 'id, distribution_id, email, contact_id, name, replied_at, bounced_at, auto_replied_at';
const header = (m: GraphMessage, name: string) => m.internetMessageHeaders?.find((h) => h.name.toLowerCase() === name)?.value ?? '';
/** The new words of a reply, without the quoted pitch below. */
export const replyText = (body: string) => body.replace(/\r/g, '').split(/\n(?:On .{5,200}wrote:|-{2,}\s*Original Message|_{5,}|From: .+\n(?:Sent|Date): )/i)[0].replace(/^>.*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();

async function byMessageId(svc: Svc, ids: string[]) {
  const clean = [...new Set(ids.map((x) => x.trim()).filter((x) => /^<pitch\.[0-9a-f-]{36}\.[0-9a-f]+@[^>]+>$/i.test(x)))];
  if (!clean.length) return null;
  const { data } = await svc.from('press_pitches').select(COLS).in('message_id', clean).limit(1);
  return (data?.[0] ?? null) as Hit | null;
}
async function bySender(svc: Svc, email: string) {
  const since = new Date(Date.now() - 45 * 86_400_000).toISOString();
  const { data } = await svc.from('press_pitches').select(COLS).eq('email', email.toLowerCase()).eq('status', 'sent').gte('sent_at', since).order('sent_at', { ascending: false }).limit(1);
  return (data?.[0] ?? null) as Hit | null;
}

/** One message from press@: what it is, and which pitch it answers. */
export async function classify(svc: Svc, m: GraphMessage) {
  const from = (m.from?.emailAddress.address ?? '').toLowerCase();
  const subject = (m.subject ?? '').trim();
  const body = m.body?.content ?? '';
  const refs = `${header(m, 'in-reply-to')} ${header(m, 'references')}`.match(/<[^>]+>/g) ?? [];
  if (BOUNCE_FROM.test(from) || BOUNCE_SUBJECT.test(subject)) {
    // Bounces quote the original Message-ID or at least the address it was sent to.
    const quoted = body.match(/<pitch\.[0-9a-f-]{36}\.[0-9a-f]+@[^>\s]+>/gi) ?? [];
    let p = await byMessageId(svc, [...refs, ...quoted]);
    if (!p) {
      const addresses = [...new Set((body.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? []).map((a) => a.toLowerCase()))].filter((a) => !BOUNCE_FROM.test(a) && !a.endsWith('@lakeba.com'));
      for (const a of addresses.slice(0, 5)) { p = await bySender(svc, a); if (p) break; }
    }
    return { kind: 'bounce' as const, pitch: p };
  }
  const p = (await byMessageId(svc, refs)) ?? (from ? await bySender(svc, from) : null);
  const auto = /auto-replied|auto-generated/i.test(header(m, 'auto-submitted')) || header(m, 'x-autoreply') !== '' || AUTO_SUBJECT.test(subject.replace(/^(re|aw|fw|fwd):\s*/i, ''));
  if (auto) return { kind: 'auto' as const, pitch: p };
  const text = replyText(body);
  if (p && STOP.test(text) && text.length < 300) return { kind: 'stop' as const, pitch: p, text };
  return { kind: 'reply' as const, pitch: p, text };
}

let polling = false;

/** Every minute: new messages in press@ since the last look (the first look only notes where the Inbox is). */
export async function pollPressMailbox(svc: Svc, origin: string) {
  if (!graphConfigured() || polling) return { checked: false, matched: 0 };
  const s = await pressSettings(svc);
  if (!s.reply_tracking || !s.reply_mailbox) return { checked: false, matched: 0 };
  polling = true;
  const mailbox = s.reply_mailbox.toLowerCase();
  let matched = 0;
  const { data: state } = await svc.from('email_sync_state').select('delta_link').eq('mailbox', mailbox).maybeSingle();
  try {
    const { messages, deltaLink } = await newMessages(mailbox, state?.delta_link ?? null);
    for (const brief of messages.sort((a, b) => a.receivedDateTime.localeCompare(b.receivedDateTime))) {
      const m = await getMessage(mailbox, brief.id).catch(() => brief); // headers (In-Reply-To) aren't in delta pages
      const c = await classify(svc, m);
      if (!c.pitch) continue;
      matched++;
      const at = m.receivedDateTime ?? new Date().toISOString();
      const p = c.pitch;
      if (c.kind === 'bounce') {
        await svc.from('press_pitches').update({ bounced_at: p.bounced_at ?? at }).eq('id', p.id);
        if (p.contact_id) await svc.from('media_contacts').update({ status: 'bounced', updated_at: new Date().toISOString() }).eq('id', p.contact_id).eq('status', 'active');
        await setCategory(mailbox, m.id, 'Portal: Bounce', m.categories).catch(() => null);
      } else if (c.kind === 'auto') {
        await svc.from('press_pitches').update({ auto_replied_at: p.auto_replied_at ?? at }).eq('id', p.id);
        await setCategory(mailbox, m.id, 'Portal: Automatic reply', m.categories).catch(() => null);
      } else {
        // A reply (or a request to stop, which is honoured straight away and permanently).
        await svc.from('press_pitches').update({ replied_at: p.replied_at ?? at, reply_subject: (m.subject ?? '').slice(0, 300), reply_preview: c.text.slice(0, 600), ...(c.kind === 'stop' ? { unsubscribed_at: at } : {}) }).eq('id', p.id);
        if (c.kind === 'stop') await optOut(svc, p.email, 'asked by reply');
        await setCategory(mailbox, m.id, c.kind === 'stop' ? 'Portal: Unsubscribed' : 'Portal: Pitch reply', m.categories).catch(() => null);
        const { data: d } = await svc.from('press_distributions').select('created_by, approved_by, release_id').eq('id', p.distribution_id).maybeSingle();
        if (d && c.kind === 'reply' && !p.replied_at) {
          await notifyMembers({ kind: 'admin_press', title: `${p.name || p.email} replied to a pitch`, body: c.text.slice(0, 200) || (m.subject ?? ''), link: `/admin/press/distribution/${p.distribution_id}`, origin, userIds: [...new Set([d.created_by, d.approved_by].filter(Boolean) as string[])] }).catch(() => 0);
        }
      }
    }
    await svc.from('email_sync_state').upsert({ mailbox, delta_link: deltaLink, last_checked_at: new Date().toISOString(), last_error: null });
  } catch (err) {
    await svc.from('email_sync_state').upsert({ mailbox, delta_link: state?.delta_link ?? null, last_checked_at: new Date().toISOString(), last_error: String((err as Error).message ?? err).slice(0, 500) });
  } finally {
    polling = false;
  }
  return { checked: true, matched };
}
