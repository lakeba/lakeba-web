import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from './admin';
import { notifyAdmins } from './notify';
import { deviceName } from './passkeys';

/**
 * Everything that follows a successful sign-in (password, email link or
 * passkey): the audit entry, an "investor signed in for the first time" alert
 * for admins, and a "new device" alert when an admin account signs in from a
 * device it hasn't used before. Alerts never block the sign-in.
 */
export async function recordSignIn({ supabase, userId, method, request, origin, detail = {} }: {
  supabase: SupabaseClient; userId: string; method: string; request: Request; origin: string; detail?: Record<string, unknown>;
}) {
  await supabase.rpc('log_event', { event_action: 'sign_in', event_detail: { method, ...detail } });
  try {
    const svc = serviceClient();
    const { data: profile } = await svc.from('profiles').select('email, first_name, last_name, role, first_signed_in_at').eq('id', userId).single();
    if (!profile) return;
    const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email;

    if (!profile.first_signed_in_at) {
      await svc.from('profiles').update({ first_signed_in_at: new Date().toISOString() }).eq('id', userId);
      if (profile.role !== 'admin') {
        await notifyAdmins({
          kind: 'admin_first_signin', origin, link: `/admin/investors/${userId}`,
          title: `${name} signed in for the first time`,
          body: `${name} (${profile.email}) signed in to the investor portal for the first time.`,
        });
      }
    }

    if (profile.role === 'admin') {
      const device = deviceName(request.headers.get('user-agent') ?? '');
      const { data: known } = await svc.from('admin_devices').select('device').eq('user_id', userId);
      const isNew = !(known ?? []).some((k) => k.device === device);
      await svc.from('admin_devices').upsert({ user_id: userId, device, last_seen: new Date().toISOString() });
      // The very first device isn't news; a new one after that is.
      if (isNew && (known ?? []).length > 0) {
        await notifyAdmins({
          kind: 'admin_security', origin, link: `/admin/investors/${userId}`,
          title: `Admin sign-in from a new device: ${name}`,
          body: `The admin account ${profile.email} signed in from a new device (${device}). If this wasn’t expected, disable the account in Admin → Investors.`,
          pushDetail: `${name} · ${device}`,
        });
      }
    }
  } catch (e) {
    console.error('recordSignIn alerts failed', (e as Error).message);
  }
}
