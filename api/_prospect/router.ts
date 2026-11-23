import { AppError } from "../_signroom/errors.js";
import { ApolloError, BATCH, MAX_PAGE, PER_PAGE, REQUEST_ID, RETRY_SECONDS, hasFilters, phoneResult, readFilters, revealBatch, searchPeople } from "./apollo.js";
import { KEY_SETTING, ORGS_SETTING, orgMayProspect, type ProspectConfig } from "./config.js";
import type { ProspectPhones, ProspectReveal, ProspectSearch, ProspectSetup, RevealedPerson } from "./shared/types.js";

/**
 * Finding leads in Apollo, reached as /api/voice/prospects/<path> (the calling
 * function has the sign-in, the role check and room for it; Vercel's plan
 * allows no more functions).
 *
 *   GET  prospects/setup?workspaceId=   can leads be found from this workspace
 *   POST prospects/search               people who match the filters (free)
 *   POST prospects/reveal               the email and details of chosen people (1 credit each);
 *                                       with `phones`, Apollo also starts looking for their numbers
 *   POST prospects/phones               the phone numbers of earlier reveals, once Apollo has them
 *                                       (8 credits for each person a number is found for)
 *
 * Only the owner and admins of the workspace's organisation, and only an
 * organisation named in APOLLO_ALLOWED_ORGS. The server never writes a lead:
 * it hands the people back, and the page adds them under the person's own
 * permissions, as an import does.
 */

export type ProspectStore = {
  workspaceOrg(workspaceId: string): Promise<string | null>;
  /** The person's role in the organisation ("owner", "admin", ...), or null when they are not an active member. */
  orgRole(organizationId: string, userId: string): Promise<string | null>;
};

export type ProspectDeps = {
  store: ProspectStore;
  config: () => ProspectConfig | null;
  fetch: typeof fetch;
};

export type RouteRequest = { method: string; path: string[]; body: Record<string, unknown>; query?: Record<string, string>; user: { id: string } };
export type RouteResult = { status: number; json?: unknown };

/** The most people whose details can be bought in one go. */
export const REVEAL_MAX = 50;

export const ADMINS_ONLY_MESSAGE = "Only the owner and admins can find leads.";
export const NOT_SET_UP_MESSAGE = `Finding leads is not set up yet: ${KEY_SETTING} is missing in Vercel's environment variables.`;
export const orgNotAllowedMessage = (organizationId: string): string =>
  `Finding leads is not switched on for this organisation: add ${organizationId} to ${ORGS_SETTING} in Vercel's environment variables.`;
export const NO_FILTER_MESSAGE = "Add at least one thing to search by: a job title, a place, a company or a keyword.";
export const TOO_MANY_MESSAGE = `Add at most ${REVEAL_MAX} people at a time.`;
export const NOBODY_MESSAGE = "Choose at least one person to add.";
/** How many earlier requests can be asked about at once. */
export const PHONE_REQUESTS_MAX = 10;
export const NO_REQUEST_MESSAGE = "There are no phone numbers to fetch.";
export const KEY_REFUSED_MESSAGE = `Apollo did not accept the key. Check ${KEY_SETTING} in Vercel's environment variables, and that the key may search people and enrich them.`;
export const LIMIT_MESSAGE = "Apollo's limit for this hour is reached. Try again in a few minutes.";
export const SEARCH_REFUSED_MESSAGE = "Apollo could not read that search. Change what you search by and try again.";
export const UNREACHABLE_MESSAGE = "Apollo could not be reached. Please try again.";

/** Apollo's answer as our own sentence. Nothing Apollo wrote is passed on. */
function apolloProblem(e: ApolloError): AppError {
  if (e.status === 401 || e.status === 403) return new AppError(KEY_REFUSED_MESSAGE, 502);
  if (e.status === 429) return new AppError(LIMIT_MESSAGE, 429);
  if (e.status === 422 || e.status === 400) return new AppError(SEARCH_REFUSED_MESSAGE, 400);
  return new AppError(UNREACHABLE_MESSAGE, 502);
}

/** The organisation of the workspace, once the caller is its owner or an admin. Anybody else learns nothing. */
async function adminOrg(d: ProspectDeps, r: RouteRequest, workspaceId: unknown): Promise<string> {
  const id = typeof workspaceId === "string" && /^[0-9a-fA-F-]{36}$/.test(workspaceId) ? workspaceId : "";
  const organizationId = id ? await d.store.workspaceOrg(id) : null;
  const role = organizationId ? await d.store.orgRole(organizationId, r.user.id) : null;
  if (!organizationId || (role !== "owner" && role !== "admin")) throw new AppError(ADMINS_ONLY_MESSAGE, 403);
  return organizationId;
}

/** The key, once it is set and this organisation may use it. */
function readyKey(d: ProspectDeps, organizationId: string): string {
  const config = d.config();
  if (!config) throw new AppError(NOT_SET_UP_MESSAGE, 503);
  if (!orgMayProspect(config, organizationId)) throw new AppError(orgNotAllowedMessage(organizationId), 403);
  return config.key;
}

async function setup(d: ProspectDeps, r: RouteRequest): Promise<RouteResult> {
  const organizationId = await adminOrg(d, r, r.query?.workspaceId);
  const config = d.config();
  const out: ProspectSetup = !config
    ? { configured: false, ready: false, problem: NOT_SET_UP_MESSAGE }
    : orgMayProspect(config, organizationId)
      ? { configured: true, ready: true, problem: null }
      : { configured: true, ready: false, problem: orgNotAllowedMessage(organizationId) };
  return { status: 200, json: out };
}

