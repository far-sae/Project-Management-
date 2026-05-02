import { supabase } from "./config";
import { logger } from "@/lib/logger";
import {
  Organization,
  OrganizationMember,
  CreateOrganizationInput,
  UpdateOrganizationInput,
} from "@/types/organization";

// ============================================
// CREATE ORGANIZATION
// ============================================
export const createOrganization = async (
  input: CreateOrganizationInput,
): Promise<Organization> => {
  const now = new Date().toISOString();
  const organizationId = crypto.randomUUID();

  const organization = {
    organization_id: organizationId,
    name: input.name,
    owner_id: input.ownerId,
    members: [
      {
        userId: input.ownerId,
        email: input.ownerEmail,
        displayName: input.ownerDisplayName,
        photoURL: input.ownerPhotoURL || "",
        role: "owner",
        addedAt: now,
        status: "active",
      },
    ],
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from("organizations")
    .insert(organization)
    .select()
    .single();

  if (error) {
    logger.error("Failed to create organization:", error);
    throw error;
  }

  return formatOrganization(data);
};

// ============================================
// GET ORGANIZATION BY ID
// ============================================
export const getOrganization = async (
  organizationId: string,
): Promise<Organization | null> => {
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    logger.error("Failed to get organization:", error);
    return null;
  }

  if (!data) return null;

  return formatOrganization(data);
};

// ============================================
// GET USER ORGANIZATIONS
// ============================================
export const getUserOrganizations = async (
  userId: string,
): Promise<Organization[]> => {
  const { data, error } = await supabase
    .from("organizations")
    .select("*")
    .or(`owner_id.eq.${userId},members.cs.${JSON.stringify([{ userId }])}`)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("Failed to get user organizations:", error);
    return [];
  }

  return (data || []).map(formatOrganization);
};

// ============================================
// UPDATE ORGANIZATION
// ============================================
export const updateOrganization = async (
  organizationId: string,
  input: UpdateOrganizationInput,
): Promise<void> => {
  const updateData: any = {
    updated_at: new Date().toISOString(),
  };

  if (input.name) updateData.name = input.name;
  if (input.description !== undefined)
    updateData.description = input.description;
  if (input.settings) updateData.settings = input.settings;
  if (input.members) updateData.members = input.members;
  if (input.subscription) updateData.subscription = input.subscription;
  if (input.country !== undefined) updateData.country = input.country;

  const { error } = await supabase
    .from("organizations")
    .update(updateData)
    .eq("organization_id", organizationId);

  if (error) {
    logger.error("Failed to update organization:", error);
    throw error;
  }
};

// ============================================
// DELETE ORGANIZATION
// ============================================
export const deleteOrganization = async (
  organizationId: string,
): Promise<void> => {
  // Delete related workspaces first
  await supabase
    .from("workspaces")
    .delete()
    .eq("organization_id", organizationId);

  // Delete related projects
  await supabase
    .from("projects")
    .delete()
    .eq("organization_id", organizationId);

  // Delete organization
  const { error } = await supabase
    .from("organizations")
    .delete()
    .eq("organization_id", organizationId);

  if (error) {
    logger.error("Failed to delete organization:", error);
    throw error;
  }
};

// ============================================
// ADD ORGANIZATION MEMBER
// ============================================
export const addOrganizationMember = async (
  organizationId: string,
  member: OrganizationMember,
): Promise<void> => {
  // Get current organization
  const org = await getOrganization(organizationId);
  if (!org) throw new Error("Organization not found");

  // Add new member
  const updatedMembers = [...org.members, member];

  await updateOrganization(organizationId, {
    members: updatedMembers,
  });
};

// ============================================
// REMOVE ORGANIZATION MEMBER
// ============================================
export const removeOrganizationMember = async (
  organizationId: string,
  userId: string,
): Promise<void> => {
  // Get current organization
  const org = await getOrganization(organizationId);
  if (!org) throw new Error("Organization not found");

  // Remove member
  const updatedMembers = org.members.filter((m) => m.userId !== userId);

  await updateOrganization(organizationId, {
    members: updatedMembers,
  });
};

// ============================================
// GET OR CREATE ORGANIZATION (Helper for auth flow)
// ============================================
export const getOrCreateOrganization = async (
  userId: string,
  userEmail: string,
  userDisplayName: string,
  userPhotoURL?: string,
): Promise<Organization> => {
  // First try to find existing organization
  const existingOrg = await getUserOrganizations(userId);

  if (existingOrg.length > 0) {
    return existingOrg[0];
  }

  // If no organization exists, create one
  return createOrganization({
    name: `${userDisplayName}'s Workspace`,
    description: "",
    // country: "US",
    timezone: "UTC",
    currency: "USD",
    ownerId: userId,
    ownerEmail: userEmail,
    ownerDisplayName: userDisplayName,
    ownerPhotoURL: userPhotoURL,
    subscriptionTier: "starter",
    trialEndsAt: null,
  });
};

// ============================================
// SUBSCRIBE TO ORGANIZATION CHANGES
// ============================================
export const subscribeToOrganization = (
  organizationId: string,
  callback: (organization: Organization | null) => void,
) => {
  // Initial fetch
  getOrganization(organizationId).then(callback);

  // Subscribe to changes
  const channel = supabase
    .channel(`organization-${organizationId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "organizations",
        filter: `organization_id=eq.${organizationId}`,
      },
      () => {
        getOrganization(organizationId).then(callback);
      },
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
};

// ============================================
// HELPER: Format organization data from DB
// ============================================

const formatOrganization = (data: any): Organization => {
  return {
    organizationId: data.organization_id,
    name: data.name,
    slug: data.slug || data.name?.toLowerCase().replace(/\s+/g, "-") || "",
    description: data.description || "",
    ownerId: data.owner_id,
    ownerEmail: data.owner_email || "",
    ownerName: data.owner_name || "",
    createdAt: new Date(data.created_at),
    updatedAt: new Date(data.updated_at),
    status: data.status || "active",
    subscription: data.subscription || {
      tier: "starter",
      seats: 1,
      startDate: new Date(),
      endDate: null,
      status: "trial",
      autoRenew: true,
    },
    settings: data.settings || {
      timezone: "UTC",
      currency: "USD",
      locale: "en",
      branding: {},
      features: {
        aiEnabled: false,
        fileUploadsEnabled: true,
        advancedAnalytics: false,
      },
    },
    members: (data.members || []).map((m: any) => ({
      ...m,
      joinedAt: new Date(m.addedAt || m.joinedAt || new Date()),
      addedAt: m.addedAt ? new Date(m.addedAt) : undefined,
    })),
    metrics: data.metrics || {
      totalProjects: 0,
      totalTasks: 0,
      totalMembers: 1,
      totalFiles: 0,
      storageUsed: 0,
      activeUsers: 1,
    },
    country: data.country ?? undefined,
  };
};
