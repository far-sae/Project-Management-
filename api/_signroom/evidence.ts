import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";
import { zipSync } from "fflate";
import { stableJson } from "./agreementSend.js";
import type { CONSENT } from "./shared/types.js";

/** The active Ed25519 evidence signing key (Ruling B7). */
export type EvidenceKey = { keyId: string; privateKey: KeyObject; publicKeyPem: string };

const KEY_VAR = /^SIGNROOM_EVIDENCE_KEY_V([1-9]\d*)$/;

/** base64 PKCS#8 DER of an Ed25519 private key, or null when it is anything else. */
function parseKey(raw: string | undefined): KeyObject | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  try {
    const key = createPrivateKey({ key: Buffer.from(s, "base64"), format: "der", type: "pkcs8" });
    return key.asymmetricKeyType === "ed25519" ? key : null;
  } catch {
    return null;
  }
}

/**
 * Replaces SR security.ts signingKeys() (Ruling B7): the highest n among
 * SIGNROOM_EVIDENCE_KEY_V<n> that parses is the active key, with key id
 * taskcalendar-ed25519-v<n>. Null when none parses. Nothing about a key is logged.
 */
export function readEvidenceKey(env: Record<string, string | undefined>): EvidenceKey | null {
  const versions = Object.keys(env)
    .map((name) => KEY_VAR.exec(name))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ n: Number(m[1]), name: m[0] }))
    .sort((x, y) => y.n - x.n);
  for (const { n, name } of versions) {
    const privateKey = parseKey(env[name]);
    if (!privateKey) continue;
    const publicKeyPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
    return { keyId: `taskcalendar-ed25519-v${n}`, privateKey, publicKeyPem };
  }
  return null;
}

/** SR worker.ts 62–75's manifest payload. */
export type ManifestPayload = {
  schema: "signroom-evidence-v1";
  keyId: string;
  agreementId: string;
  sourceHash: string;
  senderSignedHash?: string;
  finalHash: string;
  completionHash: string;
  eventsHash: string;
  consent: typeof CONSENT;
  completedAt: string;
  statement: string;
};

/** The manifest's statement: SR's, with its sandbox wording replaced by how access is really verified. */
export const MANIFEST_STATEMENT =
  "Application-level evidence manifest; email access verified by a one-time code. This is not a qualified signature certificate.";

/** Ed25519 over stableJson(payload) (Ruling B9; SR signed JSON.stringify output). */
export function signManifest(
  payload: ManifestPayload,
  key: EvidenceKey,
): { payload: ManifestPayload; signature: string; publicKey: string } {
  const signature = sign(null, Buffer.from(stableJson(payload)), key.privateKey).toString("base64");
  return { payload, signature, publicKey: key.publicKeyPem };
}

/** Checks a manifest against a separately trusted public key (PEM). Anything malformed is false. */
export function verifyManifest(m: { payload: unknown; signature: string }, trustedPem: string): boolean {
  try {
    return verify(null, Buffer.from(stableJson(m.payload)), createPublicKey(trustedPem), Buffer.from(m.signature, "base64"));
  } catch {
    return false;
  }
}

/** README.txt in the evidence ZIP. */
export const EVIDENCE_README =
  "Application-level evidence export. manifest.json is signed with Ed25519 over its payload written as JSON with keys sorted and no spaces. Check it with a separately trusted copy of the public key, then compare each file's SHA-256 with the payload. All timestamps UTC. Email access verified by a one-time code.";

/**
 * The evidence ZIP (Ruling B11): fflate zipSync with `mtime` on every entry and
 * the names in sorted order, so equal inputs always give equal bytes.
 */
export function evidenceZip(files: Record<string, Uint8Array>, mtime: Date): Uint8Array {
  const sorted = Object.fromEntries(
    Object.keys(files)
      .sort()
      .map((name) => [name, files[name]]),
  );
  return zipSync(sorted, { mtime });
}
