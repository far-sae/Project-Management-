import type { FoundPerson, PhoneType, ProspectFilters, RevealedCompany, RevealedPerson } from "./shared/types.js";

/**
 * Apollo's own API (docs.apollo.io), and nothing else: no page of Apollo's is
 * read or copied.
 *
 *  - People search (mixed_people/api_search) is free. It returns no email and
 *    only part of the last name.
 *  - Bulk enrichment (people/bulk_match) returns the email: 1 credit a person
 *    when data is found, ten people a request.
 *  - Phone numbers cost 8 credits more for each person one is found for, so
 *    they are asked for only when the person adding leads says so. Apollo looks
 *    for them after it has answered; the result is fetched later
 *    (webhook_result), which is free.
 */

export const APOLLO_BASE = "https://api.apollo.io/api/v1";
export const PER_PAGE = 25;
/** Apollo shows at most 500 pages of 100; we stay well inside that. */
export const MAX_PAGE = 200;
/** How many values one filter may carry. */
export const LIST_MAX = 25;
/** Bulk enrichment takes ten people a request. */
export const BATCH = 10;

/** Apollo's words for how senior a person is. */
export const SENIORITIES = ["owner", "founder", "c_suite", "partner", "vp", "head", "director", "manager", "senior", "entry", "intern"] as const;

/** A failed request to Apollo: the HTTP status only (0 when it could not be reached). Never Apollo's own text. */
export class ApolloError extends Error {
  constructor(readonly status: number) {
    super("apollo request failed");
    this.name = "ApolloError";
  }
}

const str = (v: unknown, max = 300): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A list of short texts: trimmed, without repeats (whatever the capitals), at most LIST_MAX. */
function list(raw: unknown, clean: (text: string) => string = (t) => t): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const text = clean(str(item, 120));
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === LIST_MAX) break;
  }
  return out;
}

/** "https://www.Northwind.example/about" → "northwind.example"; anything that is not a domain → "". */
export function bareDomain(raw: string): string {
  const host = raw.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#@]/)[0] ?? "";
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : "";
}

/** What the page sent, made safe: only what Apollo's search understands. */
export function readFilters(raw: unknown): ProspectFilters {
  const f = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  return {
    titles: list(f.titles),
    locations: list(f.locations),
    keywords: str(f.keywords, 200),
    domains: list(f.domains, bareDomain),
    sizes: list(f.sizes).filter((s) => /^\d{1,7},\d{1,7}$/.test(s)),
    seniorities: list(f.seniorities).filter((s) => (SENIORITIES as readonly string[]).includes(s)),
    verifiedOnly: f.verifiedOnly !== false,
  };
}

/** True when there is something to search by other than "verified only". */
export const hasFilters = (f: ProspectFilters): boolean =>
  f.titles.length + f.locations.length + f.domains.length + f.sizes.length + f.seniorities.length > 0 || f.keywords !== "";

export function searchUrl(f: ProspectFilters, page: number): string {
  const q = new URLSearchParams();
  for (const v of f.titles) q.append("person_titles[]", v);
  for (const v of f.locations) q.append("person_locations[]", v);
  for (const v of f.seniorities) q.append("person_seniorities[]", v);
  for (const v of f.domains) q.append("q_organization_domains_list[]", v);
  for (const v of f.sizes) q.append("organization_num_employees_ranges[]", v);
  if (f.keywords) q.set("q_keywords", f.keywords);
  if (f.verifiedOnly) q.append("contact_email_status[]", "verified");
  q.set("page", String(page));
  q.set("per_page", String(PER_PAGE));
  return `${APOLLO_BASE}/mixed_people/api_search?${q.toString()}`;
}

async function post(fetchFn: typeof fetch, key: string, url: string, body: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json", "Cache-Control": "no-cache", Accept: "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApolloError(0);
  }
  if (!response.ok) throw new ApolloError(response.status);
  try {
    const json = (await response.json()) as unknown;
    return json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  } catch {
    throw new ApolloError(0);
  }
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export async function searchPeople(fetchFn: typeof fetch, key: string, f: ProspectFilters, page: number): Promise<{ total: number; people: FoundPerson[] }> {
  const json = await post(fetchFn, key, searchUrl(f, page), {});
  const people: FoundPerson[] = [];
  for (const raw of Array.isArray(json.people) ? json.people : []) {
    const p = obj(raw);
    const id = p ? str(p.id, 64) : "";
    if (!p || !id) continue;
    people.push({
      id,
      firstName: str(p.first_name, 100),
      lastNameHidden: str(p.last_name_obfuscated, 100),
      title: str(p.title, 200),
      company: str(obj(p.organization)?.name, 200),
      hasEmail: p.has_email === true,
    });
  }
  const total = typeof json.total_entries === "number" && json.total_entries >= 0 ? Math.floor(json.total_entries) : people.length;
  return { total, people };
}

/** Apollo's stand-in for an email it has not handed over. */
const isPlaceholder = (email: string): boolean => email.toLowerCase().startsWith("email_not_unlocked");

function companyOf(raw: unknown): RevealedCompany | null {
  const o = obj(raw);
  const name = o ? str(o.name, 200) : "";
  if (!o || !name) return null;
  const size = typeof o.estimated_num_employees === "number" && o.estimated_num_employees > 0 ? Math.floor(o.estimated_num_employees) : null;
  return {
    name,
    website: str(o.website_url, 300),
    industry: str(o.industry, 120),
    size,
    city: str(o.city, 120),
    state: str(o.state, 120),
    country: str(o.country, 120),
    phone: str(o.phone, 40),
  };
}

