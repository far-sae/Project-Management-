// @vitest-environment node
// The server's door to the database. The email and social functions crashed on
// the live site because this door only knew one name for the database address,
// while the site had it under the other name.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serviceClient } from "../../api/_lib/context";

const NAMES = ["SUPABASE_URL", "VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const kept: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of NAMES) { kept[name] = process.env[name]; delete process.env[name]; }
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
});
afterEach(() => {
  for (const name of NAMES) { if (kept[name] === undefined) delete process.env[name]; else process.env[name] = kept[name]; }
});

describe("the server's database client", () => {
  it("opens with the address under its own name", () => {
    process.env.SUPABASE_URL = "https://abc.supabase.co";
    expect(() => serviceClient()).not.toThrow();
  });

  it("opens with the address the browser side already has: it is the same project, and not a secret", () => {
    process.env.VITE_SUPABASE_URL = "https://abc.supabase.co";
    expect(() => serviceClient()).not.toThrow();
  });

  it("says which setting is missing when there is no address at all, or no key", () => {
    expect(() => serviceClient()).toThrow(/SUPABASE_URL/);
    process.env.SUPABASE_URL = "https://abc.supabase.co";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => serviceClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
