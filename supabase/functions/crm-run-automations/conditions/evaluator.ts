// supabase/functions/crm-run-automations/conditions/evaluator.ts
import { AutomationEvent } from "../shared/types.ts";
import { SubstituteContext } from "../shared/substitute.ts";

interface Condition {
  field: string;
  operator: string;
  value: unknown;
}

const resolveField = (
  field: string,
  event: AutomationEvent,
  ctx: SubstituteContext,
): unknown => {
  // Dotted-path resolution against ctx; falls back to event.payload[field]
  // for trigger-payload-specific fields like `new_band`.
  const parts = field.split(".");
  if (parts.length > 1) {
    let v: any = ctx;
    for (const p of parts) {
      if (v === null || v === undefined) return undefined;
      v = v[p];
    }
    return v;
  }
  return (event.payload as Record<string, unknown>)[field];
};

const cmpEq = (a: unknown, b: unknown) =>
  Array.isArray(a) ? a.includes(b) : a === b;

const cmpNumeric = (a: unknown, b: unknown, op: ">"|">="|"<"|"<="): boolean => {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  switch (op) {
    case ">":  return na >  nb;
    case ">=": return na >= nb;
    case "<":  return na <  nb;
    case "<=": return na <= nb;
  }
};

export const evaluateConditions = (
  conditions: Condition[],
  event: AutomationEvent,
  ctx: SubstituteContext,
): boolean => {
  for (const c of conditions) {
    const lhs = resolveField(c.field, event, ctx);
    let pass: boolean;
    switch (c.operator) {
      case "eq":       pass = cmpEq(lhs, c.value); break;
      case "neq":      pass = !cmpEq(lhs, c.value); break;
      case "gt":       pass = cmpNumeric(lhs, c.value, ">");  break;
      case "gte":      pass = cmpNumeric(lhs, c.value, ">="); break;
      case "lt":       pass = cmpNumeric(lhs, c.value, "<");  break;
      case "lte":      pass = cmpNumeric(lhs, c.value, "<="); break;
      case "in":
        pass = Array.isArray(c.value) && (c.value as unknown[]).includes(lhs);
        break;
      case "contains":
        if (Array.isArray(lhs)) {
          pass = lhs.includes(c.value);
        } else if (typeof lhs === "string") {
          pass = lhs.toLowerCase().includes(String(c.value).toLowerCase());
        } else {
          pass = false;
        }
        break;
      case "exists":
        pass = lhs !== null && lhs !== undefined && lhs !== "";
        break;
      default:
        pass = false;
    }
    if (!pass) return false;
  }
  return true;
};
