import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * The mailbox password (and the Google or Microsoft secrets) at rest:
 * AES-256-GCM with the 32-byte SIGNROOM_MAIL_KEY (base64, Vercel env), a random
 * 12-byte IV per write, and the workspace's id as additional data, so a value
 * copied to another workspace's row cannot be read. Stored as
 * "v1:<iv base64>:<ciphertext+tag base64>".
 */
export const KEY_UNAVAILABLE_MESSAGE =
  "Sending from your own mailbox is not set up yet: SIGNROOM_MAIL_KEY is missing in Vercel's environment variables.";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT = /^v1:([A-Za-z0-9+/]+={0,2}):([A-Za-z0-9+/]+={0,2})$/;

/** The key, or null when it is missing or not 32 bytes of base64 (changing or using a connection then answers 503). */
export function readKey(raw: string | undefined): Buffer | null {
  const s = (raw ?? "").trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(s)) return null;
  const key = Buffer.from(s, "base64");
  return key.length === 32 ? key : null;
}

/** `owner` is what the ciphertext is bound to: the workspace id (with a prefix for the OAuth values). */
export function encryptPassword(key: Buffer, owner: string, password: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(owner, "utf8"));
  const body = Buffer.concat([cipher.update(password, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `v1:${iv.toString("base64")}:${body.toString("base64")}`;
}

/** The password, or null for anything that does not decrypt (another workspace or key, changed bytes, malformed). */
export function decryptPassword(key: Buffer, owner: string, value: string): string | null {
  const m = FORMAT.exec(typeof value === "string" ? value : "");
  if (!m) return null;
  const iv = Buffer.from(m[1], "base64");
  const body = Buffer.from(m[2], "base64");
  if (iv.length !== IV_BYTES || body.length <= TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(owner, "utf8"));
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    return Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_BYTES)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
