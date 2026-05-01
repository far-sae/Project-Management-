import { supabase } from "./config";
import { logger } from "@/lib/logger";

export type EmploymentType = "employee" | "contractor";
export type EmployeeStatus = "active" | "onboarding" | "terminated";
export type PayType = "hourly" | "salary";
export type PayPeriod = "weekly" | "biweekly" | "semimonthly" | "monthly";

export interface EmployeeProfile {
  userId: string;
  organizationId: string;
  displayName?: string | null;
  email?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  hireDate?: Date | null;
  terminationDate?: Date | null;
  payType: PayType;
  payRate: number;
  currency: string;
  payPeriod: PayPeriod;
  overtimeMultiplier: number;
  defaultWeeklyHours: number;
  bankLast4?: string | null;
  taxIdLast4?: string | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertEmployeeProfileInput {
  userId: string;
  displayName?: string | null;
  email?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  employmentType?: EmploymentType;
  status?: EmployeeStatus;
  hireDate?: Date | null;
  terminationDate?: Date | null;
  payType?: PayType;
  payRate?: number;
  currency?: string;
  payPeriod?: PayPeriod;
  overtimeMultiplier?: number;
  defaultWeeklyHours?: number;
  bankLast4?: string | null;
  taxIdLast4?: string | null;
  notes?: string | null;
}

const isLocalOrg = (orgId: string) => orgId.startsWith("local-");
const localKey = (orgId: string) => `pm_employees_${orgId}`;

const mapProfile = (row: Record<string, unknown>): EmployeeProfile => ({
  userId: row.user_id as string,
  organizationId: row.organization_id as string,
  displayName: (row.display_name as string) ?? null,
  email: (row.email as string) ?? null,
  jobTitle: (row.job_title as string) ?? null,
  department: (row.department as string) ?? null,
  employmentType: ((row.employment_type as string) || "employee") as EmploymentType,
  status: ((row.status as string) || "active") as EmployeeStatus,
  hireDate: row.hire_date ? new Date(row.hire_date as string) : null,
  terminationDate: row.termination_date
    ? new Date(row.termination_date as string)
    : null,
  payType: ((row.pay_type as string) || "hourly") as PayType,
  payRate: row.pay_rate != null ? Number(row.pay_rate) : 0,
  currency: ((row.currency as string) || "USD").toUpperCase(),
  payPeriod: ((row.pay_period as string) || "biweekly") as PayPeriod,
  overtimeMultiplier:
    row.overtime_multiplier != null ? Number(row.overtime_multiplier) : 1.5,
  defaultWeeklyHours:
    row.default_weekly_hours != null ? Number(row.default_weekly_hours) : 40,
  bankLast4: (row.bank_last4 as string) ?? null,
  taxIdLast4: (row.tax_id_last4 as string) ?? null,
  notes: (row.notes as string) ?? null,
  createdAt: new Date(row.created_at as string),
  updatedAt: new Date(row.updated_at as string),
});

const readLocal = (orgId: string): EmployeeProfile[] => {
  try {
    const raw = localStorage.getItem(localKey(orgId));
    if (!raw) return [];
    return (JSON.parse(raw) as EmployeeProfile[]).map((p) => ({
      ...p,
      hireDate: p.hireDate ? new Date(p.hireDate) : null,
      terminationDate: p.terminationDate ? new Date(p.terminationDate) : null,
      createdAt: new Date(p.createdAt),
      updatedAt: new Date(p.updatedAt),
    }));
  } catch {
    return [];
  }
};
const writeLocal = (orgId: string, profiles: EmployeeProfile[]) =>
  localStorage.setItem(localKey(orgId), JSON.stringify(profiles));

export const getOrganizationEmployees = async (
  organizationId: string,
): Promise<EmployeeProfile[]> => {
  if (isLocalOrg(organizationId)) {
    return readLocal(organizationId);
  }
  const { data, error } = await supabase
    .from("employee_profiles")
    .select("*")
    .eq("organization_id", organizationId);
  if (error) {
    logger.error("Failed to load employee profiles:", error);
    return [];
  }
  return (data || []).map(mapProfile);
};

export const getEmployeeProfile = async (
  organizationId: string,
  userId: string,
): Promise<EmployeeProfile | null> => {
  if (isLocalOrg(organizationId)) {
    return readLocal(organizationId).find((p) => p.userId === userId) ?? null;
  }
  const { data, error } = await supabase
    .from("employee_profiles")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    logger.error("Failed to load employee profile:", error);
    return null;
  }
  return data ? mapProfile(data) : null;
};

