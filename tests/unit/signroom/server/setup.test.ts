// @vitest-environment node
// Until the owner has finished setting up (keys in Vercel, tables in Supabase),
// the server says exactly what is missing instead of "busy" or "sign-in unavailable".
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetAdminClientForTests, adminClient, setupProblem } from "../../../../api/_signroom/host/admin";
import { StoreError } from "../../../../api/_signroom/errors";
import { route, type RouteDeps } from "../../../../api/_signroom/router";
import { signroomHandler } from "../../../../api/signroom";
import { fakeReq, fakeRes } from "./fakeHttp";

const saved = { ...process.env };
beforeEach(() => {
  __resetAdminClientForTests();
  delete process.env.SUPABASE_URL;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});
afterEach(() => {
  process.env = { ...saved };
  __resetAdminClientForTests();
});

describe("what is missing", () => {
  it("names the database key when it is not set", () => {
    process.env.SUPABASE_URL = "https://project.example.co";
    expect(adminClient()).toBeNull();
    expect(setupProblem()).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("names the database address when neither name for it is set", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    expect(adminClient()).toBeNull();
    expect(setupProblem()).toMatch(/SUPABASE_URL/);
  });

  it("uses the address the browser side already has (VITE_SUPABASE_URL) when SUPABASE_URL is not set", () => {
    process.env.VITE_SUPABASE_URL = "https://project.example.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    expect(adminClient()).not.toBeNull();
    expect(setupProblem()).toBeNull();
  });

  it("has nothing to say once both are set", () => {
    process.env.SUPABASE_URL = "https://project.example.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    expect(setupProblem()).toBeNull();
  });
});

describe("the entry", () => {
  it("answers 503 with the setup sentence before asking anyone to sign in", async () => {
    let asked = false;
    const handler = signroomHandler({
      signedIn: async () => {
        asked = true;
        return null;
      },
      route: async () => ({ status: 200, json: {} }),
      setup: () => "Documents are not set up yet: SUPABASE_SERVICE_ROLE_KEY is missing in Vercel.",
    });
    const res = fakeRes();
    await handler(
      fakeReq({ method: "GET", headers: { origin: "http://localhost:3000" }, query: { path: "agreements" }, body: undefined }) as never,
      res as never,
    );
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: "Documents are not set up yet: SUPABASE_SERVICE_ROLE_KEY is missing in Vercel." });
    expect(asked).toBe(false);
  });
});

describe("the router", () => {
  const missing = (message: string): RouteDeps => {
    const store = new Proxy({}, { get: () => async () => { throw new StoreError(message); } });
    return { mail: { store } as never, hasVerifiedMailbox: async () => false } as never;
  };
  const request = { method: "GET", path: ["agreements"], query: {}, body: {}, user: { id: "u1", email: "sam@example.com", workspaceId: "0a000000-0000-4000-8000-000000000001" }, origin: "https://app.example.com" };

  it("says the tables are missing when the database has not been set up, in either wording Supabase uses", async () => {
    for (const message of [
      "Could not find the table 'public.sr_workspaces' in the schema cache",
      'relation "public.sr_workspaces" does not exist',
    ]) {
      const out = await route(missing(message), request);
      expect(out.status).toBe(503);
      expect((out.json as { error: string }).error).toMatch(/184_signroom\.sql/);
    }
  });

  it("keeps any other database failure as a plain 500 that says nothing about the database", async () => {
    const out = await route(missing("connection reset"), request);
    expect(out.status).toBe(500);
    expect((out.json as { error: string }).error).toBe("Something went wrong. Please try again.");
  });
});
