import { supabase } from "./config";
import { logger } from "@/lib/logger";

export type ContractStatus =
  | "draft"
  | "pending"
  | "accepted"
  | "rejected"
  | "expired";

export interface Contract {
  contractId: string;
  organizationId: string;
  title: string;
  client: string;
  clientEmail?: string;
  assignedTo?: string; // User ID of team member who needs to respond
  assignedToName?: string; // Name of team member
  assignedToEmail?: string; // Email of team member
  status: ContractStatus;
  currency?: string;
  value?: number;
  startDate?: Date;
  endDate?: Date;
  createdBy: string;
  createdByName?: string; // Name of creator
  createdAt: Date;
  updatedAt: Date;
  acceptedAt?: Date;
  rejectedAt?: Date;
  rejectionReason?: string;
  respondedBy?: string; // User ID of who actually responded
  respondedByName?: string; // Name of who responded
}

export interface CreateContractInput {
  title: string;
  client: string;
  clientEmail?: string;
  assignedTo?: string; // User ID to assign to
  assignedToName?: string;
  assignedToEmail?: string;
  status?: ContractStatus;
  currency?: string;
  value?: number;
  startDate?: Date;
  endDate?: Date;
}

export interface UpdateContractInput {
  title?: string;
  client?: string;
  clientEmail?: string;
  assignedTo?: string;
  assignedToName?: string;
  assignedToEmail?: string;
  status?: ContractStatus;
  currency?: string;
  value?: number;
  startDate?: Date;
  endDate?: Date;
  rejectionReason?: string;
}

// Map database object to Contract interface
const mapContract = (data: Record<string, unknown>): Contract => ({
  contractId: data.contract_id as string,
  organizationId: data.organization_id as string,
  title: data.title as string,
  client: data.client as string,
  clientEmail: data.client_email as string,
  assignedTo: data.assigned_to as string,
  assignedToName: data.assigned_to_name as string,
  assignedToEmail: data.assigned_to_email as string,
  status: ((data.status as string)?.toLowerCase() as ContractStatus) || "draft",
  currency: (data.currency as string) || "USD",
  value: data.value != null ? Number(data.value) : undefined,
  startDate: data.start_date ? new Date(data.start_date as string) : undefined,
  endDate: data.end_date ? new Date(data.end_date as string) : undefined,
  createdBy: data.created_by as string,
  createdByName: data.created_by_name as string,
  createdAt: new Date(data.created_at as string),
  updatedAt: new Date(data.updated_at as string),
  acceptedAt: data.accepted_at
    ? new Date(data.accepted_at as string)
    : undefined,
  rejectedAt: data.rejected_at
    ? new Date(data.rejected_at as string)
    : undefined,
  rejectionReason: data.rejection_reason as string,
  respondedBy: data.responded_by as string,
  respondedByName: data.responded_by_name as string,
});

