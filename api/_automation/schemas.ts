import * as z from "zod/v4";
import { RIGHTS } from "./shared/types.js";
import type { Right } from "./shared/types.js";

/**
 * The shapes the AI must answer in (structured output). They are handed to the
 * API as the output format and used again on the reply the server received:
 * an answer is never trusted because the API promised its shape.
 */

/**
 * The lead steps an agent may ask for. "qualified" is the app's own step
 * (it is kept as lifecycle stage plus status); "open_deal" is not offered,
 * because opening a deal sets it.
 */
export const LEAD_STEPS = ["new", "open", "attempted_to_contact", "in_progress", "connected", "qualified", "bad_timing", "unqualified"] as const;

export const ActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add_note"), text: z.string() }),
  z.object({ type: z.literal("set_lead_status"), status: z.enum(LEAD_STEPS) }),
  z.object({ type: z.literal("create_follow_up"), title: z.string(), dueInDays: z.number(), note: z.string() }),
  z.object({ type: z.literal("send_email"), subject: z.string(), body: z.string() }),
  z.object({ type: z.literal("create_deal"), name: z.string(), value: z.number().nullable() }),
  z.object({ type: z.literal("move_deal"), stage: z.string() }),
  z.object({ type: z.literal("mark_deal"), result: z.enum(["won", "lost"]), reason: z.string() }),
  z.object({ type: z.literal("create_project"), extraTasks: z.array(z.string()) }),
  z.object({ type: z.literal("notify_owner"), text: z.string() }),
]);

/** What one agent step answers with. */
export const StepOutputSchema = z.object({
  decided: z.string(),
  outcome: z.enum(["continue", "stop"]),
  handoff: z.string(),
  actions: z.array(ActionSchema),
});

/**
 * The same reply as the server accepts it: the envelope must be right, and
 * each action is then checked on its own, so one action that is not on the
 * list is dropped (and said so) without losing the rest.
 */
export const StepReplySchema = z.object({
  decided: z.string(),
  outcome: z.enum(["continue", "stop"]),
  handoff: z.string(),
  actions: z.array(z.unknown()),
});

export type StepOutput = z.infer<typeof StepOutputSchema>;
export type RawAction = z.infer<typeof ActionSchema>;

const RIGHT_KEYS = RIGHTS.map((r) => r.key) as [Right, ...Right[]];

const StartsSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("after_previous") }),
  z.object({ type: z.literal("no_reply_days"), days: z.number() }),
  z.object({ type: z.literal("on_reply") }),
  z.object({ type: z.literal("on_deal_won") }),
]);

const DraftSchema = z.object({
  name: z.string(),
  trigger: z.object({ type: z.literal("lead_created"), skipImports: z.boolean() }),
  steps: z.array(
    z.object({
      agent: z.object({ id: z.string().nullable(), name: z.string(), job: z.string(), rights: z.array(z.enum(RIGHT_KEYS)), askFirst: z.boolean() }),
      starts: StartsSchema,
      does: z.string(),
      gives: z.string(),
    }),
  ),
});

/** What the assistant answers with. */
export const AssistantOutputSchema = z.object({
  reply: z.string(),
  assumptions: z.array(z.string()),
  draft: DraftSchema.nullable(),
});

export type AssistantOutput = z.infer<typeof AssistantOutputSchema>;