async function search(d: ProspectDeps, r: RouteRequest): Promise<RouteResult> {
  const key = readyKey(d, await adminOrg(d, r, r.body.workspaceId));
  const filters = readFilters(r.body.filters);
  if (!hasFilters(filters)) throw new AppError(NO_FILTER_MESSAGE, 400);
  const asked = Number(r.body.page);
  const page = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, MAX_PAGE) : 1;
  const found = await searchPeople(d.fetch, key, filters, page);
  const out: ProspectSearch = { total: found.total, page, perPage: PER_PAGE, people: found.people };
  return { status: 200, json: out };
}

async function reveal(d: ProspectDeps, r: RouteRequest): Promise<RouteResult> {
  const key = readyKey(d, await adminOrg(d, r, r.body.workspaceId));
  const raw = Array.isArray(r.body.ids) ? r.body.ids : [];
  if (raw.length === 0) throw new AppError(NOBODY_MESSAGE, 400);
  if (raw.length > REVEAL_MAX) throw new AppError(TOO_MANY_MESSAGE, 400);
  if (!raw.every((id) => typeof id === "string" && /^[0-9a-zA-Z]{1,64}$/.test(id))) throw new AppError(NOBODY_MESSAGE, 400);
  // A person named twice is asked for once: a credit is never spent twice.
  const ids = [...new Set(raw as string[])];
  const verifiedOnly = r.body.verifiedOnly !== false;
  // Phone numbers cost 8 credits more each: only when the person asked for them.
  const phones = r.body.phones === true;

  const out: ProspectReveal = { people: [], credits: 0, notFound: 0, unverified: 0, phoneRequests: [] };
  for (let i = 0; i < ids.length; i += BATCH) {
    let batch: Awaited<ReturnType<typeof revealBatch>>;
    try {
      batch = await revealBatch(d.fetch, key, ids.slice(i, i + BATCH), phones);
    } catch (e) {
      if (!(e instanceof ApolloError)) throw e;
      // Nothing bought yet: a plain failure. Otherwise keep what was paid for and say why it stopped.
      if (i === 0) throw apolloProblem(e);
      out.stopped = apolloProblem(e).message;
      break;
    }
    out.credits += batch.credits;
    out.notFound += batch.notFound;
    if (batch.phoneRequest) out.phoneRequests.push(batch.phoneRequest);
    for (const person of batch.people) {
      if (usable(person, verifiedOnly)) out.people.push(person);
      else out.unverified += 1;
    }
  }
  return { status: 200, json: out };
}

/**
 * The phone numbers of earlier reveals. A request Apollo has not finished, or
 * could not be asked about this time, is handed back to ask about again; one
 * it no longer knows is dropped.
 */
async function phones(d: ProspectDeps, r: RouteRequest): Promise<RouteResult> {
  const key = readyKey(d, await adminOrg(d, r, r.body.workspaceId));
  const raw = Array.isArray(r.body.requestIds) ? r.body.requestIds : [];
  if (raw.length === 0 || raw.length > PHONE_REQUESTS_MAX) throw new AppError(NO_REQUEST_MESSAGE, 400);
  if (!raw.every((id) => typeof id === "string" && REQUEST_ID.test(id))) throw new AppError(NO_REQUEST_MESSAGE, 400);
  const out: ProspectPhones = { phones: [], credits: 0, pending: [], retryAfter: 0 };
  for (const requestId of [...new Set(raw as string[])]) {
    try {
      const result = await phoneResult(d.fetch, key, requestId);
      if (result.state === "ready") {
        out.phones.push(...result.phones);
        out.credits += result.credits;
      } else if (result.state === "pending") {
        out.pending.push(requestId);
        out.retryAfter = Math.max(out.retryAfter, result.retryAfter);
      }
    } catch (e) {
      if (!(e instanceof ApolloError)) throw e;
      // Not an answer about the request: keep it, and ask again later.
      out.pending.push(requestId);
      out.retryAfter = Math.max(out.retryAfter, RETRY_SECONDS);
    }
  }
  return { status: 200, json: out };
}

/** A person is worth adding when there is an email, and it is verified when only those were asked for. */
const usable = (p: RevealedPerson, verifiedOnly: boolean): boolean => p.email !== "" && (!verifiedOnly || p.emailStatus === "verified");

/** One request in, one result out. `path` starts with "prospects". */
export async function route(d: ProspectDeps, r: RouteRequest): Promise<RouteResult> {
  try {
    const [, a] = r.path;
    if (r.path.length === 2 && a === "setup" && r.method === "GET") return await setup(d, r);
    if (r.path.length === 2 && a === "search" && r.method === "POST") return await search(d, r);
    if (r.path.length === 2 && a === "reveal" && r.method === "POST") return await reveal(d, r);
    if (r.path.length === 2 && a === "phones" && r.method === "POST") return await phones(d, r);
    return { status: 404, json: { error: "not found" } };
  } catch (e) {
    if (e instanceof ApolloError) e = apolloProblem(e);
    if (e instanceof AppError) return { status: e.status, json: { error: e.message } };
    throw e;
  }
}
