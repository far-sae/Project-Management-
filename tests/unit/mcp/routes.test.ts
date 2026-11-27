// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The connector has no function of its own (the plan allows twelve, and
 * twelve are in use): vercel.json sends its addresses to the email function.
 * If one of these lines is lost, Claude cannot connect and nothing says why.
 */

const root = resolve(__dirname, "../../..");
const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
  rewrites: Array<{ source: string; destination: string }>;
  headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
};

/** Every file Vercel deploys as a function: api/**, without the folders that start with "_". */
function functions(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name.startsWith("_") || name === "node_modules") return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return functions(path);
    return name.endsWith(".ts") ? [path] : [];
  });
}

describe("the connector's addresses", () => {
  const to = (source: string) => config.rewrites.find((r) => r.source === source)?.destination;

  it("sends the connector and the two discovery addresses to the email function", () => {
    expect(to("/api/mcp")).toBe("/api/email/warmup?mcp=rpc");
    expect(to("/api/mcp/:path*")).toBe("/api/email/warmup?mcp=:path*");
    expect(to("/.well-known/oauth-protected-resource")).toBe("/api/email/warmup?mcp=well-known/protected-resource");
    expect(to("/.well-known/oauth-protected-resource/:path*")).toBe("/api/email/warmup?mcp=well-known/protected-resource");
    expect(to("/.well-known/oauth-authorization-server")).toBe("/api/email/warmup?mcp=well-known/authorization-server");
  });

  it("names them before the line that gives every other address to the app's pages", () => {
    const sources = config.rewrites.map((r) => r.source);
    const pages = config.rewrites.findIndex((r) => r.destination === "/index.html");
    expect(pages).toBe(config.rewrites.length - 1);
    for (const s of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server", "/api/mcp"]) expect(sources.indexOf(s)).toBeLessThan(pages);
  });

  it("tells browsers never to show the Allow page inside another website", () => {
    const rule = config.headers?.find((h) => h.source === "/connect/(.*)");
    const value = (key: string) => rule?.headers.find((x) => x.key === key)?.value;
    expect(value("X-Frame-Options")).toBe("DENY");
    expect(value("Content-Security-Policy")).toBe("frame-ancestors 'none'");
  });

  it("adds no function: the plan allows twelve", () => {
    expect(functions(join(root, "api"))).toHaveLength(12);
  });
});
