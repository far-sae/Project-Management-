// @vitest-environment node
import { describe, expect, it } from "vitest";
import { brandingOf, parseBranding, validateLogo } from "../../../../api/_signroom/branding";
import type { Workspace } from "../../../../api/_signroom/shared/types";

const ws: Workspace = {
  id: "w1",
  owner: "u1",
  name: "Acme Studio Ltd",
  replyTo: "",
  retentionDays: 30,
  suspended: false,
  created: "2026-11-01T00:00:00Z",
};

describe("brandingOf", () => {
  it("fills the defaults from the workspace", () => {
    const b = brandingOf(ws);
    expect(b.companyName).toBe("Acme Studio Ltd");
    expect(b.color).toBe("#24543b");
    expect(b.fontSize).toBe(12);
    expect(b.fontFamily).toBe("instrument");
    expect(b.layout).toBe("letterhead");
    expect(b.logoPosition).toBe("left");
  });
});

describe("parseBranding", () => {
  it("accepts valid input and keeps defaults", () => {
    const b = parseBranding({ companyName: " New Co ", color: "#112233", fontSize: 14 }, ws);
    expect(b.companyName).toBe("New Co");
    expect(b.color).toBe("#112233");
    expect(b.fontSize).toBe(14);
  });
  it("refuses an empty company name", () => {
    expect(() => parseBranding({ companyName: "  " }, ws)).toThrow("Enter the company name for the letterhead.");
  });
  it("refuses a bad colour", () => {
    expect(() => parseBranding({ color: "red" }, ws)).toThrow("Choose a valid brand colour.");
  });
  it("keeps a listed background template, refuses an unlisted one, and null clears it", () => {
    const file = { workspaceId: "w1", hash: "h1", name: "a.pdf" };
    const withFiles = { ...ws, templateFiles: [file] };
    expect(parseBranding({ backgroundTemplate: { hash: "h1" } }, withFiles).backgroundTemplate).toEqual(file);
    expect(() => parseBranding({ backgroundTemplate: { hash: "zz" } }, withFiles)).toThrow(
      "Upload a template to this workspace first.",
    );
    expect(() => parseBranding({ backgroundTemplate: { hash: "h1" } }, ws)).toThrow(
      "Upload a template to this workspace first.",
    );
    const had = { ...withFiles, branding: { ...brandingOf(ws), backgroundTemplate: file } };
    expect(parseBranding({ backgroundTemplate: null }, had).backgroundTemplate).toBeNull();
  });
  it("refuses an unsupported font and an out-of-range size", () => {
    expect(() => parseBranding({ fontFamily: "comic" }, ws)).toThrow("Choose a supported document font.");
    expect(() => parseBranding({ fontSize: 30 }, ws)).toThrow("Document body size must be 10–16 pt.");
  });
});

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAE0lEQVR4nGP4z8DwnwGM/zMwAAAf7gP9NRsAMwAAAABJRU5ErkJggg==";
const JPG =
  "data:image/jpeg;base64,/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z";

describe("validateLogo", () => {
  it("accepts a real PNG or JPEG data URL and an empty logo", async () => {
    expect(await validateLogo(PNG)).toBe(PNG);
    expect(await validateLogo(JPG)).toBe(JPG);
    expect(await validateLogo("")).toBe("");
  });
  it("refuses a GIF", async () => {
    await expect(validateLogo("data:image/gif;base64,AAAA")).rejects.toThrow("Use a PNG or JPEG logo.");
  });
  it("refuses a corrupt PNG (valid prefix, garbage bytes)", async () => {
    await expect(validateLogo("data:image/png;base64,QUJDREVGR0hJSktMTU5PUA==")).rejects.toThrow("Use a PNG or JPEG logo.");
  });
  it("refuses a logo over 400000 characters", async () => {
    const big = "data:image/png;base64," + "A".repeat(400001 - 22);
    expect(big.length).toBe(400001);
    await expect(validateLogo(big)).rejects.toThrow("Logo must be smaller than 300 KB.");
  });
});
