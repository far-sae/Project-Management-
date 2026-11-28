import { remindDueFollowUps, remindOverdueDaily } from "./followUps.js";
import { nowOf } from "./deps.js";
import { AppError, StoreError } from "../_signroom/errors.js";
import { SIGN_IN_MESSAGE } from "../_signroom/host/auth.js";
import { archiveAgent, createAgent, listAgents, patchAgent, setPaused } from "./agents.js";
import { approve, listApprovals, reject } from "./approvals.js";
import { ask } from "./assistant.js";
import { createAutomation, getAutomation, listAutomations, patchAutomation, setStatus, testAgent, testAutomation, testDraft } from "./automations.js";
import type { SignedInUser } from "./context.js";
import type { AutoDeps } from "./deps.js";
import { sendMeetingInvite } from "./meetings.js";
import { FAILED_MESSAGE, NOT_FOUND_MESSAGE, setupSentence, TABLES_MISSING_MESSAGE } from "./messages.js";
import { getOverview, setUp } from "./overview.js";
import { getRules, listPeople, listWorkspaces, saveRules } from "./rules.js";
import { runDue } from "./runner.js";
import { getRun, listRuns, nudge, replied, stop } from "./runs.js";

/**
 * The automation server's paths. One request in, one result out; it never
 * throws. Every signed-in path checks the workspace again (context.ts), so a
 * path here never decides who may do what: the function it calls does.
 */

export type RouteRequest = {
  method: string;
  path: string[];
  query: Record<string, string>;
  body: Record<string, unknown>;
  /** The signed-in account; workspaceId is the X-Workspace-Id header, checked on every request. */
  user: SignedInUser | null;
  /** Set only by the entry, after the cron secret check: the scheduled run. */
  cron?: boolean;
};

export type RouteResult = { status: number; json?: unknown };

export { FAILED_MESSAGE, NOT_FOUND_MESSAGE, TABLES_MISSING_MESSAGE };

const notFound = (): RouteResult => ({ status: 404, json: { error: NOT_FOUND_MESSAGE } });
const ok = (json: unknown): RouteResult => ({ status: 200, json });

async function userRoute(deps: AutoDeps, r: RouteRequest, user: SignedInUser): Promise<RouteResult> {
  const [head, second, third] = r.path;
  const n = r.path.length;
  const { method, body } = r;
  const get = method === "GET";
  const post = method === "POST";

  if (head === "overview" && n === 1 && get) return ok(await getOverview(deps, user));
  if (head === "setup" && n === 1 && post) return ok(await setUp(deps, user));
  if (head === "nudge" && n === 1 && post) return ok(await nudge(deps, user));
  if (head === "workspaces" && n === 1 && get) return ok(await listWorkspaces(deps, user));
  if (head === "people" && n === 1 && get) return ok(await listPeople(deps, user));
  if (head === "assistant" && n === 1 && post) return ok(await ask(deps, user, body));

  if (head === "rules" && n === 1) {
    if (get) return ok(await getRules(deps, user));
    if (post) return ok(await saveRules(deps, user, body));
    return notFound();
  }

  if (head === "agents") {
    if (n === 1 && get) return ok(await listAgents(deps, user));
    if (n === 1 && post) return ok(await createAgent(deps, user, body));
    if (n === 2 && method === "PATCH") return ok(await patchAgent(deps, user, second, body));
    if (n === 2 && method === "DELETE") return ok(await archiveAgent(deps, user, second));
    if (n === 3 && post && (third === "pause" || third === "resume")) return ok(await setPaused(deps, user, second, third === "pause"));
    if (n === 3 && post && third === "test") return ok(await testAgent(deps, user, second, body));
    return notFound();
  }

  if (head === "automations") {
    if (n === 1 && get) return ok(await listAutomations(deps, user));
    if (n === 1 && post) return ok(await createAutomation(deps, user, body));
    // Before the :id paths: "test-draft" is a word, never an id.
    if (n === 2 && second === "test-draft") return post ? ok(await testDraft(deps, user, body)) : notFound();
    if (n === 2 && get) return ok(await getAutomation(deps, user, second));
    if (n === 2 && method === "PATCH") return ok(await patchAutomation(deps, user, second, body));
    if (n === 3 && post && third === "turn-on") return ok(await setStatus(deps, user, second, "on"));
    if (n === 3 && post && third === "pause") return ok(await setStatus(deps, user, second, "paused"));
    if (n === 3 && post && third === "test") return ok(await testAutomation(deps, user, second, body));
    return notFound();
  }

  if (head === "runs") {
    if (n === 1 && get) return ok(await listRuns(deps, user, r.query));
    if (n === 2 && get) return ok(await getRun(deps, user, second));
    if (n === 3 && post && third === "stop") return ok(await stop(deps, user, second));
    if (n === 3 && post && third === "replied") return ok(await replied(deps, user, second, body));
    return notFound();
  }

  // The link of a meeting with a lead, emailed to that lead.
  if (head === "meetings") {
    if (n === 3 && post && third === "invite") return ok(await sendMeetingInvite(deps, user, second, body));
    return notFound();
  }

  if (head === "approvals") {
    if (n === 1 && get) return ok(await listApprovals(deps, user));
    if (n === 3 && post && third === "approve") return ok(await approve(deps, user, second, body));
    if (n === 3 && post && third === "reject") return ok(await reject(deps, user, second, body));
    return notFound();
  }
  return notFound();
}

/**
 * One request to a result. AppError keeps its status and sentence; a database
 * error that means migration 187 has not been run is a 503 naming the file;
 * anything else is a plain 500 with nothing of the error in it.
 */
export async function route(deps: AutoDeps, r: RouteRequest): Promise<RouteResult> {
  try {
    // The scheduled run: only the entry's checked cron call reaches it.
    if (r.path[0] === "ops") {
      if (r.cron === true && r.method === "POST" && r.path.length === 2 && r.path[1] === "run") {
        // Reminders for due follow-ups go out whether or not any workspace uses automation, and never stop the run.
        await remindDueFollowUps(deps.store, nowOf(deps)).catch((e) => console.error("[automation] follow-up reminders not sent", e instanceof Error ? e.name : "unknown"));
        // After the reminders above, so a follow-up first seen today gets its own reminder and not two lines at once.
        await remindOverdueDaily(deps.store, nowOf(deps)).catch((e) => console.error("[automation] overdue summary not sent", e instanceof Error ? e.name : "unknown"));
        return ok(await runDue(deps));
      }
      return notFound();
    }
    if (!r.user) return { status: 401, json: { error: SIGN_IN_MESSAGE } };
    // Until migration 187 is run, every path says so (rather than some of them working by half).
    await deps.store.ready();
    return await userRoute(deps, r, r.user);
  } catch (e) {
    if (e instanceof AppError) return { status: e.status, json: { error: e.message } };
    const setup = e instanceof StoreError ? setupSentence(e.message) : null;
    if (setup) return { status: 503, json: { error: setup } };
    // The error name only: its text can carry what a person or the AI wrote.
    console.error("[automation] failed", e instanceof Error ? e.name : "unknown");
    return { status: 500, json: { error: FAILED_MESSAGE } };
  }
}
