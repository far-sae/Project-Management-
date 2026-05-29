import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrganization } from "@/context/OrganizationContext";
import { useSelectedWorkspace } from "@/hooks/useSelectedWorkspace";
import {
  ContactWithAccount,
  CreateContactWithAccountInput,
  UpdateContactInput,
  createContactFull,
  updateContactFull,
  deleteContactFull,
  subscribeToOrganizationContacts,
} from "@/services/supabase/contacts";
import { useClients } from "@/hooks/useClients";

const effectiveOrgId = (
  orgIdFromCtx: string | null,
  userId: string | undefined,
): string | null => {
  if (orgIdFromCtx) return orgIdFromCtx;
  if (userId) return `local-${userId}`;
  return null;
};

/**
 * Workspace-scoped contacts hook. Contacts inherit their workspace from the
 * parent account, so filtering happens by intersecting against the account
 * id set that useClients already exposes.
 */
export const useContacts = () => {
  const { user } = useAuth();
  const { organization, isOwner, isAdmin, isViewer } = useOrganization();
  const orgId = effectiveOrgId(
    organization?.organizationId ?? user?.organizationId ?? null,
    user?.userId,
  );

  const {
    isAllWorkspaces, isUnassignedWorkspace, clients, allClients,
    loading: clientsLoading,
  } = useClients();

  const {
    selected: selectedWorkspace,
    isAll, isUnassigned,
  } = useSelectedWorkspace();

  const [allContacts, setAllContacts] = useState<ContactWithAccount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      setAllContacts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeToOrganizationContacts(orgId, (next) => {
      setAllContacts(next);
      setLoading(false);
    });
  }, [orgId]);

  // Workspace filter: a contact belongs to a workspace through its parent
  // account, so reuse the workspace-filtered `clients` set from useClients.
  const contacts = useMemo(() => {
    if (isAllWorkspaces) return allContacts;
    if (isUnassignedWorkspace) return [];
    const allowed = new Set(clients.map((c) => c.clientId));
    return allContacts.filter((c) => allowed.has(c.clientId));
  }, [allContacts, clients, isAllWorkspaces, isUnassignedWorkspace]);

  const create = useCallback(
    async (input: CreateContactWithAccountInput) => {
      if (!orgId || !user) throw new Error("Not signed in");
      return createContactFull(orgId, user.userId, user.displayName, input);
    },
    [orgId, user],
  );

  const update = useCallback(
    async (contactId: string, input: UpdateContactInput) => {
      if (!orgId) throw new Error("No organization");
      return updateContactFull(orgId, contactId, input);
    },
    [orgId],
  );

  const remove = useCallback(
    async (contactId: string) => {
      if (!orgId) throw new Error("No organization");
      await deleteContactFull(orgId, contactId);
      setAllContacts((prev) => prev.filter((c) => c.contactId !== contactId));
    },
    [orgId],
  );

  return {
    organizationId: orgId,
    selectedWorkspace,
    isAllWorkspaces: isAll,
    isUnassignedWorkspace: isUnassigned,
    contacts,
    allContacts,
    /** Accounts in scope — handy for the form's account lookup. */
    accountsInScope: clients,
    /** Cross-workspace accounts for the detail drawer (so it can hydrate a
     *  contact whose account lives in another workspace). */
    allAccounts: allClients,
    // Loading composes both subscriptions because `contacts` is derived
    // from `clients` (workspace filter). Returning early-true while the
    // clients subscription is still resolving avoids a brief flash of
    // the empty-state landing.
    loading: loading || clientsLoading,
    create,
    update,
    remove,
    isOwner,
    isAdmin,
    // Match the DB contract in 041_crm_clients.sql: client_contacts
    // insert/update/delete policies require is_org_admin_or_owner. The
    // viewer-only check (!isViewer) used to allow plain members through,
    // which produced 42501 errors on save. Tightening here so the UI
    // never offers the buttons when the DB would refuse them. If we want
    // members to write contacts in the future, follow the migration 101
    // pattern (members_insert_* + not_is_org_viewer).
    canCreate: Boolean(
      orgId
        && !orgId.startsWith("local-")
        && organization
        && !isViewer
        && (isOwner || isAdmin),
    ),
    canManage: isOwner || isAdmin,
    /** Set of client IDs the user can see in the active workspace, used by
     *  the detail drawer to filter the Reporting Contacts related list. */
    visibleClientIds: clients.map((c) => c.clientId),
  };
};
