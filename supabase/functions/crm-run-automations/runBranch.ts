import { ACTION_REGISTRY } from "./actions/index.ts";
import { evaluateConditions } from "./conditions/evaluator.ts";
import { ActionResult, ActionType, RecipeAction, RecipeCondition } from "./shared/types.ts";

export const chooseBranch = (conditionsPass: boolean): "then" | "else" =>
  conditionsPass ? "then" : "else";

/** v1: branches may not nest branches or waits. */
export const validBranchAction = (a: RecipeAction): boolean =>
  a.type !== "branch" && a.type !== "wait";

/** Run a branch action inline: evaluate its conditions, run the chosen sub-list
 *  through the registry (sharing aiOutputs). Returns the sub-actions' results
 *  (each tagged with a branch path marker). Skips invalid (branch/wait) sub-
 *  actions defensively. */
export const runBranch = async (
  baseCtx: Record<string, unknown>, // the same ctx object passed to handlers
  branchConfig: {
    conditions?: RecipeCondition[];
    then?: RecipeAction[];
    else?: RecipeAction[];
  },
  event: unknown,
  entityCtx: unknown, // ctx for condition evaluation (loadEntityContext result)
  aiOutputs: Record<string, string>,
): Promise<ActionResult[]> => {
  // deno-lint-ignore no-explicit-any
  const pass = evaluateConditions(
    (branchConfig.conditions ?? []) as any,
    event as any,
    entityCtx as any,
  );
  const path = chooseBranch(pass);
  const sub =
    (path === "then" ? branchConfig.then : branchConfig.else) ?? [];
  const out: ActionResult[] = [
    {
      type: "branch",
      status: "success",
      message: `→ ${path}`,
      duration_ms: 0,
    } as ActionResult,
  ];
  for (const a of sub) {
    if (!validBranchAction(a)) {
      out.push({
        type: a.type,
        status: "skipped",
        message: "branch/wait not allowed inside a branch",
        duration_ms: 0,
      } as ActionResult);
      continue;
    }
    const handler = ACTION_REGISTRY[a.type as ActionType];
    if (!handler) {
      out.push({
        type: a.type,
        status: "failure",
        message: "Unknown action type",
        duration_ms: 0,
      } as ActionResult);
      continue;
    }
    const t0 = Date.now();
    try {
      // deno-lint-ignore no-explicit-any
      const r = await handler({ ...baseCtx, aiOutputs } as any, a.config ?? {});
      out.push({
        ...r,
        type: a.type,
        duration_ms: Date.now() - t0,
      } as ActionResult);
      if (r.meta && typeof r.meta === "object") {
        for (const [k, v] of Object.entries(r.meta)) {
          if (k.startsWith("ai_output") && typeof v === "string") {
            aiOutputs[k] = v;
          }
        }
      }
      if (r.status === "failure") break; // stop this sub-list on failure
    } catch (err) {
      out.push({
        type: a.type,
        status: "failure",
        message: err instanceof Error ? err.message : String(err),
        duration_ms: Date.now() - t0,
      } as ActionResult);
      break;
    }
  }
  return out;
};
