import { useCallback, useEffect, useState } from 'react';
import { useOrganization } from '@/context/OrganizationContext';
import { supabase } from '@/services/supabase/config';
import { listCompanies } from '@/services/supabase/crmHub/companies';
import { listContacts } from '@/services/supabase/crmHub/contacts';
import { listDeals } from '@/services/supabase/crmHub/deals';
import { listDealStages, seedDefaultDealStages } from '@/services/supabase/crmHub/dealStages';
import { listTasks } from '@/services/supabase/crmHub/tasks';
import type { CrmCompany, CrmContact, CrmDeal, CrmDealStage, CrmTask } from '@/types/crmHub';

interface UseListResult<T> {
  items: T[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const empty: UseListResult<never> = { items: [], loading: false, error: null, refresh: async () => {} };

const useOrgId = () => {
  const { organization } = useOrganization();
  return organization?.organizationId ?? null;
};

export const useCrmCompanies = (): UseListResult<CrmCompany> => {
  const orgId = useOrgId();
  const [items, setItems] = useState<CrmCompany[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!orgId) { setItems([]); return; }
    setLoading(true);
    setError(null);
    try {
      setItems(await listCompanies(orgId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load companies');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`crm-companies-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_companies', filter: `organization_id=eq.${orgId}` }, () => void refresh())
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [orgId, refresh]);

  if (!orgId) return empty as UseListResult<CrmCompany>;
  return { items, loading, error, refresh };
};

export const useCrmContacts = (): UseListResult<CrmContact> => {
  const orgId = useOrgId();
  const [items, setItems] = useState<CrmContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!orgId) { setItems([]); return; }
    setLoading(true);
    setError(null);
    try {
      setItems(await listContacts(orgId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`crm-contacts-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_contacts', filter: `organization_id=eq.${orgId}` }, () => void refresh())
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [orgId, refresh]);

  if (!orgId) return empty as UseListResult<CrmContact>;
  return { items, loading, error, refresh };
};

export const useCrmDealStages = (): UseListResult<CrmDealStage> => {
  const orgId = useOrgId();
  const [items, setItems] = useState<CrmDealStage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!orgId) { setItems([]); return; }
    setLoading(true);
    setError(null);
    try {
      let stages = await listDealStages(orgId);
      if (stages.length === 0) {
        // First-time visit for an org: seed the seven default HubSpot-style stages.
        await seedDefaultDealStages(orgId);
        stages = await listDealStages(orgId);
      }
      setItems(stages);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load deal stages');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (!orgId) return empty as UseListResult<CrmDealStage>;
  return { items, loading, error, refresh };
};

export const useCrmDeals = (): UseListResult<CrmDeal> => {
  const orgId = useOrgId();
  const [items, setItems] = useState<CrmDeal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!orgId) { setItems([]); return; }
    setLoading(true);
    setError(null);
    try {
      setItems(await listDeals(orgId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load deals');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`crm-deals-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_deals', filter: `organization_id=eq.${orgId}` }, () => void refresh())
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [orgId, refresh]);

  if (!orgId) return empty as UseListResult<CrmDeal>;
  return { items, loading, error, refresh };
};

export const useCrmTasks = (): UseListResult<CrmTask> => {
  const orgId = useOrgId();
  const [items, setItems] = useState<CrmTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!orgId) { setItems([]); return; }
    setLoading(true);
    setError(null);
    try {
      setItems(await listTasks(orgId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!orgId) return;
    const channel = supabase
      .channel(`crm-tasks-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crm_tasks', filter: `organization_id=eq.${orgId}` }, () => void refresh())
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [orgId, refresh]);

  if (!orgId) return empty as UseListResult<CrmTask>;
  return { items, loading, error, refresh };
};
