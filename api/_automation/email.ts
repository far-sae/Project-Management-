import { AppError, StoreError } from "../_signroom/errors.js";
import { sendMail } from "../_signroom/mail.js";
import { setupSentence as documentsSetupSentence } from "../_signroom/setupMessages.js";
import { leadAddress } from "./actions.js";
import { stamp, type Env } from "./execute.js";
import { leadName } from "./leadContext.js";
import { nextOpening, windowOpen } from "./sendWindow.js";
import type { AgentAction, StoredRun } from "./store.js";

/**
 * Sending one email from an agent to a lead. It goes out through the
 * documents server's sendMail (the workspace's own mailbox when one is
 * connected, else the app's sender), with the same sending limits and the
 * same delivery log.
 *
 * The checks are made again here, at the moment of sending, on the record as
 * it is now: the run must still be going, the lead must not be unqualified,
 * the address is the lead's own from the CRM (the agent never names one), the
 * workspace's emails-per-lead limit must hold, and the send window must be
 * open.
 */

export const EMAIL_PURPOSE = "automation";
export const EMAIL_OFF_MESSAGE = "email is not set up on this server";

export type SendOutcome =
  /** It went out. */
  | { kind: "sent"; line: string }
  /** The window is shut: send it at `dueAt`. */
  | { kind: "queued"; dueAt: string }
  /** It will never be sent, and `why` says so. */
  | { kind: "refused"; why: string }
  /** Nothing was sent this time (a limit, no mail route); it may be tried again. */
  | { kind: "later"; why: string }
  /** Sending began and then failed: it may or may not have arrived, and is never sent again. */
  | { kind: "unclear" };

const ACTIVE = ["running", "waiting", "needs_approval"];

/**
 * `counted` says whether this email is already in the ledger (auto_approvals):
 * it is, by the time it is sent, so the limit is "no more than emailsPerLead
 * rows", this one included.
 */
export async function sendLeadEmail(env: Env, run: StoredRun, agentName: string, action: Extract<AgentAction, { type: "send_email" }>): Promise<SendOutcome> {
  const { store, mail } = env.deps;
  const ws = env.workspace.workspaceId;

  const fresh = await store.getRun(ws, run.id);
  if (!fresh || !ACTIVE.includes(fresh.status)) return { kind: "refused", why: "the run was stopped" };
  const lead = await store.getLead(ws, run.contactId);
  if (!lead) return { kind: "refused", why: "the lead no longer exists" };
  if (lead.leadStatus === "unqualified") return { kind: "refused", why: "the lead is marked unqualified" };
  const to = leadAddress(lead);
  if (!to) return { kind: "refused", why: "the lead has no email address on file" };
  if ((await store.countEmails(ws, lead.id)) > env.rules.emailsPerLead) return { kind: "refused", why: `the limit of ${env.rules.emailsPerLead} emails for one lead is reached` };
  if (!env.rules.enabled) return { kind: "later", why: "automation is switched off in this workspace" };
  if (!windowOpen(env.rules.sendWindow, env.now)) return { kind: "queued", dueAt: nextOpening(env.rules.sendWindow, env.now).toISOString() };
  if (!mail) return { kind: "later", why: EMAIL_OFF_MESSAGE };

  let began = false;
  try {
    // The documents server's own row for this workspace (same id): its sender name, reply-to and mailbox.
    const sender = await mail.store.ensureWorkspace(ws, env.workspace.name, lead.ownerId ?? "");
    await sendMail(mail, sender, { to, subject: action.subject.replace(/[\r\n]+/g, " "), text: action.body, purpose: EMAIL_PURPOSE }, { sending: async () => void (began = true) });
  } catch (e) {
    // The status or the name only: the text of a mail failure can carry the address.
    console.error("[automation] email not sent", e instanceof AppError ? e.status : e instanceof Error ? e.name : "unknown");
    if (began) return { kind: "unclear" };
    const setup = e instanceof StoreError ? documentsSetupSentence(e.message) : null;
    return { kind: "later", why: setup ?? (e instanceof AppError ? e.message : EMAIL_OFF_MESSAGE) };
  }

  // The email is out. Bookkeeping after that must never make it look unsent.
  try {
    await store.logActivity(lead, { type: "email", description: `Sent “${action.subject}”`, contactId: lead.id, companyId: lead.companyId, dealId: null, metadata: stamp(agentName, run.id, { subject: action.subject, body: action.body }) });
    await store.updateLead(lead, { lastContactedAt: env.now.toISOString(), ...(lead.leadStatus === "new" || lead.leadStatus === "open" ? { leadStatus: "attempted_to_contact" as const } : {}) });
  } catch (e) {
    console.error("[automation] sent email not logged on the lead", e instanceof Error ? e.name : "unknown");
  }
  return { kind: "sent", line: `Sent the email “${action.subject}” to ${leadName(lead)}` };
}
