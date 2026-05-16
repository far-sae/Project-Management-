// supabase/functions/crm-run-automations/triggers/matchers.ts
import { AutomationEvent } from "../shared/types.ts";

export const triggerConfigMatches = (
  config: Record<string, unknown>,
  event: AutomationEvent,
): boolean => {
  const payload = event.payload ?? {};
  switch (event.event_type) {
    case "deal_stage_entered":
      if (config.stage_id && payload.stage_id !== config.stage_id) return false;
      if (config.pipeline_id && payload.pipeline_id !== config.pipeline_id) return false;
      return true;

    case "deal_score_band_changed":
      if (config.band && payload.new_band !== config.band) return false;
      return true;

    case "deal_field_changed": {
      const fields = config.fields as string[] | undefined;
      if (!fields || fields.length === 0) return true;
      const changed = (payload.changed_fields as string[]) ?? [];
      return fields.some((f) => changed.includes(f));
    }

    case "form_submitted":
      if (config.form_id && payload.form_id !== config.form_id) return false;
      return true;

    case "client_tagged":
      if (config.tag && payload.tag !== config.tag) return false;
      return true;

    case "client_created":
      if (config.source && payload.source !== config.source) return false;
      return true;

    case "task_overdue":
    case "scheduled":
      return true;

    default:
      return false;
  }
};