// Create a new contract
export const createContract = async (
  organizationId: string,
  createdBy: string,
  createdByName: string,
  input: CreateContractInput,
): Promise<Contract> => {
  const now = new Date().toISOString();
  const contractId = crypto.randomUUID();

  // Handle local development (localStorage fallback)
  if (organizationId.startsWith("local-")) {
    const localContract: Contract = {
      contractId,
      organizationId,
      title: input.title,
      client: input.client,
      clientEmail: input.clientEmail,
      assignedTo: input.assignedTo,
      assignedToName: input.assignedToName,
      assignedToEmail: input.assignedToEmail,
      status: input.status || "pending", // Default to pending if assigned
      currency: input.currency || "USD",
      value: input.value,
      startDate: input.startDate,
      endDate: input.endDate,
      createdBy,
      createdByName,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const existing = JSON.parse(localStorage.getItem("pm_contracts") || "[]");
    localStorage.setItem(
      "pm_contracts",
      JSON.stringify([localContract, ...existing]),
    );
    return localContract;
  }

  // Production: Insert into Supabase
  const contract = {
    contract_id: contractId,
    organization_id: organizationId,
    title: input.title,
    client: input.client,
    client_email: input.clientEmail,
    assigned_to: input.assignedTo,
    assigned_to_name: input.assignedToName,
    assigned_to_email: input.assignedToEmail,
    status: input.assignedTo ? "pending" : input.status || "draft",
    currency: input.currency || "USD",
    value: input.value ?? null,
    start_date: input.startDate
      ? input.startDate.toISOString().split("T")[0]
      : null,
    end_date: input.endDate ? input.endDate.toISOString().split("T")[0] : null,
    created_by: createdBy,
    created_by_name: createdByName,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from("contracts")
    .insert(contract)
    .select()
    .single();

  if (error) {
    logger.error("Failed to create contract:", error);
    throw error;
  }

  return mapContract(data);
};

export const getContractsAssignedToUser = async (
  userId: string,
  organizationId: string,
): Promise<Contract[]> => {
  console.log("Querying with:", { userId, organizationId });

  const { data, error } = await supabase
    .from("contracts")
    .select("*")
    .eq("assigned_to", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  console.log("Raw DB response:", data);
  console.log("DB error:", error);

  if (error) {
    console.error("Failed to get assigned contracts:", error);
    return [];
  }

  return (data || []).map(mapContract);
};

// Respond to a contract (accept/reject)
export const respondToContract = async (
  contractId: string,
  organizationId: string,
  userId: string,
  userName: string,
  response: "accepted" | "rejected",
  rejectionReason?: string,
): Promise<void> => {
  const now = new Date().toISOString();

  // Handle local development
  if (organizationId.startsWith("local-")) {
    const all = JSON.parse(
      localStorage.getItem("pm_contracts") || "[]",
    ) as Contract[];
    const index = all.findIndex((c) => c.contractId === contractId);
    if (index === -1) throw new Error("Contract not found");

    all[index] = {
      ...all[index],
      status: response,
      ...(response === "accepted" ? { acceptedAt: new Date() } : {}),
      ...(response === "rejected"
        ? { rejectedAt: new Date(), rejectionReason }
        : {}),
      respondedBy: userId,
      respondedByName: userName,
      updatedAt: new Date(),
    };

    localStorage.setItem("pm_contracts", JSON.stringify(all));
    return;
  }

  // Production: Update in Supabase
  const updateData: Record<string, unknown> = {
    status: response,
    updated_at: now,
    responded_by: userId,
    responded_by_name: userName,
  };

  if (response === "accepted") {
    updateData.accepted_at = now;
  } else if (response === "rejected") {
    updateData.rejected_at = now;
    if (rejectionReason) updateData.rejection_reason = rejectionReason;
  }

  const { error } = await supabase
    .from("contracts")
    .update(updateData)
    .eq("contract_id", contractId);

  if (error) {
    logger.error(`Failed to ${response} contract:`, error);
    throw error;
  }
};

// Get all contracts for an organization
export const getOrganizationContracts = async (
  organizationId: string,
): Promise<Contract[]> => {
  // Handle local development
  if (organizationId.startsWith("local-")) {
    const all = JSON.parse(
      localStorage.getItem("pm_contracts") || "[]",
    ) as Contract[];
    return all.filter((c) => c.organizationId === organizationId);
  }

  // Production: Query from Supabase
  const { data, error } = await supabase
    .from("contracts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("Failed to get contracts:", error);
    return [];
  }

  return (data || []).map(mapContract);
};

// Update a contract
export const updateContract = async (
  contractId: string,
  organizationId: string,
  input: UpdateContractInput,
): Promise<void> => {
  // Handle local development
  if (organizationId.startsWith("local-")) {
    const all = JSON.parse(
      localStorage.getItem("pm_contracts") || "[]",
    ) as Contract[];
    const updated = all.map((c) =>
      c.contractId === contractId
        ? { ...c, ...input, updatedAt: new Date() }
        : c,
    );
    localStorage.setItem("pm_contracts", JSON.stringify(updated));
    return;
  }

  // Production: Update in Supabase
  const updateData: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (input.title) updateData.title = input.title;
  if (input.client) updateData.client = input.client;
  if (input.clientEmail) updateData.client_email = input.clientEmail;
  if (input.assignedTo) updateData.assigned_to = input.assignedTo;
  if (input.assignedToName) updateData.assigned_to_name = input.assignedToName;
  if (input.assignedToEmail)
    updateData.assigned_to_email = input.assignedToEmail;
  if (input.status) updateData.status = input.status;
  if (input.value !== undefined) updateData.value = input.value;
  if (input.startDate)
    updateData.start_date = input.startDate.toISOString().split("T")[0];
  if (input.endDate)
    updateData.end_date = input.endDate.toISOString().split("T")[0];
  if (input.currency !== undefined) updateData.currency = input.currency;

  const { error } = await supabase
    .from("contracts")
    .update(updateData)
    .eq("contract_id", contractId)
    .eq("organization_id", organizationId);

  if (error) {
    logger.error("Failed to update contract:", error);
    throw error;
  }
};

// Delete a contract
export const deleteContract = async (
  contractId: string,
  organizationId: string,
): Promise<void> => {
  // Handle local development
  if (organizationId.startsWith("local-")) {
    const all = JSON.parse(
      localStorage.getItem("pm_contracts") || "[]",
    ) as Contract[];
    localStorage.setItem(
      "pm_contracts",
      JSON.stringify(all.filter((c) => c.contractId !== contractId)),
    );
    return;
  }

  // Production: Delete from Supabase
  const { error } = await supabase
    .from("contracts")
    .delete()
    .eq("contract_id", contractId)
    .eq("organization_id", organizationId);

  if (error) {
    logger.error("Failed to delete contract:", error);
    throw error;
  }
};

// Subscribe to contract changes
export const subscribeToContracts = (
  organizationId: string,
  callback: (contracts: Contract[]) => void,
) => {
  // Initial fetch
  getOrganizationContracts(organizationId).then(callback);

  // Skip realtime for local development
  if (organizationId.startsWith("local-")) {
    return () => {};
  }

  // Subscribe to changes
  const channelName = `contracts-${organizationId}-${Math.random().toString(36).substr(2, 9)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "contracts",
        filter: `organization_id=eq.${organizationId}`,
      },
      () => {
        getOrganizationContracts(organizationId).then(callback);
      },
    )
    .subscribe();

  return () => channel.unsubscribe();
};
