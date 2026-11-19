import type { ActivityType } from '@/types/crmHub';

/** What each kind of logged activity is called on screen. */
export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  note: 'Note',
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  task_completed: 'Follow-up completed',
  contact_created: 'Lead created',
  company_created: 'Company created',
  deal_created: 'Deal created',
  deal_updated: 'Deal updated',
  deal_stage_changed: 'Deal stage changed',
  deal_won: 'Deal won',
  deal_lost: 'Deal lost',
};
