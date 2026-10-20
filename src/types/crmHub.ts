// CRM Hub types — mirror the SQL schema in migration 144.

export type LifecycleStage =
  | 'subscriber'
  | 'lead'
  | 'marketing_qualified_lead'
  | 'sales_qualified_lead'
  | 'opportunity'
  | 'customer'
  | 'evangelist'
  | 'other';

export const LIFECYCLE_STAGES: LifecycleStage[] = [
  'subscriber',
  'lead',
  'marketing_qualified_lead',
  'sales_qualified_lead',
  'opportunity',
  'customer',
  'evangelist',
  'other',
];

export type LeadStatus =
  | 'new'
  | 'open'
  | 'in_progress'
  | 'open_deal'
  | 'unqualified'
  | 'attempted_to_contact'
  | 'connected'
  | 'bad_timing';

export const LEAD_STATUSES: LeadStatus[] = [
  'new',
  'open',
  'in_progress',
  'open_deal',
  'unqualified',
  'attempted_to_contact',
  'connected',
  'bad_timing',
];

export type DealStatus = 'open' | 'won' | 'lost';

export interface CrmDealStage {
  id: string;
  organizationId: string;
  workspaceId: string;
  name: string;
  sortOrder: number;
  probability: number;
  status: DealStatus;
  createdAt: Date;
}

export interface CrmCompany {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  ownerId: string | null;
  name: string;
  website: string | null;
  industry: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  companySize: string | null;
  annualRevenue: number | null;
  notes: string | null;
  /** Arbitrary user-defined columns captured during CSV import. */
  customFields: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}


export interface CrmContact {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  ownerId: string | null;
  companyId: string | null;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  lifecycleStage: LifecycleStage;
  leadStatus: LeadStatus;
  source: string | null;
  notes: string | null;
  /** Free-text user-defined bucket (e.g. "VIP", "Q4 outreach", "Warm intro"). */
  category: string | null;
  /** Arbitrary user-defined columns captured during CSV import. */
  customFields: Record<string, string>;
  lastContactedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ClientBillingType = 'one_time' | 'monthly';

export interface CrmClientAccount {
  id: string;
  organizationId: string;
  workspaceId: string;
  contactId: string;
  projectId: string | null;
  serviceName: string;
  billingType: ClientBillingType;
  agreedAmount: number;
  openingPaid: number;
  serviceStart: string | null;
  serviceEnd: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CrmAccountPayment {
  id: string;
  accountId: string;
  organizationId: string;
  workspaceId: string;
  paidOn: string;
  amount: number;
  notes: string | null;
  createdAt: Date;
}

export interface CrmDeal {
  id: string;
  organizationId: string;
  ownerId: string | null;
  stageId: string;
  companyId: string | null;
  contactId: string | null;
  name: string;
  value: number;
  probability: number;
  status: DealStatus;
  expectedCloseDate: string | null;
  source: string | null;
  notes: string | null;
  sortOrder: number;
  /** Set when the deal has been handed off to project management (also
   *  serves as the workspace-scope for pipeline filtering). */
  workspaceId: string | null;
  /** Set when the deal has been handed off to a specific project. */
  projectId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCompanyInput {
  organizationId: string;
  workspaceId?: string | null;
  name: string;
  website?: string | null;
  industry?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  companySize?: string | null;
  annualRevenue?: number | null;
  notes?: string | null;
  customFields?: Record<string, string> | null;
}

export type UpdateCompanyInput = Partial<Omit<CreateCompanyInput, 'organizationId'>>;

export interface CreateContactInput {
  organizationId: string;
  workspaceId?: string | null;
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  jobTitle?: string | null;
  companyId?: string | null;
  lifecycleStage?: LifecycleStage;
  leadStatus?: LeadStatus;
  source?: string | null;
  notes?: string | null;
  category?: string | null;
  customFields?: Record<string, string> | null;
}

export type UpdateContactInput = Partial<Omit<CreateContactInput, 'organizationId'>>;

export interface CreateDealInput {
  organizationId: string;
  workspaceId?: string | null;
  name: string;
  stageId: string;
  value?: number;
  probability?: number;
  companyId?: string | null;
  contactId?: string | null;
  expectedCloseDate?: string | null;
  source?: string | null;
  notes?: string | null;
}

export type UpdateDealInput = Partial<Omit<CreateDealInput, 'organizationId'>>;

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export const TASK_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];

export type TaskStatus = 'pending' | 'in_progress' | 'completed';
export const TASK_STATUSES: TaskStatus[] = ['pending', 'in_progress', 'completed'];

export interface CrmTask {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  ownerId: string | null;
  assignedTo: string | null;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  projectId: string | null;
  sharedTaskId: string | null;
  title: string;
  description: string | null;
  dueDate: Date | null;
  priority: TaskPriority;
  status: TaskStatus;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTaskInput {
  organizationId: string;
  workspaceId: string;
  projectId: string;
  title: string;
  description?: string | null;
  dueDate?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  assignedTo?: string | null;
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
}

export type UpdateTaskInput = Partial<Omit<CreateTaskInput, 'organizationId'>>;

export type ActivityType =
  | 'note'
  | 'call'
  | 'email'
  | 'meeting'
  | 'task_completed'
  | 'contact_created'
  | 'company_created'
  | 'deal_created'
  | 'deal_updated'
  | 'deal_stage_changed'
  | 'deal_won'
  | 'deal_lost';

export const MANUAL_ACTIVITY_TYPES: ActivityType[] = ['note', 'call', 'email', 'meeting'];

export interface CrmActivity {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  userId: string | null;
  type: ActivityType;
  description: string | null;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  taskId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface CreateActivityInput {
  organizationId: string;
  workspaceId?: string | null;
  type: ActivityType;
  description?: string | null;
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  taskId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CrmNote {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  userId: string | null;
  body: string;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateNoteInput {
  organizationId: string;
  workspaceId?: string | null;
  body: string;
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
}

export interface CrmTag {
  id: string;
  organizationId: string;
  workspaceId: string;
  name: string;
  color: string;
  createdAt: Date;
}
