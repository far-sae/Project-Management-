// Signed guest-invite tokens for in-app calls. Pure: no remote imports, so it
// loads under both Deno (Edge Functions) and Vitest.

export interface InvitePayload {
  room: string;
  /** Unix seconds. */
  exp: number;
  label: string;
  inviterName: string;
}

export const INVITE_TTL_SECONDS = 24 * 60 * 60;

// ── A meeting with a lead or a client (CRM) ─────────────────────────────────
// It has a room of its own, `crm:<workspaceId>:<meetingId>`, so it needs no
// project. Its link is sent days ahead, so it does not run out a day after it
// is made like a link from inside a call: it works until a day after the
// meeting starts.

/** How far ahead a meeting can be given a link. */
export const MEETING_AHEAD_DAYS = 366;
/** A meeting that started up to this long ago can still be given a link. */
const MEETING_LATE_MS = 60 * 60 * 1000;

const ID = /^[A-Za-z0-9-]{1,64}$/;

export function crmMeetingRoomName(workspaceId: string, meetingId: string): string {
  return `crm:${workspaceId}:${meetingId}`;
}

/** The workspace a CRM meeting room belongs to, or null when the name is not one. */
export function workspaceIdFromCrmRoom(name: string): string | null {
  if (typeof name !== "string" || !name.startsWith("crm:")) return null;
  const parts = name.slice("crm:".length).split(":");
  if (parts.length !== 2 || !ID.test(parts[0]) || !ID.test(parts[1])) return null;
  return parts[0];
}

/**
 * When the link of a meeting stops working, in Unix seconds: a day after the
 * meeting starts. Null for a start that is not a time, that is more than an
 * hour past, or that is further ahead than a link is made for.
 */
export function meetingInviteExpiry(startsAtMs: number, nowMs: number): number | null {
  if (typeof startsAtMs !== "number" || !Number.isFinite(startsAtMs)) return null;
  if (startsAtMs < nowMs - MEETING_LATE_MS) return null;
  if (startsAtMs > nowMs + MEETING_AHEAD_DAYS * 24 * 60 * 60 * 1000) return null;
  return Math.floor(startsAtMs / 1000) + INVITE_TTL_SECONDS;
}

/** What the guest reads on the join page: one short line. */
export function meetingLabel(raw: unknown): string {
  if (typeof raw !== "string") return "Meeting";
  return raw.replace(/\s+/g, " ").trim().slice(0, 120) || "Meeting";
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Mirrors isValidRoomName in supabase/functions/livekit-token/index.ts.
export function isValidRoomName(name: string): boolean {
  if (typeof name !== "string" || name.length === 0 || name.length > 200) {
    return false;
  }
  if (name.startsWith("project:")) {
    const id = name.slice("project:".length);
    return /^[A-Za-z0-9_:-]{1,128}$/.test(id);
  }
  if (name.startsWith("dm:")) {
    const id = name.slice("dm:".length);
    return /^[A-Za-z0-9_:-]+__[A-Za-z0-9_:-]+$/.test(id);
  }
  if (name.startsWith("crm:")) return workspaceIdFromCrmRoom(name) !== null;
  return false;
}

function bytesToB64u(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64uToBytes(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const padded = s.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (s.length % 4)) % 4);
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function hmac(data: string, secret: string): Promise<Uint8Array> {
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return new Uint8Array(sig);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export async function signInvite(p: InvitePayload, secret: string): Promise<string> {
  const body = bytesToB64u(encoder.encode(JSON.stringify(p)));
  const sig = await hmac(body, secret);
  return `${body}.${bytesToB64u(sig)}`;
}

export async function verifyInvite(
  token: string,
  secret: string,
  nowSec: number,
): Promise<InvitePayload | null> {
  try {
    if (typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [body, sigB64] = parts;
    const given = b64uToBytes(sigB64);
    if (!given) return null;
    const expected = await hmac(body, secret);
    if (!constantTimeEqual(given, expected)) return null;

    const raw = b64uToBytes(body);
    if (!raw) return null;
    const parsed = JSON.parse(decoder.decode(raw));
    if (!parsed || typeof parsed !== "object") return null;
    const { room, exp, label, inviterName } = parsed as Record<string, unknown>;
    if (typeof room !== "string" || typeof exp !== "number" || !Number.isFinite(exp)) {
      return null;
    }
    if (typeof label !== "string" || typeof inviterName !== "string") return null;
    if (exp <= nowSec) return null;
    if (!isValidRoomName(room)) return null;
    return { room, exp, label, inviterName };
  } catch {
    return null;
  }
}

export function normalizeGuestName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return null;
  return name.slice(0, 60);
}
