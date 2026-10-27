import { serviceClient } from '../admin';
import { syncFailed, type Connection } from './connections';
import { syncHubSpot } from './hubspot';
import { syncXero } from './xero';

// The integrations' turn in the portal's worker (every minute): each connected
// HubSpot or Xero account syncs every 10 minutes, or straight away after it's
// connected or someone presses "Sync now". A paused company waits.

const EVERY = 10 * 60_000;

export async function syncConnections(origin: string) {
  const svc = serviceClient();
  const { data } = await svc.from('connections').select('*, entities(id, code, display_name, relationship, brand_color, integrations_enabled)').eq('status', 'connected');
  let ran = 0;
  for (const row of data ?? []) {
    const c = row as unknown as Connection & { entities: { id: string; code: string; display_name: string; relationship: string; brand_color: string | null; integrations_enabled: boolean } };
    const company = c.entities;
    if (!company.integrations_enabled || c.settings.paused === true) continue;
    const due = c.cursor.sync_now === true || !c.last_sync_at || Date.now() - new Date(c.last_sync_at).getTime() >= EVERY;
    if (!due) continue;
    // Claim it: only one worker syncs a connection at a time.
    const { data: claimed } = await svc.from('connections').update({ last_sync_at: new Date().toISOString(), cursor: { ...c.cursor, sync_now: false } })
      .eq('id', c.id).filter('last_sync_at', c.last_sync_at ? 'eq' : 'is', c.last_sync_at ?? null).select('id');
    if (!claimed?.length) continue;
    c.cursor = { ...c.cursor, sync_now: false };
    const central = typeof c.settings.callback === 'string' ? c.settings.callback : origin;
    try {
      if (c.provider === 'hubspot') await syncHubSpot(svc, c, company, central);
      else await syncXero(svc, c, company, central);
      ran++;
    } catch (e) {
      console.error(`${c.provider} sync for ${company.code}`, (e as Error).message);
      await syncFailed(svc, c, e as Error, company, origin);
    }
  }
  return ran;
}
