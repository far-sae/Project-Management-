// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ORGS_SETTING, KEY_SETTING, readProspectConfig } from "../../../api/_prospect/config";
import { readFilters, searchUrl } from "../../../api/_prospect/apollo";
import {
  ADMINS_ONLY_MESSAGE,
  KEY_REFUSED_MESSAGE,
  LIMIT_MESSAGE,
  NOT_SET_UP_MESSAGE,
  REVEAL_MAX,
  SEARCH_REFUSED_MESSAGE,
  TOO_MANY_MESSAGE,
  UNREACHABLE_MESSAGE,
  orgNotAllowedMessage,
  route,
  type ProspectDeps,
} from "../../../api/_prospect/router";
import type { ProspectReveal, ProspectSearch, ProspectSetup } from "../../../api/_prospect/shared/types";

/**
 * Finding leads in Apollo: who may, what is asked of Apollo, what it costs and
 * what comes back. Nothing here touches the network.
 */

const ORG = "0b000000-0000-4000-8000-000000000001";
const OTHER_ORG = "0b000000-0000-4000-8000-000000000002";
const WS = "0a000000-0000-4000-8000-000000000001";
const OTHER_WS = "0a000000-0000-4000-8000-000000000002";
const OWNER = "0c000000-0000-4000-8000-000000000001";
const ADMIN = "0c000000-0000-4000-8000-000000000002";
const MEMBER = "0c000000-0000-4000-8000-000000000003";
const KEY = "apollo-key-for-tests-0123456789";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

const found = (id: string, first = "Elena") => ({
  id, first_name: first, last_name_obfuscated: "Ro***i", title: "Head of Operations", has_email: true,
  organization: { name: "Northwind Studio" },
});
const match = (id: string, over: Record<string, unknown> = {}) => ({
  id, first_name: "Elena", last_name: "Rossi", title: "Head of Operations", email: "elena@northwind.example",
  email_status: "verified", linkedin_url: "http://www.linkedin.com/in/elena-rossi", city: "Leeds", state: "England", country: "United Kingdom",
  organization: {
    name: "Northwind Studio", website_url: "http://www.northwind.example", industry: "design", estimated_num_employees: 40,
    city: "Leeds", state: "England", country: "United Kingdom", phone: "+44 113 496 0000",
  },
  ...over,
});

