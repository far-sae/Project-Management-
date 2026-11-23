import type { FoundPerson, ProspectFilters, RevealedCompany, RevealedPerson } from "./shared/types.js";

/**
 * Apollo's own API (docs.apollo.io), and nothing else: no page of Apollo's is
 * read or copied.
 *
 *  - People search (mixed_people/api_search) is free. It returns no email and
 *    only part of the last name.
 *  - Bulk enrichment (people/bulk_match) returns the email: 1 credit a person
 *    when data is found, ten people a request. Phone numbers cost 8 credits
 *    more each, so they are never asked for here.
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

/** One request of at most ten people: who was matched, how many were not, and the credits it used. */
export async function revealBatch(fetchFn: typeof fetch, key: string, ids: string[]): Promise<{ people: RevealedPerson[]; notFound: number; credits: number }> {
  const url = `${APOLLO_BASE}/people/bulk_match?reveal_personal_emails=false&reveal_phone_number=false`;
  const json = await post(fetchFn, key, url, { details: ids.map((id) => ({ id })) });
  const matches = Array.isArray(json.matches) ? json.matches : [];
  const people = matches.map(personOf).filter((p): p is RevealedPerson => p !== null);
  const credits = typeof json.credits_consumed === "number" && json.credits_consumed >= 0 ? json.credits_consumed : people.length;
  return { people, notFound: Math.max(0, ids.length - people.length), credits };
}