export const upsertEmployeeProfile = async (
  organizationId: string,
  input: UpsertEmployeeProfileInput,
): Promise<EmployeeProfile> => {
  if (isLocalOrg(organizationId)) {
    const all = readLocal(organizationId);
    const idx = all.findIndex((p) => p.userId === input.userId);
    const now = new Date();
    const base: EmployeeProfile =
      idx >= 0
        ? all[idx]
        : {
            userId: input.userId,
            organizationId,
            displayName: null,
            email: null,
            jobTitle: null,
            department: null,
            employmentType: "employee",
            status: "active",
            hireDate: null,
            terminationDate: null,
            payType: "hourly",
            payRate: 0,
            currency: "USD",
            payPeriod: "biweekly",
            overtimeMultiplier: 1.5,
            defaultWeeklyHours: 40,
            bankLast4: null,
            taxIdLast4: null,
            notes: null,
            createdAt: now,
            updatedAt: now,
          };
    const merged: EmployeeProfile = {
      ...base,
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
      ...(input.department !== undefined ? { department: input.department } : {}),
      ...(input.employmentType !== undefined
        ? { employmentType: input.employmentType }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.hireDate !== undefined ? { hireDate: input.hireDate } : {}),
      ...(input.terminationDate !== undefined
        ? { terminationDate: input.terminationDate }
        : {}),
      ...(input.payType !== undefined ? { payType: input.payType } : {}),
      ...(input.payRate !== undefined ? { payRate: input.payRate } : {}),
      ...(input.currency !== undefined
        ? { currency: input.currency.toUpperCase() }
        : {}),
      ...(input.payPeriod !== undefined ? { payPeriod: input.payPeriod } : {}),
      ...(input.overtimeMultiplier !== undefined
        ? { overtimeMultiplier: input.overtimeMultiplier }
        : {}),
      ...(input.defaultWeeklyHours !== undefined
        ? { defaultWeeklyHours: input.defaultWeeklyHours }
        : {}),
      ...(input.bankLast4 !== undefined ? { bankLast4: input.bankLast4 } : {}),
      ...(input.taxIdLast4 !== undefined ? { taxIdLast4: input.taxIdLast4 } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      updatedAt: now,
    };
    if (idx >= 0) all[idx] = merged;
    else all.push(merged);
    writeLocal(organizationId, all);
    return merged;
  }

  const row: Record<string, unknown> = {
    organization_id: organizationId,
    user_id: input.userId,
  };
  if (input.displayName !== undefined) row.display_name = input.displayName;
  if (input.email !== undefined) row.email = input.email;
  if (input.jobTitle !== undefined) row.job_title = input.jobTitle;
  if (input.department !== undefined) row.department = input.department;
  if (input.employmentType !== undefined)
    row.employment_type = input.employmentType;
  if (input.status !== undefined) row.status = input.status;
  if (input.hireDate !== undefined)
    row.hire_date = input.hireDate
      ? input.hireDate.toISOString().split("T")[0]
      : null;
  if (input.terminationDate !== undefined)
    row.termination_date = input.terminationDate
      ? input.terminationDate.toISOString().split("T")[0]
      : null;
  if (input.payType !== undefined) row.pay_type = input.payType;
  if (input.payRate !== undefined) row.pay_rate = input.payRate;
  if (input.currency !== undefined) row.currency = input.currency.toUpperCase();
  if (input.payPeriod !== undefined) row.pay_period = input.payPeriod;
  if (input.overtimeMultiplier !== undefined)
    row.overtime_multiplier = input.overtimeMultiplier;
  if (input.defaultWeeklyHours !== undefined)
    row.default_weekly_hours = input.defaultWeeklyHours;
  if (input.bankLast4 !== undefined) row.bank_last4 = input.bankLast4;
  if (input.taxIdLast4 !== undefined) row.tax_id_last4 = input.taxIdLast4;
  if (input.notes !== undefined) row.notes = input.notes;

  const { data, error } = await supabase
    .from("employee_profiles")
    .upsert(row, { onConflict: "organization_id,user_id" })
    .select()
    .single();
  if (error) {
    logger.error("Failed to upsert employee profile:", error);
    throw error;
  }
  return mapProfile(data);
};

export const deleteEmployeeProfile = async (
  organizationId: string,
  userId: string,
): Promise<void> => {
  if (isLocalOrg(organizationId)) {
    const all = readLocal(organizationId).filter((p) => p.userId !== userId);
    writeLocal(organizationId, all);
    return;
  }
  const { error } = await supabase
    .from("employee_profiles")
    .delete()
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
  if (error) {
    logger.error("Failed to delete employee profile:", error);
    throw error;
  }
};

export const subscribeToEmployees = (
  organizationId: string,
  callback: (profiles: EmployeeProfile[]) => void,
): (() => void) => {
  getOrganizationEmployees(organizationId).then(callback);
  if (isLocalOrg(organizationId)) return () => {};

  const channelName = `employees-${organizationId}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "employee_profiles",
        filter: `organization_id=eq.${organizationId}`,
      },
      () => {
        getOrganizationEmployees(organizationId).then(callback);
      },
    )
    .subscribe();
  return () => {
    channel.unsubscribe();
  };
};
