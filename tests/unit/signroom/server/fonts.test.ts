// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fontsDir } from "../../../../api/_signroom/pdf";
import { authoredPdf } from "../../../../api/_signroom/agreementPdf";
import { brandingOf } from "../../../../api/_signroom/branding";

/**
 * The api/ folder is CommonJS, so the fonts are found from the module's own
 * folder (__dirname), with the function root as a fallback, never import.meta.
 */

const root = process.cwd();
const real = resolve(root, "api/_signroom/fonts");

describe("the fonts folder", () => {
  it("resolves to api/_signroom/fonts and holds the fonts and their licences", () => {
    expect(resolve(fontsDir())).toBe(real);
    const files = readdirSync(fontsDir());
    for (const f of ["Inter.ttf", "Inter-Bold.ttf", "Lora.ttf", "SourceSerif4.ttf", "RobotoMono.ttf", "InstrumentSans.ttf", "OFL.txt"]) expect(files).toContain(f);
  });

  it("is found from the module's own folder when the working directory is somewhere else", () => {
    const elsewhere = resolve(root, "tests");
    expect(existsSync(join(elsewhere, "api/_signroom/fonts"))).toBe(false);
    expect(resolve(fontsDir({ dirname: resolve(root, "api/_signroom"), cwd: elsewhere }))).toBe(real);
  });

  it("falls back to <cwd>/api/_signroom/fonts when the module's folder has no fonts beside it (a bundled function)", () => {
    expect(resolve(fontsDir({ dirname: resolve(root, "tests"), cwd: root }))).toBe(real);
  });

  it("no server file uses import.meta, which CommonJS cannot compile", () => {
    const dir = resolve(root, "api/_signroom");
    const files = [resolve(root, "api/signroom.ts"), ...readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => join(dir, f)), ...readdirSync(join(dir, "host")).map((f) => join(dir, "host", f))];
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/import\.meta/);
  });

  it("vercel.json ships the fonts with the function", () => {
    const v = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));
    expect(v.functions["api/signroom.ts"].includeFiles).toBe("api/_signroom/fonts/**");
  });

  it("a PDF really draws with them", async () => {
    const out = await authoredPdf("Fonts check", "A short paragraph of body text.", brandingOf({ name: "Acme Studio" } as never), async () => new Uint8Array());
    expect(out.pages.length).toBeGreaterThan(0);
    expect(Buffer.from(out.bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });
});
