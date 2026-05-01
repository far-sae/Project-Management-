import { supabase } from "./config";
import { logger } from "@/lib/logger";

export type ExpenseStatus = "pending" | "approved" | "rejected";

export interface Expense {
  expenseId: string;
  organizationId: string;
  projectId?: string | null;
  projectName?: string | null;
  taskId?: string | null;
  taskTitle?: string | null;
  userId: string;
  userName?: string | null;
  title: string;
  description?: string | null;
  category?: string | null;
  amount: number;
  currency: string;
  vendor?: string | null;
  invoiceUrl?: string | null;
  invoicePath?: string | null;
  invoiceName?: string | null;
  invoiceType?: string | null;
  invoiceSize?: number | null;
  status: ExpenseStatus;
  statusReason?: string | null;
  statusChangedBy?: string | null;
  statusChangedAt?: Date | null;
  incurredOn: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateExpenseInput {
  projectId?: string | null;
  projectName?: string | null;
  taskId?: string | null;
  taskTitle?: string | null;
  title: string;
  description?: string | null;
  category?: string | null;
  amount: number;
  currency?: string;
  vendor?: string | null;
  invoiceUrl?: string | null;
  invoicePath?: string | null;
  invoiceName?: string | null;
  invoiceType?: string | null;
  invoiceSize?: number | null;
  incurredOn?: Date;
}

export interface UpdateExpenseInput {
  title?: string;
  description?: string | null;
  category?: string | null;
  amount?: number;
  currency?: string;
  vendor?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  taskId?: string | null;
  taskTitle?: string | null;
  invoiceUrl?: string | null;
  invoicePath?: string | null;
  invoiceName?: string | null;
  invoiceType?: string | null;
  invoiceSize?: number | null;
  incurredOn?: Date;
  status?: ExpenseStatus;
  statusReason?: string | null;
}

const mapExpense = (row: Record<string, unknown>): Expense => ({
  expenseId: row.expense_id as string,
  organizationId: row.organization_id as string,
  projectId: (row.project_id as string) ?? null,
  projectName: (row.project_name as string) ?? null,
  taskId: (row.task_id as string) ?? null,
  taskTitle: (row.task_title as string) ?? null,
  userId: row.user_id as string,
  userName: (row.user_name as string) ?? null,
  title: row.title as string,
  description: (row.description as string) ?? null,
  category: (row.category as string) ?? null,
  amount: row.amount != null ? Number(row.amount) : 0,
  currency: ((row.currency as string) || "USD").toUpperCase(),
  vendor: (row.vendor as string) ?? null,
  invoiceUrl: (row.invoice_url as string) ?? null,
  invoicePath: (row.invoice_path as string) ?? null,
  invoiceName: (row.invoice_name as string) ?? null,
  invoiceType: (row.invoice_type as string) ?? null,
  invoiceSize: row.invoice_size != null ? Number(row.invoice_size) : null,
  status: ((row.status as string) || "pending") as ExpenseStatus,
  statusReason: (row.status_reason as string) ?? null,
  statusChangedBy: (row.status_changed_by as string) ?? null,
  statusChangedAt: row.status_changed_at
    ? new Date(row.status_changed_at as string)
    : null,
  incurredOn: row.incurred_on
    ? new Date(row.incurred_on as string)
    : new Date(row.created_at as string),
  createdAt: new Date(row.created_at as string),
  updatedAt: new Date(row.updated_at as string),
});

const isLocalOrg = (orgId: string) => orgId.startsWith("local-");
const localKey = (orgId: string) => `pm_expenses_${orgId}`;

const readLocal = (orgId: string): Expense[] => {
  try {
    const raw = localStorage.getItem(localKey(orgId));
    if (!raw) return [];
    return (JSON.parse(raw) as Expense[]).map((e) => ({
      ...e,
      incurredOn: new Date(e.incurredOn),
      createdAt: new Date(e.createdAt),
      updatedAt: new Date(e.updatedAt),
      statusChangedAt: e.statusChangedAt ? new Date(e.statusChangedAt) : null,
    }));
  } catch {
    return [];
  }
};
const writeLocal = (orgId: string, expenses: Expense[]) =>
  localStorage.setItem(localKey(orgId), JSON.stringify(expenses));

export const createExpense = async (
  organizationId: string,
  userId: string,
  userName: string,
  input: CreateExpenseInput,
): Promise<Expense> => {
  if (isLocalOrg(organizationId)) {
    const now = new Date();
    const expense: Expense = {
      expenseId: crypto.randomUUID(),
      organizationId,
      projectId: input.projectId ?? null,
      projectName: input.projectName ?? null,
      taskId: input.taskId ?? null,
      taskTitle: input.taskTitle ?? null,
      userId,
      userName,
      title: input.title,
      description: input.description ?? null,
      category: input.category ?? null,
      amount: input.amount,
      currency: (input.currency || "USD").toUpperCase(),
      vendor: input.vendor ?? null,
      invoiceUrl: input.invoiceUrl ?? null,
      invoicePath: input.invoicePath ?? null,
      invoiceName: input.invoiceName ?? null,
      invoiceType: input.invoiceType ?? null,
      invoiceSize: input.invoiceSize ?? null,
      status: "pending",
      statusReason: null,
      statusChangedBy: null,
      statusChangedAt: null,
      incurredOn: input.incurredOn ?? now,
      createdAt: now,
      updatedAt: now,
    };
    writeLocal(organizationId, [expense, ...readLocal(organizationId)]);
    return expense;
  }

  const row = {
    organization_id: organizationId,
    user_id: userId,
    user_name: userName,
    project_id: input.projectId ?? null,
    project_name: input.projectName ?? null,
    task_id: input.taskId ?? null,
    task_title: input.taskTitle ?? null,
    title: input.title,
    description: input.description ?? null,
    category: input.category ?? null,
    amount: input.amount,
    currency: (input.currency || "USD").toUpperCase(),
    vendor: input.vendor ?? null,
    invoice_url: input.invoiceUrl ?? null,
    invoice_path: input.invoicePath ?? null,
    invoice_name: input.invoiceName ?? null,
    invoice_type: input.invoiceType ?? null,
    invoice_size: input.invoiceSize ?? null,
    incurred_on: (input.incurredOn ?? new Date())
      .toISOString()
      .split("T")[0],
    status: "pending",
  };

  const { data, error } = await supabase
    .from("expenses")
    .insert(row)
    .select()
    .single();

  if (error) {
    logger.error("Failed to create expense:", error);
    throw error;
  }
  return mapExpense(data);
};

export const getOrganizationExpenses = async (
  organizationId: string,
): Promise<Expense[]> => {
  if (isLocalOrg(organizationId)) {
    return readLocal(organizationId).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("Failed to load expenses:", error);
    return [];
  }
  return (data || []).map(mapExpense);
};

export const getTaskExpenses = async (
  organizationId: string,
  taskId: string,
): Promise<Expense[]> => {
  if (isLocalOrg(organizationId)) {
    return readLocal(organizationId).filter((e) => e.taskId === taskId);
  }

  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("task_id", taskId)
    .order("created_at", { ascending: false });

  if (error) {
    logger.error("Failed to load task expenses:", error);
    return [];
  }
  return (data || []).map(mapExpense);
};

export const updateExpense = async (
  organizationId: string,
  expenseId: string,
  input: UpdateExpenseInput,
  reviewerUserId?: string,
): Promise<Expense> => {
  if (isLocalOrg(organizationId)) {
    const all = readLocal(organizationId);
    const idx = all.findIndex((e) => e.expenseId === expenseId);
    if (idx === -1) throw new Error("Expense not found");
    const merged: Expense = {
      ...all[idx],
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
      ...(input.currency !== undefined
        ? { currency: input.currency.toUpperCase() }
        : {}),
      ...(input.vendor !== undefined ? { vendor: input.vendor } : {}),
      ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
      ...(input.projectName !== undefined
        ? { projectName: input.projectName }
        : {}),
      ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
      ...(input.taskTitle !== undefined
        ? { taskTitle: input.taskTitle }
        : {}),
      ...(input.invoiceUrl !== undefined
        ? { invoiceUrl: input.invoiceUrl }
        : {}),
      ...(input.invoicePath !== undefined
        ? { invoicePath: input.invoicePath }
        : {}),
      ...(input.invoiceName !== undefined
        ? { invoiceName: input.invoiceName }
        : {}),
      ...(input.invoiceType !== undefined
        ? { invoiceType: input.invoiceType }
        : {}),
      ...(input.invoiceSize !== undefined
        ? { invoiceSize: input.invoiceSize }
        : {}),
      ...(input.incurredOn !== undefined
        ? { incurredOn: input.incurredOn }
        : {}),
      ...(input.status
        ? {
            status: input.status,
            statusChangedBy: reviewerUserId ?? null,
            statusChangedAt: new Date(),
          }
        : {}),
      ...(input.statusReason !== undefined
        ? { statusReason: input.statusReason }
        : {}),
      updatedAt: new Date(),
    };
    all[idx] = merged;
    writeLocal(organizationId, all);
    return merged;
  }

  const update: Record<string, unknown> = {};
  if (input.title !== undefined) update.title = input.title;
  if (input.description !== undefined) update.description = input.description;
  if (input.category !== undefined) update.category = input.category;
  if (input.amount !== undefined) update.amount = input.amount;
  if (input.currency !== undefined)
    update.currency = input.currency.toUpperCase();
  if (input.vendor !== undefined) update.vendor = input.vendor;
  if (input.projectId !== undefined) update.project_id = input.projectId;
  if (input.projectName !== undefined) update.project_name = input.projectName;
  if (input.taskId !== undefined) update.task_id = input.taskId;
  if (input.taskTitle !== undefined) update.task_title = input.taskTitle;
  if (input.invoiceUrl !== undefined) update.invoice_url = input.invoiceUrl;
  if (input.invoicePath !== undefined) update.invoice_path = input.invoicePath;
  if (input.invoiceName !== undefined) update.invoice_name = input.invoiceName;
  if (input.invoiceType !== undefined) update.invoice_type = input.invoiceType;
  if (input.invoiceSize !== undefined) update.invoice_size = input.invoiceSize;
  if (input.incurredOn !== undefined)
    update.incurred_on = input.incurredOn.toISOString().split("T")[0];
  if (input.statusReason !== undefined)
    update.status_reason = input.statusReason;
  if (input.status) {
    update.status = input.status;
    update.status_changed_by = reviewerUserId ?? null;
    update.status_changed_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("expenses")
    .update(update)
    .eq("expense_id", expenseId)
    .select()
    .single();

  if (error) {
    logger.error("Failed to update expense:", error);
    throw error;
  }
  return mapExpense(data);
};

export const deleteExpense = async (
  organizationId: string,
  expenseId: string,
): Promise<void> => {
  if (isLocalOrg(organizationId)) {
    const all = readLocal(organizationId).filter(
      (e) => e.expenseId !== expenseId,
    );
    writeLocal(organizationId, all);
    return;
  }

  const { error } = await supabase
    .from("expenses")
    .delete()
    .eq("expense_id", expenseId);

  if (error) {
    logger.error("Failed to delete expense:", error);
    throw error;
  }
};

export const subscribeToExpenses = (
  organizationId: string,
  callback: (expenses: Expense[]) => void,
): (() => void) => {
  getOrganizationExpenses(organizationId).then(callback);

  if (isLocalOrg(organizationId)) return () => {};

  const channelName = `expenses-${organizationId}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "expenses",
        filter: `organization_id=eq.${organizationId}`,
      },
      () => {
        getOrganizationExpenses(organizationId).then(callback);
      },
    )
    .subscribe();

  return () => {
    channel.unsubscribe();
  };
};

export const uploadExpenseInvoice = async (
  organizationId: string,
  file: File,
): Promise<{
  invoiceUrl: string;
  invoicePath: string;
  invoiceName: string;
  invoiceType: string;
  invoiceSize: number;
}> => {
  if (isLocalOrg(organizationId)) {
    // Local dev: use a data URL so we never leak blob: object URLs (no revoke lifecycle).
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const r = reader.result;
        if (typeof r !== "string") {
          reject(new Error("Unexpected file read result"));
          return;
        }
        resolve(r);
      };
      reader.onerror = () => reject(new Error("Failed to read invoice file"));
      reader.readAsDataURL(file);
    });
    return {
      invoiceUrl: dataUrl,
      invoicePath: `local/${file.name}`,
      invoiceName: file.name,
      invoiceType: file.type,
      invoiceSize: file.size,
    };
  }

  const sanitized = file.name
    .replace(/[^a-zA-Z0-9_.\-]/g, "_")
    .replace(/_+/g, "_")
    .slice(-120);
  const path = `${organizationId}/expenses/${Date.now()}-${sanitized}`;
  const bucket = "attachments";

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { cacheControl: "3600", upsert: false });

  if (error) {
    logger.error("Failed to upload expense invoice:", error);
    throw error;
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return {
    invoiceUrl: data.publicUrl,
    invoicePath: path,
    invoiceName: file.name,
    invoiceType: file.type,
    invoiceSize: file.size,
  };
};

export const formatExpenseAmount = (
  amount: number,
  currency: string = "USD",
): string => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
};
