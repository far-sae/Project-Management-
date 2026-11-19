// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decryptPassword, encryptPassword, KEY_UNAVAILABLE_MESSAGE, readKey } from "../../../../api/_signroom/mailbox/crypto";

const key = readKey(Buffer.alloc(32, 7).toString("base64"))!;
const otherKey = readKey(Buffer.alloc(32, 9).toString("base64"))!;
const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

describe("readKey", () => {
  it("accepts exactly 32 bytes of base64, ignoring surrounding whitespace", () => {
    expect(readKey(Buffer.alloc(32, 1).toString("base64"))?.length).toBe(32);
    expect(readKey(` ${Buffer.alloc(32, 1).toString("base64")}\n`)?.length).toBe(32);
  });

  it("refuses a missing, short, long or non-base64 key", () => {
    expect(readKey(undefined)).toBeNull();
    expect(readKey("")).toBeNull();
    expect(readKey(Buffer.alloc(31, 1).toString("base64"))).toBeNull();
    expect(readKey(Buffer.alloc(33, 1).toString("base64"))).toBeNull();
    expect(readKey("not-base64!".padEnd(43, "x") + "=")).toBeNull();
  });

  it("has the spec's sentence for a server without a usable key", () => {
    expect(KEY_UNAVAILABLE_MESSAGE).toBe("Sending from your own mailbox is not set up yet: SIGNROOM_MAIL_KEY is missing in Vercel's environment variables.");
  });
});

describe("encryptPassword / decryptPassword", () => {
  it("round-trips in the v1 format with a fresh 12-byte IV each time", () => {
    const a = encryptPassword(key, OWNER, "app-password-1");
    const b = encryptPassword(key, OWNER, "app-password-1");
    expect(a).toMatch(/^v1:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/);
    expect(a).not.toBe(b);
    expect(Buffer.from(a.split(":")[1], "base64")).toHaveLength(12);
    expect(a).not.toContain("app-password-1");
    expect(decryptPassword(key, OWNER, a)).toBe("app-password-1");
    expect(decryptPassword(key, OWNER, b)).toBe("app-password-1");
  });

  it("keeps non-ASCII passwords intact", () => {
    expect(decryptPassword(key, OWNER, encryptPassword(key, OWNER, "pässwörd £€ 密码"))).toBe("pässwörd £€ 密码");
  });

  it("cannot be read under another workspace (AAD), with another key, or after any byte changes", () => {
    const value = encryptPassword(key, OWNER, "app-password-1");
    expect(decryptPassword(key, OTHER, value)).toBeNull();
    expect(decryptPassword(otherKey, OWNER, value)).toBeNull();
    const [, iv, body] = value.split(":");
    const bytes = Buffer.from(body, "base64");
    bytes[0] ^= 1;
    expect(decryptPassword(key, OWNER, `v1:${iv}:${bytes.toString("base64")}`)).toBeNull();
    const tag = Buffer.from(body, "base64");
    tag[tag.length - 1] ^= 1;
    expect(decryptPassword(key, OWNER, `v1:${iv}:${tag.toString("base64")}`)).toBeNull();
  });

  it("reads anything malformed as null instead of throwing", () => {
    for (const v of ["", "plain", "v1:", "v1::", "v2:AAAAAAAAAAAAAAAA:AAAA", "v1:AAAA:AAAA", "v1:AAAAAAAAAAAAAAAA:AAAA", null as unknown as string]) {
      expect(decryptPassword(key, OWNER, v)).toBeNull();
    }
  });
});
