// Loading invoices, the customers they are for, and who the emails go out from.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Client, Invoice } from '../../../../api/_signroom/shared/types';
import { useSignroom } from '@/hooks/useSignroom';
import { errorSentence } from '@/lib/signroom/billing';

/** How this workspace's invoice and receipt emails go out. */
export interface DeliveryInfo { mode: string; sender: string; ready: boolean }

interface ListState<T> { items: T[]; loading: boolean; error: string }

/**
 * A list from the documents server for the selected workspace. Calls nothing
 * while no workspace is selected, and ignores a reply that a newer request
 * has overtaken.
 */
function useServerList<T>(path: string | null): ListState<T> & { reload: () => Promise<void>; workspaceId: string | null } {
  const { client, workspaceId } = useSignroom();
  const [state, setState] = useState<ListState<T>>({ items: [], loading: Boolean(workspaceId && path), error: '' });
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++latest.current;
    if (!workspaceId || !path) {
      setState({ items: [], loading: false, error: '' });
      return;
    }
    setState((old) => ({ ...old, loading: true }));
    try {
      const items = await client.call<T[]>(path);
      if (mine === latest.current) setState({ items, loading: false, error: '' });
    } catch (error) {
      if (mine === latest.current) setState((old) => ({ items: old.items, loading: false, error: errorSentence(error) }));
    }
  }, [client, workspaceId, path]);

  // A different workspace or list: drop what was shown, so one workspace's rows never sit under another's name.
  useEffect(() => {
    setState({ items: [], loading: Boolean(workspaceId && path), error: '' });
    void reload();
    return () => { latest.current += 1; };
  }, [reload]);

  return { ...state, reload, workspaceId };
}

/** The workspace's invoices, or only one CRM company's or one deal's. */
export function useInvoices(scope: { companyId?: string; dealId?: string } = {}) {
  const { companyId, dealId } = scope;
  const path = useMemo(() => {
    const query = new URLSearchParams();
    if (companyId) query.set('companyId', companyId);
    if (dealId) query.set('dealId', dealId);
    const text = query.toString();
    return text ? `billing?${text}` : 'billing';
  }, [companyId, dealId]);
  const { items, ...rest } = useServerList<Invoice>(path);
  return { invoices: items, ...rest };
}

/**
 * The customers documents are made out to. Each one stands for a CRM company
 * (`crmCompanyId`), which is how an invoice links back to its company.
 */
export function useBillingClients() {
  const { items, ...rest } = useServerList<Client>('clients');
  const byId = useMemo(() => new Map(items.map((c) => [c.id, c])), [items]);
  return { clients: items, byId, ...rest };
}

/** Who invoice and receipt emails are sent from. Null until known; `error` is the server's sentence. */
export function useDelivery(): { delivery: DeliveryInfo | null; error: string } {
  const { client, workspaceId } = useSignroom();
  const [delivery, setDelivery] = useState<DeliveryInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setDelivery(null);
    setError('');
    if (!workspaceId) return;
    client.call<DeliveryInfo>('billing/delivery')
      .then((info) => { if (alive) setDelivery(info); })
      .catch((err) => { if (alive) setError(errorSentence(err)); });
    return () => { alive = false; };
  }, [client, workspaceId]);

  return { delivery, error };
}

/** The name to show for who an invoice is for: as issued, else the customer's current name. */
export const customerName = (invoice: Invoice, byId: Map<string, Client>): string =>
  invoice.customer?.name || byId.get(invoice.clientId)?.name || '';
