import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { isHrSetupMissing } from '@/services/supabase/leave';
import {
  deleteEmployeeDocument,
  getEmployeeDocumentUrl,
  listEmployeeDocuments,
  uploadEmployeeDocument,
  type EmployeeDocument,
  type UploadDocumentInput,
} from '@/services/supabase/hrDocuments';

/**
 * Employee documents for the current organization. `setupMissing` is true
 * until migration 179 has been run.
 */
export function useEmployeeDocuments() {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const userId = user?.userId ?? null;

  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupMissing, setSetupMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!orgId || orgId.startsWith('local-')) {
      setDocuments([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setDocuments(await listEmployeeDocuments(orgId));
      setSetupMissing(false);
      setError(null);
    } catch (e) {
      if (isHrSetupMissing(e)) {
        setSetupMissing(true);
        setError(null);
      } else {
        setError(e instanceof Error ? e.message : 'Could not load documents.');
      }
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upload = useCallback(
    async (input: UploadDocumentInput) => {
      if (!orgId || !userId) throw new Error('No organization');
      const created = await uploadEmployeeDocument(orgId, userId, input);
      setDocuments((prev) => [created, ...prev]);
      return created;
    },
    [orgId, userId],
  );

  const remove = useCallback(async (doc: EmployeeDocument) => {
    await deleteEmployeeDocument(doc);
    setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
  }, []);

  /** Open the file in a new tab through a short-lived link. */
  const open = useCallback(async (doc: EmployeeDocument) => {
    // Open the tab straight away, while the click still counts as the user's
    // action; some browsers block a tab that is opened after waiting.
    const tab = window.open('about:blank', '_blank');
    try {
      const url = await getEmployeeDocumentUrl(doc.filePath);
      if (tab) {
        tab.opener = null;
        tab.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (e) {
      tab?.close();
      throw e;
    }
  }, []);

  return { documents, loading, setupMissing, error, refresh, upload, remove, open };
}

export type UseEmployeeDocuments = ReturnType<typeof useEmployeeDocuments>;
