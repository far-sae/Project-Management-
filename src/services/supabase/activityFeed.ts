// src/services/supabase/activityFeed.ts
import { supabase } from "./config";
import { logger } from "@/lib/logger";

export type ActivityEventType = "note" | "deal_stage" | "task" | "form_submission";

export interface ActivityEvent {
  eventType: ActivityEventType;
  organizationId: string;
  clientId: string | null;
  dealId: string | null;
  actorId: string | null;
  actorName: string | null;
  subtype: string | null;
  title: string;
  body: string | null;
  occurredAt: Date;
}

const mapRow = (r: Record<string, unknown>): ActivityEvent => ({
  eventType: r.event_type as ActivityEventType,
  organizationId: r.organization_id as string,
  clientId: (r.client_id as string) ?? null,
  dealId: (r.deal_id as string) ?? null,
  actorId: (r.actor_id as string) ?? null,
  actorName: (r.actor_name as string) ?? null,
  subtype: (r.subtype as string) ?? null,
  title: r.title as string,
  body: (r.body as string) ?? null,
  occurredAt: new Date(r.occurred_at as string),
});

export interface ActivityQuery {
  organizationId: string;
  clientId?: string;
  eventTypes?: ActivityEventType[];
  actorId?: string;
  fromDate?: Date;
  toDate?: Date;
  beforeCursor?: Date;
  limit?: number;
}

export const queryActivity = async (q: ActivityQuery): Promise<ActivityEvent[]> => {
  let query = supabase
    .from("crm_activity_v")
    .select("*")
    .eq("organization_id", q.organizationId)
    .order("occurred_at", { ascending: false })
    .limit(q.limit ?? 50);

  if (q.clientId) query = query.eq("client_id", q.clientId);
  if (q.eventTypes?.length) query = query.in("event_type", q.eventTypes);
  if (q.actorId) query = query.eq("actor_id", q.actorId);
  if (q.fromDate) query = query.gte("occurred_at", q.fromDate.toISOString());
  if (q.toDate) query = query.lte("occurred_at", q.toDate.toISOString());
  if (q.beforeCursor) query = query.lt("occurred_at", q.beforeCursor.toISOString());

  const { data, error } = await query;
  if (error) {
    logger.error("Failed to load activity:", error);
    return [];
  }
  return (data || []).map(mapRow);
};
