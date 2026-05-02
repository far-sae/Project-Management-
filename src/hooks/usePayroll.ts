import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrganization } from "@/context/OrganizationContext";
import {
  CreatePayrollRunInput,
  PayrollItem,
  PayrollRun,
  UpdatePayrollItemInput,
  UpdatePayrollRunInput,
  createPayrollRun,
  deletePayrollRun,
  getPayrollRun,
  subscribeToPayrollRuns,
  updatePayrollItem,
  updatePayrollRun,
} from "@/services/supabase/payroll";

const effectiveOrgId = (
  orgIdFromCtx: string | null,
  userId: string | undefined,
): string | null => {
  if (orgIdFromCtx) return orgIdFromCtx;
  if (userId) return `local-${userId}`;
  return null;
};

export const usePayrollRuns = () => {
  const { user } = useAuth();
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = effectiveOrgId(
    organization?.organizationId ?? user?.organizationId ?? null,
    user?.userId,
  );

  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setRuns([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeToPayrollRuns(orgId, (next) => {
      setRuns(next);
      setLoading(false);
    });
  }, [orgId]);

  const create = useCallback(
    async (input: CreatePayrollRunInput) => {
      if (!orgId || !user) throw new Error("Not signed in");
      if (!(isOwner || isAdmin)) {
        throw new Error("Only owner or admin can create a payroll run.");
      }
      return createPayrollRun(orgId, user.userId, user.displayName, input);
    },
    [orgId, user, isOwner, isAdmin],
  );

  const updateRun = useCallback(
    async (runId: string, input: UpdatePayrollRunInput) => {
      if (!orgId || !user) throw new Error("Not signed in");
      // Status workflow:
      //   draft → finalized:        owner OR admin
      //   finalized → paid:         owner OR admin
      //   paid    → finalized:      owner OR admin (the "Unmark as paid" path)
      // Plain members can't reach this hook (the page itself is owner/admin
      // gated), so this is belt-and-suspenders for direct callers.
      if (
        (input.status === "finalized" || input.status === "paid") &&
        !(isOwner || isAdmin)
      ) {
        throw new Error(
          "Only owner or admin can change payroll run status.",
        );
      }
      return updatePayrollRun(orgId, runId, input, {
        userId: user.userId,
        displayName: user.displayName,
      });
    },
    [orgId, user, isOwner, isAdmin],
  );

  const remove = useCallback(
    async (runId: string) => {
      if (!orgId) return;
      await deletePayrollRun(orgId, runId);
    },
    [orgId],
  );

  return {
    organizationId: orgId,
    runs,
    loading,
    create,
    updateRun,
    remove,
    isOwner,
    isAdmin,
    canView: isOwner || isAdmin,
    canCreate: isOwner || isAdmin,
    canFinalize: isOwner,
  };
};

export const usePayrollRunDetail = (runId: string | null | undefined) => {
  const { user } = useAuth();
  const { organization, isOwner, isAdmin } = useOrganization();
  const orgId = effectiveOrgId(
    organization?.organizationId ?? user?.organizationId ?? null,
    user?.userId,
  );

  const [run, setRun] = useState<PayrollRun | null>(null);
  const [items, setItems] = useState<PayrollItem[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!orgId || !runId) return;
    setLoading(true);
    try {
      const detail = await getPayrollRun(orgId, runId);
      setRun(detail.run);
      setItems(detail.items);
    } finally {
      setLoading(false);
    }
  }, [orgId, runId]);

  useEffect(() => {
    if (!orgId || !runId) {
      setRun(null);
      setItems([]);
      return;
    }
    reload();
  }, [orgId, runId, reload]);

  const updateItem = useCallback(
    async (itemId: string, input: UpdatePayrollItemInput) => {
      if (!orgId || !runId) throw new Error("Missing context");
      const updated = await updatePayrollItem(orgId, runId, itemId, input);
      // Recompute the local list and totals
      setItems((prev) =>
        prev.map((i) => (i.itemId === itemId ? updated : i)),
      );
      // Pull fresh totals from the server (the service updates them)
      reload();
      return updated;
    },
    [orgId, runId, reload],
  );

  return {
    organizationId: orgId,
    run,
    items,
    loading,
    reload,
    updateItem,
    isOwner,
    isAdmin,
    // Owner + admin can correct payslips on any run — even a paid one. Common
    // case is somebody forgot to clock out, the run gets paid with the wrong
    // hours, and the admin needs to record the correction. Editing a paid run
    // doesn't unmark it; for that, owners use the explicit "Unmark as paid"
    // action which flips the status back to `finalized`.
    canEdit: isOwner || isAdmin,
    canFinalize: isOwner && run?.status === "draft",
    canMarkPaid: isOwner && run?.status === "finalized",
    // Owner + admin safety hatch: revert a paid run back to finalized (e.g. a
    // payment was reversed, the wrong batch was marked, etc.). Doesn't touch
    // payslips — just the run status.
    canUnmarkPaid: (isOwner || isAdmin) && run?.status === "paid",
  };
};