function setUp(over: { env?: Record<string, string | undefined>; answer?: (call: Call) => { status: number; json: unknown } } = {}) {
  const calls: Call[] = [];
  const answer = over.answer ?? ((call: Call) => {
    if (call.url.includes("/mixed_people/api_search")) return { status: 200, json: { total_entries: 2, people: [found("p1"), found("p2", "Priya")] } };
    const ids = ((call.body as { details: Array<{ id: string }> }).details ?? []).map((d) => d.id);
    return { status: 200, json: { credits_consumed: ids.length, matches: ids.map((id) => match(id)) } };
  });
  const fetchFake = vi.fn(async (url: string, init?: RequestInit) => {
    const call: Call = {
      url: String(url), method: String(init?.method ?? "GET"),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const out = answer(call);
    return new Response(JSON.stringify(out.json), { status: out.status, headers: { "content-type": "application/json" } });
  });
  const roles: Record<string, "owner" | "admin" | "member"> = { [OWNER]: "owner", [ADMIN]: "admin", [MEMBER]: "member" };
  const env = over.env ?? { [KEY_SETTING]: KEY, [ORGS_SETTING]: ORG };
  const deps: ProspectDeps = {
    store: {
      workspaceOrg: async (id) => (id === WS ? ORG : id === OTHER_WS ? OTHER_ORG : null),
      orgRole: async (org, user) => (org === ORG || org === OTHER_ORG ? roles[user] ?? null : null),
    },
    config: () => readProspectConfig(env),
    fetch: fetchFake as unknown as typeof fetch,
  };
  const ask = (method: string, path: string, body: Record<string, unknown> = {}, user = OWNER, query: Record<string, string> = {}) =>
    route(deps, { method, path: ["prospects", ...path.split("/")], body, query, user: { id: user } });
  return { deps, calls, ask };
}

const FILTERS = { titles: ["Head of Operations"], locations: ["United Kingdom"], verifiedOnly: true };

describe("the settings", () => {
  it("are off until the key is set, and name no value", () => {
    expect(readProspectConfig({})).toBeNull();
    expect(readProspectConfig({ [KEY_SETTING]: "  " })).toBeNull();
    expect(readProspectConfig({ [KEY_SETTING]: KEY, [ORGS_SETTING]: ` ${ORG.toUpperCase()} , ${OTHER_ORG}` })).toEqual({ key: KEY, allowedOrgs: [ORG, OTHER_ORG] });
  });

  it("let nobody use the key until an organisation is named: the credits are one account's", async () => {
    const { ask, calls } = setUp({ env: { [KEY_SETTING]: KEY } });
    const setup = (await ask("GET", "setup", {}, OWNER, { workspaceId: WS })).json as ProspectSetup;
    expect(setup).toEqual({ configured: true, ready: false, problem: orgNotAllowedMessage(ORG) });
    expect(setup.problem).toContain(ORG);
    const search = await ask("POST", "search", { workspaceId: WS, filters: FILTERS });
    expect(search).toEqual({ status: 403, json: { error: orgNotAllowedMessage(ORG) } });
    expect(calls).toHaveLength(0);
  });

  it("say what is missing when there is no key", async () => {
    const { ask } = setUp({ env: {} });
    expect((await ask("GET", "setup", {}, OWNER, { workspaceId: WS })).json).toEqual({ configured: false, ready: false, problem: NOT_SET_UP_MESSAGE });
    expect(await ask("POST", "search", { workspaceId: WS, filters: FILTERS })).toEqual({ status: 503, json: { error: NOT_SET_UP_MESSAGE } });
    expect(NOT_SET_UP_MESSAGE).toContain(KEY_SETTING);
  });

  it("are ready for the organisation that is named", async () => {
    const { ask } = setUp();
    expect((await ask("GET", "setup", {}, ADMIN, { workspaceId: WS })).json).toEqual({ configured: true, ready: true, problem: null });
  });
});

describe("who may", () => {
  it("is the owner and admins of the workspace's organisation, nobody else", async () => {
    const { ask, calls } = setUp();
    expect(await ask("POST", "search", { workspaceId: WS, filters: FILTERS }, MEMBER)).toEqual({ status: 403, json: { error: ADMINS_ONLY_MESSAGE } });
    expect(await ask("POST", "reveal", { workspaceId: WS, ids: ["p1"] }, MEMBER)).toEqual({ status: 403, json: { error: ADMINS_ONLY_MESSAGE } });
    expect(await ask("GET", "setup", {}, MEMBER, { workspaceId: WS })).toEqual({ status: 403, json: { error: ADMINS_ONLY_MESSAGE } });
    // Somebody from outside, and a workspace that does not exist, learn nothing.
    expect((await ask("POST", "search", { workspaceId: WS, filters: FILTERS }, "0c000000-0000-4000-8000-00000000ffff")).status).toBe(403);
    expect((await ask("POST", "search", { workspaceId: "0a000000-0000-4000-8000-00000000ffff", filters: FILTERS })).status).toBe(403);
    expect((await ask("POST", "search", { filters: FILTERS })).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("is not an organisation the key was not given to", async () => {
    const { ask, calls } = setUp();
    expect((await ask("POST", "search", { workspaceId: OTHER_WS, filters: FILTERS })).status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});

describe("searching", () => {
  it("asks Apollo's free search with the filters, and the key in a header only", async () => {
    const { ask, calls } = setUp();
    const out = await ask("POST", "search", {
      workspaceId: WS,
      filters: { titles: ["Head of Operations", "COO"], locations: ["United Kingdom"], keywords: "dental", domains: ["https://www.Northwind.example/about"], sizes: ["11,50"], seniorities: ["director", "nonsense"], verifiedOnly: true },
      page: 2,
    });
    expect(out.status).toBe(200);
    const call = calls[0]!;
    const url = new URL(call.url);
    expect(url.origin + url.pathname).toBe("https://api.apollo.io/api/v1/mixed_people/api_search");
    expect(call.method).toBe("POST");
    expect(call.headers["x-api-key"]).toBe(KEY);
    expect(call.url).not.toContain(KEY);
    expect(url.searchParams.getAll("person_titles[]")).toEqual(["Head of Operations", "COO"]);
    expect(url.searchParams.getAll("person_locations[]")).toEqual(["United Kingdom"]);
    expect(url.searchParams.get("q_keywords")).toBe("dental");
    expect(url.searchParams.getAll("q_organization_domains_list[]")).toEqual(["northwind.example"]);
    expect(url.searchParams.getAll("organization_num_employees_ranges[]")).toEqual(["11,50"]);
    // A seniority Apollo does not know is dropped, not sent.
    expect(url.searchParams.getAll("person_seniorities[]")).toEqual(["director"]);
    expect(url.searchParams.getAll("contact_email_status[]")).toEqual(["verified"]);
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.get("per_page")).toBe("25");
  });

  it("returns people without their email or full name: those cost a credit", async () => {
    const { ask } = setUp();
    const out = (await ask("POST", "search", { workspaceId: WS, filters: FILTERS })).json as ProspectSearch;
    expect(out).toEqual({
      total: 2, page: 1, perPage: 25,
      people: [
        { id: "p1", firstName: "Elena", lastNameHidden: "Ro***i", title: "Head of Operations", company: "Northwind Studio", hasEmail: true },
        { id: "p2", firstName: "Priya", lastNameHidden: "Ro***i", title: "Head of Operations", company: "Northwind Studio", hasEmail: true },
      ],
    });
  });

  it("does not ask for verified emails only when that is switched off", () => {
    const url = new URL(searchUrl(readFilters({ titles: ["CEO"], verifiedOnly: false }), 1));
    expect(url.searchParams.getAll("contact_email_status[]")).toEqual([]);
  });

  it("refuses a search with nothing to search by: that would be Apollo's whole database", async () => {
    const { ask, calls } = setUp();
    const out = await ask("POST", "search", { workspaceId: WS, filters: { verifiedOnly: true } });
    expect(out.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("keeps a filter list to a sensible size", () => {
    const many = Array.from({ length: 80 }, (_, n) => `Title ${n}`);
    expect(readFilters({ titles: many }).titles).toHaveLength(25);
    expect(readFilters({ titles: ["  CEO ", "ceo", "", 7] }).titles).toEqual(["CEO"]);
  });
});

describe("adding people (this is what costs credits)", () => {
  it("asks for ten people at a time, by id, and never for phone numbers", async () => {
    const { ask, calls } = setUp();
    const ids = Array.from({ length: 23 }, (_, n) => `p${n}`);
    const out = (await ask("POST", "reveal", { workspaceId: WS, ids, verifiedOnly: true })).json as ProspectReveal;
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => (c.body as { details: unknown[] }).details.length)).toEqual([10, 10, 3]);
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe("https://api.apollo.io/api/v1/people/bulk_match");
    expect(url.searchParams.get("reveal_phone_number")).toBe("false");
    expect(url.searchParams.get("reveal_personal_emails")).toBe("false");
    expect((calls[0]!.body as { details: unknown[] }).details[0]).toEqual({ id: "p0" });
    expect(out.credits).toBe(23);
    expect(out.people).toHaveLength(23);
  });

  it("returns each person ready to become a lead, with their company", async () => {
    const { ask } = setUp();
    const out = (await ask("POST", "reveal", { workspaceId: WS, ids: ["p1"], verifiedOnly: true })).json as ProspectReveal;
    expect(out).toEqual({
      credits: 1, notFound: 0, unverified: 0,
      people: [{
        id: "p1", firstName: "Elena", lastName: "Rossi", title: "Head of Operations", email: "elena@northwind.example", emailStatus: "verified",
        linkedinUrl: "http://www.linkedin.com/in/elena-rossi", city: "Leeds", state: "England", country: "United Kingdom",
        company: { name: "Northwind Studio", website: "http://www.northwind.example", industry: "design", size: 40, city: "Leeds", state: "England", country: "United Kingdom", phone: "+44 113 496 0000" },
      }],
    });
  });

  it("leaves out anybody whose email is not verified, and says how many", async () => {
    const { ask } = setUp({
      answer: () => ({
        status: 200,
        json: { credits_consumed: 3, matches: [match("p1"), match("p2", { email_status: "unverified" }), match("p3", { email: "email_not_unlocked@domain.com" }), null] },
      }),
    });
    const out = (await ask("POST", "reveal", { workspaceId: WS, ids: ["p1", "p2", "p3", "p4"], verifiedOnly: true })).json as ProspectReveal;
    expect(out.people.map((p) => p.id)).toEqual(["p1"]);
    expect(out).toMatchObject({ credits: 3, unverified: 2, notFound: 1 });
  });

  it("keeps an unverified email when the person asked for those too", async () => {
    const { ask } = setUp({ answer: () => ({ status: 200, json: { credits_consumed: 1, matches: [match("p2", { email_status: "unverified" })] } }) });
    const out = (await ask("POST", "reveal", { workspaceId: WS, ids: ["p2"], verifiedOnly: false })).json as ProspectReveal;
    expect(out.people.map((p) => p.emailStatus)).toEqual(["unverified"]);
  });

  it("takes at most fifty at once, and nothing that is not an id", async () => {
    const { ask, calls } = setUp();
    const tooMany = Array.from({ length: REVEAL_MAX + 1 }, (_, n) => `p${n}`);
    expect(await ask("POST", "reveal", { workspaceId: WS, ids: tooMany })).toEqual({ status: 400, json: { error: TOO_MANY_MESSAGE } });
    expect((await ask("POST", "reveal", { workspaceId: WS, ids: [] })).status).toBe(400);
    expect((await ask("POST", "reveal", { workspaceId: WS, ids: ["p1", "../x", 5] })).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("asks once for a person named twice: a credit is not spent twice", async () => {
    const { ask, calls } = setUp();
    await ask("POST", "reveal", { workspaceId: WS, ids: ["p1", "p1", "p2"] });
    expect((calls[0]!.body as { details: unknown[] }).details).toEqual([{ id: "p1" }, { id: "p2" }]);
  });

  it("stops at the first failure and still reports what was already paid for", async () => {
    let n = 0;
    const { ask } = setUp({
      answer: (call) => {
        n += 1;
        if (n === 2) return { status: 429, json: { message: "The maximum number of api calls allowed is 600 times per hour." } };
        const ids = (call.body as { details: Array<{ id: string }> }).details.map((d) => d.id);
        return { status: 200, json: { credits_consumed: ids.length, matches: ids.map((id) => match(id)) } };
      },
    });
    const ids = Array.from({ length: 15 }, (_, i) => `p${i}`);
    const out = await ask("POST", "reveal", { workspaceId: WS, ids });
    expect(out.status).toBe(200);
    const json = out.json as ProspectReveal;
    expect(json.people).toHaveLength(10);
    expect(json.credits).toBe(10);
    expect(json.stopped).toBe(LIMIT_MESSAGE);
  });
});

describe("when Apollo says no", () => {
  const failing = (status: number, json: unknown = { error: "secret detail from Apollo about api key abc" }) => setUp({ answer: () => ({ status, json }) });

  it("says so in our own words, never Apollo's, and never the key", async () => {
    for (const [status, sentence, ours] of [[401, KEY_REFUSED_MESSAGE, 502], [403, KEY_REFUSED_MESSAGE, 502], [422, SEARCH_REFUSED_MESSAGE, 400], [429, LIMIT_MESSAGE, 429], [500, UNREACHABLE_MESSAGE, 502]] as const) {
      const out = await failing(status).ask("POST", "search", { workspaceId: WS, filters: FILTERS });
      expect(out).toEqual({ status: ours, json: { error: sentence } });
      expect(JSON.stringify(out)).not.toContain(KEY);
      expect(JSON.stringify(out)).not.toContain("secret detail");
    }
  });

  it("says Apollo could not be reached when the network fails", async () => {
    const { deps } = setUp();
    deps.fetch = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const out = await route(deps, { method: "POST", path: ["prospects", "search"], body: { workspaceId: WS, filters: FILTERS }, query: {}, user: { id: OWNER } });
    expect(out).toEqual({ status: 502, json: { error: UNREACHABLE_MESSAGE } });
  });

  it("fails a first batch that could not be read at all", async () => {
    const out = await failing(401).ask("POST", "reveal", { workspaceId: WS, ids: ["p1"] });
    expect(out).toEqual({ status: 502, json: { error: KEY_REFUSED_MESSAGE } });
  });
});

describe("paths", () => {
  it("answers 404 for anything else", async () => {
    const { ask } = setUp();
    expect((await ask("GET", "search")).status).toBe(404);
    expect((await ask("POST", "everything")).status).toBe(404);
  });
});
