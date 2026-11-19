// @vitest-environment node
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  EVIDENCE_README,
  evidenceZip,
  readEvidenceKey,
  signManifest,
  verifyManifest,
  type ManifestPayload,
} from "../../../../api/_signroom/evidence";
import { readJobKey } from "../../../../api/_signroom/jobs";
import { CONSENT } from "../../../../api/_signroom/shared/types";

/** base64 PKCS#8 DER of a fresh Ed25519 key, as SIGNROOM_EVIDENCE_KEY_V<n> holds it. */
const newKey = () => generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");

const payload = (keyId: string): ManifestPayload => ({
  schema: "signroom-evidence-v1",
  keyId,
  agreementId: "a1",
  sourceHash: "1".repeat(64),
  finalHash: "2".repeat(64),
  completionHash: "3".repeat(64),
  eventsHash: "4".repeat(64),
  consent: CONSENT,
  completedAt: "2026-11-17T10:00:00.000Z",
  statement:
    "Application-level evidence manifest; email access verified by a one-time code. This is not a qualified signature certificate.",
});

describe("readEvidenceKey", () => {
  it("takes the highest version that parses", () => {
    const k = readEvidenceKey({ SIGNROOM_EVIDENCE_KEY_V1: newKey(), SIGNROOM_EVIDENCE_KEY_V2: newKey() });
    expect(k?.keyId).toBe("taskcalendar-ed25519-v2");
    expect(k?.privateKey.asymmetricKeyType).toBe("ed25519");
    expect(k?.publicKeyPem).toMatch(/^-----BEGIN PUBLIC KEY-----/);
  });

  it("ignores a malformed version", () => {
    const k = readEvidenceKey({ SIGNROOM_EVIDENCE_KEY_V1: newKey(), SIGNROOM_EVIDENCE_KEY_V3: "not-a-key" });
    expect(k?.keyId).toBe("taskcalendar-ed25519-v1");
  });

  it("ignores a key of another type", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
    expect(readEvidenceKey({ SIGNROOM_EVIDENCE_KEY_V1: rsa })).toBeNull();
  });

  it("is null when there is none", () => {
    expect(readEvidenceKey({})).toBeNull();
  });
});

describe("signManifest and verifyManifest", () => {
  const key = readEvidenceKey({ SIGNROOM_EVIDENCE_KEY_V1: newKey() })!;

  it("verifies with the key's public key", () => {
    const m = signManifest(payload(key.keyId), key);
    expect(m.publicKey).toBe(key.publicKeyPem);
    expect(verifyManifest(m, key.publicKeyPem)).toBe(true);
  });

  it("modified evidence fails verification", () => {
    const m = signManifest(payload(key.keyId), key);
    const changed = { ...m, payload: { ...m.payload, finalHash: "5".repeat(64) } };
    expect(verifyManifest(changed, key.publicKeyPem)).toBe(false);
  });

  it("fails with another key", () => {
    const m = signManifest(payload(key.keyId), key);
    const other = readEvidenceKey({ SIGNROOM_EVIDENCE_KEY_V1: newKey() })!;
    expect(verifyManifest(m, other.publicKeyPem)).toBe(false);
  });

  it("is false for a malformed signature or key", () => {
    const m = signManifest(payload(key.keyId), key);
    expect(verifyManifest({ ...m, signature: "AAAA" }, key.publicKeyPem)).toBe(false);
    expect(verifyManifest(m, "not a key")).toBe(false);
  });
});

describe("evidenceZip", () => {
  const files = () => ({
    "source.pdf": new Uint8Array([1, 2, 3]),
    "README.txt": new TextEncoder().encode(EVIDENCE_README),
    "events.json": new TextEncoder().encode("[]"),
  });
  const mtime = new Date("2026-11-17T10:00:00.000Z");

  it("gives the same bytes for the same files and time", () => {
    const one = evidenceZip(files(), mtime);
    const two = evidenceZip(files(), mtime);
    expect(Buffer.from(one).equals(Buffer.from(two))).toBe(true);
    expect(Object.keys(unzipSync(one)).sort()).toEqual(["README.txt", "events.json", "source.pdf"]);
  });

  it("does not depend on the order the files are given in", () => {
    const reversed = Object.fromEntries(Object.entries(files()).reverse());
    expect(Buffer.from(evidenceZip(reversed, mtime)).equals(Buffer.from(evidenceZip(files(), mtime)))).toBe(true);
  });
});

describe("signroom:secrets", () => {
  const script = fileURLToPath(new URL("../../../../scripts/signroom-secrets.mjs", import.meta.url));
  const run = (...args: string[]) => execFileSync(process.execPath, [script, ...args], { encoding: "utf8", stdio: "pipe" });

  it("prints the two secrets, one per line", () => {
    const out = run();
    expect(out.match(/^SIGNROOM_(JOB_KEY|EVIDENCE_KEY_V1)=\S+$/gm)).toHaveLength(2);
    expect(out.match(/^[A-Z_0-9]+=\S+$/gm)).toHaveLength(2);
    const job = out.match(/^SIGNROOM_JOB_KEY=(\S+)$/m)![1];
    expect(Buffer.from(job, "base64")).toHaveLength(32);
    expect(readJobKey(job)).toHaveLength(32);
    const v1 = out.match(/^SIGNROOM_EVIDENCE_KEY_V1=(\S+)$/m)![1];
    expect(readEvidenceKey({ SIGNROOM_EVIDENCE_KEY_V1: v1 })?.keyId).toBe("taskcalendar-ed25519-v1");
    expect(out).toContain("Vercel");
    expect(out).toContain("CRON_SECRET");
    expect(out).not.toMatch(/securovix/i);
  });

  it("with the word cron, prints only a CRON_SECRET", () => {
    const out = run("cron").trim();
    expect(out).toMatch(/^CRON_SECRET=[A-Za-z0-9_-]{43}$/);
  });

  it("prints fresh values each time", () => {
    expect(run()).not.toBe(run());
  });

  it("with a version, prints only that evidence key", () => {
    const out = run("2").trim();
    expect(out).toMatch(/^SIGNROOM_EVIDENCE_KEY_V2=\S+$/);
    expect(readEvidenceKey({ SIGNROOM_EVIDENCE_KEY_V2: out.slice(out.indexOf("=") + 1) })?.keyId).toBe("taskcalendar-ed25519-v2");
  });

  it("refuses a version that is not a whole number above zero", () => {
    for (const bad of ["0", "x", "1.5"])
      expect(() => execFileSync(process.execPath, [script, bad], { encoding: "utf8", stdio: "pipe" })).toThrow();
  });
});