function personOf(raw: unknown): RevealedPerson | null {
  const p = obj(raw);
  const id = p ? str(p.id, 64) : "";
  if (!p || !id) return null;
  const email = str(p.email, 254);
  return {
    id,
    firstName: str(p.first_name, 100),
    lastName: str(p.last_name, 100),
    title: str(p.title, 200),
    email: isPlaceholder(email) ? "" : email,
    emailStatus: str(p.email_status, 40),
    linkedinUrl: str(p.linkedin_url, 300),
    city: str(p.city, 120),
    state: str(p.state, 120),
    country: str(p.country, 120),
    company: companyOf(p.organization),
  };
}

/** What Apollo calls a request whose result is fetched later: a whole number, as text. */
export const REQUEST_ID = /^-?\d{1,20}$/;

/**
 * One request of at most ten people: who was matched, how many were not, and
 * the credits it used. With `phones`, Apollo also starts looking for their
 * phone numbers; `phoneRequest` is then what to ask about later.
 */
export async function revealBatch(
  fetchFn: typeof fetch,
  key: string,
  ids: string[],
  phones = false,
): Promise<{ people: RevealedPerson[]; notFound: number; credits: number; phoneRequest: string | null }> {
  // poll_only: Apollo keeps the phone result for us to fetch, instead of sending it to an address of ours.
  const url = `${APOLLO_BASE}/people/bulk_match?reveal_personal_emails=false&reveal_phone_number=${phones ? "true&poll_only=true" : "false"}`;
  const json = await post(fetchFn, key, url, { details: ids.map((id) => ({ id })) });
  const matches = Array.isArray(json.matches) ? json.matches : [];
  const people = matches.map(personOf).filter((p): p is RevealedPerson => p !== null);
  const credits = typeof json.credits_consumed === "number" && json.credits_consumed >= 0 ? json.credits_consumed : people.length;
  const requestId = str(json.request_id_str, 24);
  const pending = phones && obj(json.phone_enrichment)?.status === "pending" && REQUEST_ID.test(requestId);
  return { people, notFound: Math.max(0, ids.length - people.length), credits, phoneRequest: pending ? requestId : null };
}

const PHONE_TYPE: Record<string, PhoneType> = { mobile: "mobile", work_direct: "direct" };
const PHONE_RANK: Record<PhoneType, number> = { mobile: 0, direct: 1, other: 2 };
/** Apollo's words for "not on a do-not-call list" (or "nobody has checked"). Anything else is left alone. */
const MAY_CALL = new Set(["", "not_found", "unknown", "no_status"]);

/**
 * The one number worth keeping from the numbers Apollo found for a person:
 * only a number it marks as valid and not on a do-not-call list; a mobile
 * before a direct line before any other.
 */
export function bestPhone(raw: unknown): { number: string; type: PhoneType } | null {
  let best: { number: string; type: PhoneType } | null = null;
  for (const item of Array.isArray(raw) ? raw : []) {
    const n = obj(item);
    const number = n ? str(n.sanitized_number, 20) : "";
    if (!n || !/^\+\d{1,15}$/.test(number)) continue;
    if (n.status_cd !== "valid_number") continue;
    if (!MAY_CALL.has(str(n.dnc_status_cd, 40))) continue;
    const type = PHONE_TYPE[str(n.type_cd, 40)] ?? "other";
    if (!best || PHONE_RANK[type] < PHONE_RANK[best.type]) best = { number, type };
  }
  return best;
}

export type PhoneResult =
  | { state: "ready"; phones: Array<{ id: string; number: string; type: PhoneType }>; credits: number }
  | { state: "pending"; retryAfter: number }
  /** Apollo does not know the request, or has let it go: there is nothing to wait for. */
  | { state: "gone" };

/** How long to wait before asking again when Apollo does not say. */
export const RETRY_SECONDS = 10;

/** The phone numbers of one earlier request, when Apollo has finished looking. Free. */
export async function phoneResult(fetchFn: typeof fetch, key: string, requestId: string): Promise<PhoneResult> {
  let response: Response;
  try {
    response = await fetchFn(`${APOLLO_BASE}/webhook_result/${requestId}`, {
      method: "GET",
      headers: { "x-api-key": key, "Cache-Control": "no-cache", Accept: "application/json" },
    });
  } catch {
    throw new ApolloError(0);
  }
  let json: Record<string, unknown> = {};
  try {
    json = obj(await response.json()) ?? {};
  } catch {
    json = {};
  }
  if (response.ok) {
    const result = obj(json.webhook_result) ?? {};
    const phones: Array<{ id: string; number: string; type: PhoneType }> = [];
    for (const raw of Array.isArray(result.people) ? result.people : []) {
      const person = obj(raw);
      const id = person ? str(person.id, 64) : "";
      const phone = person ? bestPhone(person.phone_numbers) : null;
      if (id && phone) phones.push({ id, ...phone });
    }
    const credits = typeof result.credits_consumed === "number" && result.credits_consumed >= 0 ? result.credits_consumed : 0;
    return { state: "ready", phones, credits };
  }
  const code = str(json.error_code, 60);
  if (response.status === 404 && code === "result_pending") {
    const wait = Number(json.retry_after_seconds);
    return { state: "pending", retryAfter: Number.isFinite(wait) && wait > 0 ? Math.min(Math.ceil(wait), 60) : RETRY_SECONDS };
  }
  if (response.status === 404 || response.status === 410 || response.status === 400) return { state: "gone" };
  throw new ApolloError(response.status);
}
