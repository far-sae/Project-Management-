// Loading invoices, the customers they are for, and who the emails go out from.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Client, Invoice } from '../../../../api/_signroom/shared/types';
import { useSignroom } from '@/hooks/useSignroom';
import { errorSentence, errorStatus } from '@/lib/signroom/billing';

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

/** One answer from the documents server, and how the asking went. */
export interface ServerData<T> {
  data: T | null;
  loading: boolean;
  /** The server's own sentence when the call failed. */
  error: string;
  /**
   * The failure is the server saying this part is not set up yet (503). Show
   * `error` quietly in place of the content: it is not a fault on the page.
   */
  notSetUp: boolean;
  /** Ask again, keeping what is shown meanwhile. Resolves to the new answer, or null when it failed. */
  reload: () => Promise<T | null>;
}

/**
 * Reads one thing from the documents server for the selected workspace. Calls
 * nothing while `path` is null or no workspace is selected, starts again when
 * the path changes, and ignores a reply that a newer request has overtaken.
 */
export function useServerData<T>(path: string | null): ServerData<T> {
  const { client, workspaceId } = useSignroom();
  const active = Boolean(workspaceId && path);
  const [state, setState] = useState<Omit<ServerData<T>, 'reload'>>({ data: null, loading: active, error: '', notSetUp: false });
  const latest = useRef(0);

  const reload = useCallback(async (): Promise<T | null> => {
    const mine = ++latest.current;
    if (!workspaceId || !path) {
      setState({ data: null, loading: false, error: '', notSetUp: false });
      return null;
    }
    setState((old) => ({ ...old, loading: true }));
    try {
      const data = await client.call<T>(path);
      if (mine === latest.current) setState({ data, loading: false, error: '', notSetUp: false });
      return data;
    } catch (error) {
      if (mine === latest.current) {
        const notSetUp = errorStatus(error) === 503;
        setState((old) => ({ data: notSetUp ? null : old.data, loading: false, error: errorSentence(error), notSetUp }));
      }
      return null;
    }
  }, [client, workspaceId, path]);

  // Something else is being asked for: drop what was shown, so one year or company never sits under another's name.
  useEffect(() => {
    setState({ data: null, loading: Boolean(workspaceId && path), error: '', notSetUp: false });
    void reload();
    return () => { latest.current += 1; };
  }, [reload]);

  return { ...state, reload };
}
