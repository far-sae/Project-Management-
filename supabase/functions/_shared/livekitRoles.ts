// LiveKit grants, guest identity rules and room-access decisions shared by the
// call Edge Functions. Pure: no remote imports, so it loads under both Deno
// (Edge Functions) and Vitest.

/** Subset of LiveKit's VideoGrant used in participant access tokens. */
export interface LiveKitVideoGrant {
  roomJoin: boolean;
  room: string;
  canPublish: boolean;
  canSubscribe: boolean;
  canPublishData: boolean;
  canUpdateOwnMetadata: boolean;
}

/** VideoGrant for short-lived server tokens that call RoomService. */
export interface LiveKitRoomAdminGrant {
  roomAdmin: true;
  room: string;
}

/** ParticipantPermission in RoomService.UpdateParticipant (protobuf JSON names). */
export interface LiveKitParticipantPermission {
  canSubscribe: boolean;
  canPublish: boolean;
  canPublishData: boolean;
  canPublishSources: Array<"CAMERA" | "MICROPHONE">;
  canUpdateMetadata: boolean;
}

export const GUEST_WAITING_METADATA = '{"role":"guest","status":"waiting"}';
export const GUEST_ADMITTED_METADATA = '{"role":"guest","status":"admitted"}';

const GUEST_IDENTITY_RE = /^guest:[A-Za-z0-9_-]{1,128}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `wss://h/` → `https://h`, `ws://h` → `http://h`. */
export function livekitHttpUrl(wsUrl: string): string {
  return wsUrl
    .trim()
    .replace(/^wss:\/\//i, "https://")
    .replace(/^ws:\/\//i, "http://")
    .replace(/\/+$/, "");
}

export function isGuestIdentity(id: string): boolean {
  return typeof id === "string" && GUEST_IDENTITY_RE.test(id);
}

/** A waiting guest is in the room but can't see, hear, publish or edit itself. */
export function guestWaitingGrant(room: string): LiveKitVideoGrant {
  return {
    roomJoin: true,
    room,
    canPublish: false,
    canSubscribe: false,
    canPublishData: false,
    canUpdateOwnMetadata: false,
  };
}

/** Admitted guests: see/hear everyone, publish camera + mic only (no screen share). */
export function guestAdmittedPermission(): LiveKitParticipantPermission {
  return {
    canSubscribe: true,
    canPublish: true,
    canPublishData: true,
    canPublishSources: ["CAMERA", "MICROPHONE"],
    canUpdateMetadata: false,
  };
}

/** Team members; canUpdateOwnMetadata lets them set the `recording` attribute. */
export function memberGrant(room: string): LiveKitVideoGrant {
  return {
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canUpdateOwnMetadata: true,
  };
}

export function roomAdminGrant(room: string): LiveKitRoomAdminGrant {
  return { roomAdmin: true, room };
}

/** True when the room is non-empty and every participant is a guest. */
export function onlyGuestsRemain(identities: string[]): boolean {
  return identities.length > 0 && identities.every(isGuestIdentity);
}

function isWaitingGuestMetadata(metadata: string | undefined): boolean {
  if (!metadata) return false;
  try {
    const m = JSON.parse(metadata) as { role?: unknown; status?: unknown } | null;
    return !!m && m.role === "guest" && m.status === "waiting";
  } catch {
    return false;
  }
}

/**
 * Guests to remove when a member is about to join a room that holds only
 * guests. Admitted guests left over from an earlier call are evicted so they
 * can't see the next one. Waiting guests are kept: they can't see or hear
 * anything, and they may simply have arrived before the host (evicting them
 * would show them "You weren't let into the call.").
 */
export function guestsToEvict(
  participants: Array<{ identity: string; metadata?: string }>,
): string[] {
  if (!onlyGuestsRemain(participants.map((p) => p.identity))) return [];
  return participants
    .filter((p) => !isWaitingGuestMetadata(p.metadata))
    .map((p) => p.identity);
}

export function classifyRoomServiceError(status: number): "gone" | "error" {
  return status === 404 ? "gone" : "error";
}

/**
 * `project:<uuid>` → uuid. A task's meeting room lives inside its project —
 * `project:<uuid>:task:<taskUuid>` — and is governed by the same project
 * access, so it also returns the project uuid. Anything else → null.
 */
export function projectIdFromRoom(room: string): string | null {
  if (typeof room !== "string" || !room.startsWith("project:")) return null;
  const rest = room.slice("project:".length);
  const [id, kind, taskId, ...extra] = rest.split(":");
  if (!UUID_RE.test(id ?? "")) return null;
  if (kind === undefined) return id;
  return kind === "task" && UUID_RE.test(taskId ?? "") && extra.length === 0 ? id : null;
}

/** `dm:<a>__<b>` → [a, b]; anything else → null. */
export function dmMembers(room: string): [string, string] | null {
  if (typeof room !== "string" || !room.startsWith("dm:")) return null;
  const parts = room.slice("dm:".length).split("__");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return [parts[0], parts[1]];
}

export function isDmMember(room: string, userId: string): boolean {
  const members = dmMembers(room);
  return !!members && !!userId && (members[0] === userId || members[1] === userId);
}

/** Who may invite / admit / deny guests in a project room (view-only users can't). */
export function canManageGuests(input: {
  canAccess: boolean;
  role: string | null;
  isOrgViewer: boolean;
}): boolean {
  if (!input.canAccess || input.isOrgViewer) return false;
  if (!input.role || input.role === "viewer" || input.role === "none") return false;
  return true;
}

/** CALL_INVITE_SECRET must be at least 32 bytes. */
export function isInviteSecretStrong(secret: string | undefined): boolean {
  return typeof secret === "string" && new TextEncoder().encode(secret).length >= 32;
}
