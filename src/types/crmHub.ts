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
  name: string;
  sortOrder: number;
  probability: number;
  status: DealStatus;
  createdAt: Date;
}

export interface CrmCompany {
  id: string;
  organizationId: string;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface CrmContact {
  id: string;
  organizationId: string;
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
  lastContactedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCompanyInput {
  organizationId: string;
  name: string;
  website?: string | null;
  industry?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  country?: string | null;
  companySize?: string | null;
  annualRevenue?: number | null;
  notes?: string | null;
}

export type UpdateCompanyInput = Partial<Omit<CreateCompanyInput, 'organizationId'>>;

export interface CreateContactInput {
  organizationId: string;
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
}

export type UpdateContactInput = Partial<Omit<CreateContactInput, 'organizationId'>>;

export interface CreateDealInput {
  organizationId: string;
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
  ownerId: string | null;
  assignedTo: string | null;
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
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
  body: string;
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
}

export interface CrmTag {
  id: string;
  organizationId: string;
  name: string;
  color: string;
  createdAt: Date;
}
