import type { VercelRequest, VercelResponse } from '@vercel/node';
import { serviceClient } from '../_lib/context';
import { fetchDnsRecords } from '../_lib/dns';
import { interpretDomainAuth } from '../_lib/domainAuth';

// Basic FQDN shape: 2+ dot-separated labels, each 1-63 chars, no leading or
// trailing hyphen, total length under the 253-byte DNS ceiling. Rejecting
// junk here means a typo never reaches the resolver.
const DOMAIN_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const db = serviceClient();
  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData?.user) return res.status(401).json({ error: 'Unauthorized' });

  const domain = String((req.body ?? {}).domain ?? '').trim().toLowerCase();
  if (!domain || !DOMAIN_RE.test(domain)) {
    return res.status(400).json({ error: 'A valid domain is required' });
  }

  // This is a diagnostic over public DNS records, not access to any
  // organization's private data or credentials, so it needs no specific
  // organizationId and no admin right — unlike verify.ts and
  // account-secret.ts, which spend an account's sending identity and so
  // require the caller to own or administer that account's organization.
  // What it does require is that the caller actually belongs to some
  // organization, so an authenticated-but-orgless account cannot use this
  // route as a free DNS-probing proxy. is_org_member() is no use here: it
  // reads auth.uid(), which is null under the service-role client, so the
  // check is done in the open with the same owner-or-members-array query
  // src/services/supabase/organizations.ts's getUserOrganizations uses.
  const callerId = userData.user.id;
  const { data: orgRows, error: orgError } = await db
    .from('organizations')
    .select('organization_id')
    .or(`owner_id.eq.${callerId},members.cs.${JSON.stringify([{ userId: callerId }])}`)
    .limit(1);
  if (orgError || !orgRows || orgRows.length === 0) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const raw = await fetchDnsRecords(domain);
    const report = interpretDomainAuth(raw);
    return res.status(200).json(report);
  } catch (err: any) {
    const message = String(err?.message ?? err).slice(0, 500);
    return res.status(500).json({ error: message });
  }
}
