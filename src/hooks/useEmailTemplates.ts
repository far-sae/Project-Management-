import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrganization } from "@/context/OrganizationContext";
import {
  EmailTemplate,
  CreateEmailTemplateInput,
  UpdateEmailTemplateInput,
  listEmailTemplates,
  createEmailTemplate as createSvc,
  updateEmailTemplate as updateSvc,
  deleteEmailTemplate as deleteSvc,
} from "@/services/supabase/emailTemplates";

const effectiveOrgId = (
  orgIdFromCtx: string | null,
  userId: string | undefined,
): string | null => {
  if (orgIdFromCtx) return orgIdFromCtx;
  if (userId) return `local-${userId}`;
  return null;
};

export const useEmailTemplates = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId = effectiveOrgId(
    organization?.organizationId ?? user?.organizationId ?? null,
    user?.userId,
  );

  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!orgId) {
      setTemplates([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setTemplates(await listEmailTemplates(orgId));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: CreateEmailTemplateInput) => {
      if (!orgId) throw new Error("No organization");
      const tpl = await createSvc(
        orgId,
        user?.userId ?? null,
        user?.displayName ?? null,
        input,
      );
      await refresh();
      return tpl;
    },
    [orgId, user?.userId, user?.displayName, refresh],
  );

  const update = useCallback(
    async (templateId: string, input: UpdateEmailTemplateInput) => {
      if (!orgId) throw new Error("No organization");
      const tpl = await updateSvc(orgId, templateId, input);
      await refresh();
      return tpl;
    },
    [orgId, refresh],
  );

  const remove = useCallback(
    async (templateId: string) => {
      if (!orgId) throw new Error("No organization");
      await deleteSvc(orgId, templateId);
      await refresh();
    },
    [orgId, refresh],
  );

  return {
    organizationId: orgId,
    templates,
    loading,
    create,
    update,
    remove,
    refresh,
  };
};
