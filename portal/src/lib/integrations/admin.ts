import type { Access } from '../access';
import type { serviceClient } from '../admin';

type Svc = ReturnType<typeof serviceClient>;

// Who runs a company's integrations: its Admins (the Admin role for that
// company) and the group's Admins. A group Admin can also switch a company's
// integrations off at once.

export const isCompanyAdmin = (access: Access, entityId: string) =>
  access.groupAdmin || (access.roles.some((r) => r.role_key === 'admin' && r.entity_id === entityId) && access.can('investors.do', entityId));

export async function companyByCode(svc: Svc, code: string) {
  const { data } = await svc.from('entities').select('id, code, display_name, legal_name, relationship, portal, integrations_enabled, brand_color, website').eq('code', code.toUpperCase()).maybeSingle();
  return data;
}

export type TabKey = 'overview' | 'keys' | 'webhooks' | 'incoming' | 'hubspot' | 'xero' | 'apps' | 'usage';
export const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'keys', label: 'API keys' }, { key: 'webhooks', label: 'Outgoing webhooks' },
  { key: 'incoming', label: 'Incoming webhooks' }, { key: 'hubspot', label: 'HubSpot' }, { key: 'xero', label: 'Xero' },
  { key: 'apps', label: 'Apps' }, { key: 'usage', label: 'Usage' },
];
