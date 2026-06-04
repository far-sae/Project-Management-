import { TRIGGER_TYPES, ACTION_TYPES, type RecipeDraft, type TriggerType, type ActionType } from "./automations";

/** Validate + clean an AI-produced draft. Drops unknown action types; returns
 *  null if the trigger is unknown or no valid actions remain. Defensive against
 *  arbitrary JSON.
 *
 *  NOTE: the Sets are built INSIDE the function, not at module top level. This
 *  module and ./automations import each other; reading TRIGGER_TYPES/ACTION_TYPES
 *  during module init hit a temporal-dead-zone in the bundle ("Cannot access …
 *  before initialization"). Deferring the read to call-time avoids it. */
export const sanitizeDraft = (raw: unknown): RecipeDraft | null => {
  const TRIGGERS = new Set<string>(TRIGGER_TYPES as readonly string[]);
  const ACTIONS = new Set<string>(ACTION_TYPES as readonly string[]);
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  const triggerType = r.trigger?.type;
  if (typeof triggerType !== "string" || !TRIGGERS.has(triggerType)) return null;
  const actions = Array.isArray(r.actions) ? r.actions : [];
  const cleanActions = actions
    .filter((a: any) => a && typeof a.type === "string" && ACTIONS.has(a.type))
    .map((a: any) => ({ type: a.type as ActionType, config: (a.config && typeof a.config === "object") ? a.config : {} }));
  if (cleanActions.length === 0) return null;
  const conditions = Array.isArray(r.conditions)
    ? r.conditions.filter((c: any) => c && typeof c.field === "string" && typeof c.operator === "string")
    : [];
  return {
    name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : "AI-drafted automation",
    description: typeof r.description === "string" ? r.description : null,
    enabled: false, // drafts start disabled until the user reviews + saves
    trigger: { type: triggerType as TriggerType, config: (r.trigger?.config && typeof r.trigger.config === "object") ? r.trigger.config : {} },
    conditions,
    actions: cleanActions,
    sendWindow: null,
  };
};
