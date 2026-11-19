import type { Client } from '../../../api/_signroom/shared/types';
import type { SignroomClient } from './client';

/**
 * The documents server keeps its own record of who a document is for (name,
 * contact, email, billing address), because an issued invoice or a sent
 * agreement has to keep those details exactly as they were. That record is
 * always made from a CRM company, so nobody types a customer in twice.
 *
 * Call this before creating an agreement or an invoice for a company: it
 * returns the existing record or creates it from the company.
 */
export function clientForCompany(client: SignroomClient, companyId: string): Promise<Client> {
  return client.call<Client>('clients/from-company', { companyId });
}
