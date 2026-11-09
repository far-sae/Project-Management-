// Supabase Edge Function: guest links for in-app LiveKit calls.
// Deploy: supabase functions deploy call-guest
//
// Secrets (Dashboard → Project Settings → Edge Functions → Manage secrets):
//   CALL_INVITE_SECRET  — required, random ≥ 32 bytes (signs invite links)
//   LIVEKIT_API_KEY     — required (shared with livekit-token)
//   LIVEKIT_API_SECRET  — required
//   LIVEKIT_URL         — required (wss://…)
//   ALLOWED_ORIGINS     — optional comma-list of permitted browser origins
//
// Actions (POST JSON { action, ... }):
//   create-invite { roomName }         — signed-in member → { url, expiresAt }
//   guest-join    { invite, name }     — public (anon key) → { token, url, label, identity, roomName }
//   admit         { roomName, identity } — signed-in member → { ok: true[, gone: true] }
//   deny          { roomName, identity } — signed-in member → { ok: true[, gone: true] }
//
// Guests join the room in a "waiting" state (can't see, hear or publish). A
// member admits them via RoomService.UpdateParticipant or denies them via
// RoomService.RemoveParticipant. Who may invite/admit/deny: anyone who can use
// the project with a non-viewer role (project rooms) or either DM participant.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
import {
  INVITE_TTL_SECONDS,
  isValidRoomName,
  normalizeGuestName,
  signInvite,
  verifyInvite,
} from "../_shared/callInvite.ts";
import {
  canManageGuests,
  classifyRoomServiceError,
  GUEST_ADMITTED_METADATA,
  GUEST_WAITING_METADATA,
  guestAdmittedPermission,
  guestWaitingGrant,
  isDmMember,
  isGuestIdentity,
  isInviteSecretStrong,
  livekitHttpUrl,
  type LiveKitRoomAdminGrant,
  type LiveKitVideoGrant,
  projectIdFromRoom,
  roomAdminGrant,
} from "../_shared/livekitRoles.ts";

const JOIN_URL_BASE = "https://taskcalendar.co.uk/join/";
const GUEST_TOKEN_TTL_SECONDS = 2 * 60 * 60;
const ADMIN_TOKEN_TTL_SECONDS = 60;
const MAX_INVITE_LENGTH = 4096;

const allowedOriginsRaw = Deno.env.get("ALLOWED_ORIGINS") ?? "";
const normalizeOrigin = (o: string): string => o.trim().replace(/\/+$/, "");
const allowedOrigins = allowedOriginsRaw
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);

function buildCorsHeaders(origin: string | null): Record<string, string> {
  const normalized = origin ? normalizeOrigin(origin) : null;
  const allow =
    normalized && (allowedOrigins.length === 0 || allowedOrigins.includes(normalized))
      ? normalized
      : (allowedOrigins[0] ?? "*");
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

interface LiveKitClaims extends Record<string, unknown> {
  iss: string;
  sub?: string;
  nbf: number;
  exp: number;
  name?: string;
  metadata?: string;
  video: LiveKitVideoGrant | LiveKitRoomAdminGrant;
}

async function signLiveKitJwt(claims: LiveKitClaims, apiSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return await create({ alg: "HS256", typ: "JWT" }, claims, key);
}

type AccessResult =
  | { ok: true; label: string }
  | { ok: false; status: number; body: Record<string, unknown> };

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req.headers.get("Origin"));
  function json(body: Record<string, unknown>, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Refuse to run at all without the secrets — never fall back to a weak or
  // reused signing key.
  const inviteSecret = Deno.env.get("CALL_INVITE_SECRET") ?? "";
  const apiKey = (Deno.env.get("LIVEKIT_API_KEY") ?? "").trim();
  const apiSecret = (Deno.env.get("LIVEKIT_API_SECRET") ?? "").trim();
  const livekitUrl = (Deno.env.get("LIVEKIT_URL") ?? "").trim();
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (
    !isInviteSecretStrong(inviteSecret) || !apiKey || !apiSecret || !livekitUrl ||
    !supabaseUrl || !supabaseAnonKey
  ) {
    return json(
      {
        error:
          "call-guest is not configured. Set CALL_INVITE_SECRET (≥ 32 bytes) and LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL on this Edge Function, then redeploy.",
        code: "MISSING_CONFIG",
      },
      503,
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch (_) {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!payload || typeof payload !== "object") {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const body = payload as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "";

  // ---------------------------------------------------------------------------
  // guest-join: public. The signed invite is the only credential.
  // ---------------------------------------------------------------------------
  if (action === "guest-join") {
    const invite = typeof body.invite === "string" ? body.invite.trim() : "";
    const nowSec = Math.floor(Date.now() / 1000);
    const claims = invite && invite.length <= MAX_INVITE_LENGTH
      ? await verifyInvite(invite, inviteSecret, nowSec)
      : null;
    if (!claims) {
      return json({ error: "This link has expired", code: "INVITE_EXPIRED" }, 410);
    }
    const name = normalizeGuestName(body.name);
    if (!name) {
      return json({ error: "Please enter your name", code: "BAD_NAME" }, 400);
    }

    const identity = `guest:${crypto.randomUUID()}`;
    try {
      const token = await signLiveKitJwt(
        {
          iss: apiKey,
          sub: identity,
          nbf: getNumericDate(0),
          exp: getNumericDate(GUEST_TOKEN_TTL_SECONDS),
          name,
          metadata: GUEST_WAITING_METADATA,
          video: guestWaitingGrant(claims.room),
        },
        apiSecret,
      );
      return json({
        token,
        url: livekitUrl,
        label: claims.label,
        identity,
        roomName: claims.room,
      });
    } catch (err) {
      console.error("call-guest guest-join sign error:", err);
      return json({ error: "Could not create call token" }, 500);
    }
  }

  if (action !== "create-invite" && action !== "admit" && action !== "deny") {
    return json({ error: "Unknown action" }, 400);
  }

  // ---------------------------------------------------------------------------
  // Member actions: signed-in Supabase user required.
  // ---------------------------------------------------------------------------
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }
  const jwt = authHeader.slice(7);
  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user }, error: authError } = await authClient.auth.getUser(jwt);
  if (authError || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const roomName = typeof body.roomName === "string" ? body.roomName.trim() : "";
  if (!roomName || !isValidRoomName(roomName)) {
    return json({ error: "Invalid roomName" }, 400);
  }

  let identity = "";
  if (action === "admit" || action === "deny") {
    identity = typeof body.identity === "string" ? body.identity.trim() : "";
    if (!isGuestIdentity(identity)) {
      return json({ error: "Only guests can be admitted or denied" }, 400);
    }
  }

  const userId = user.id;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const pick = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const inviterName = (
    pick(meta.display_name) || pick(meta.full_name) || pick(user.email) || "A teammate"
  ).slice(0, 100);

  // RLS-aware client acting as the caller, so auth.uid() works in the RPCs.
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function checkAccess(): Promise<AccessResult> {
    const forbidden: AccessResult = {
      ok: false,
      status: 403,
      body: { error: "You can't manage guests for this call", code: "FORBIDDEN" },
    };
    if (roomName.startsWith("dm:")) {
      return isDmMember(roomName, userId)
        ? { ok: true, label: `Call with ${inviterName}` }
        : forbidden;
    }
    const projectId = projectIdFromRoom(roomName);
    if (!projectId) {
      return { ok: false, status: 400, body: { error: "Invalid roomName" } };
    }
    const failed: AccessResult = {
      ok: false,
      status: 500,
      body: { error: "Access check failed" },
    };

    const canAccess = await userClient.rpc("can_access_project", { p_project: projectId });
    if (canAccess.error) {
      console.error("call-guest can_access_project error:", canAccess.error.message);
      return failed;
    }
    if (canAccess.data !== true) return forbidden;

    const role = await userClient.rpc("project_access_role", { p_project: projectId });
    if (role.error) {
      console.error("call-guest project_access_role error:", role.error.message);
      return failed;
    }

    const project = await userClient
      .from("projects")
      .select("organization_id, name")
      .eq("project_id", projectId)
      .maybeSingle();
    if (project.error) {
      console.error("call-guest projects lookup error:", project.error.message);
      return failed;
    }
    if (!project.data) return forbidden;
    const row = project.data as { organization_id: string | null; name: string | null };

    let isOrgViewer = false;
    if (row.organization_id) {
      const viewer = await userClient.rpc("is_org_viewer", { p_org: row.organization_id });
      if (viewer.error) {
        console.error("call-guest is_org_viewer error:", viewer.error.message);
        return failed;
      }
      isOrgViewer = viewer.data === true;
    }

    const allowed = canManageGuests({
      canAccess: true,
      role: typeof role.data === "string" ? role.data : null,
      isOrgViewer,
    });
    if (!allowed) return forbidden;
    const projectName = (row.name ?? "").trim().slice(0, 200);
    return { ok: true, label: projectName || "Project call" };
  }

  // Access check happens before any invite is signed or any LiveKit admin call.
  const access = await checkAccess();
  if (!access.ok) {
    return json(access.body, access.status);
  }

  if (action === "create-invite") {
    const exp = Math.floor(Date.now() / 1000) + INVITE_TTL_SECONDS;
    try {
      const token = await signInvite(
        { room: roomName, exp, label: access.label, inviterName },
        inviteSecret,
      );
      return json({
        url: JOIN_URL_BASE + token,
        expiresAt: new Date(exp * 1000).toISOString(),
      });
    } catch (err) {
      console.error("call-guest create-invite sign error:", err);
      return json({ error: "Could not create invite" }, 500);
    }
  }

  // admit / deny → LiveKit RoomService (Twirp JSON) with a room-scoped admin JWT.
  const method = action === "admit" ? "UpdateParticipant" : "RemoveParticipant";
  const rsBody: Record<string, unknown> = action === "admit"
    ? {
      room: roomName,
      identity,
      metadata: GUEST_ADMITTED_METADATA,
      permission: guestAdmittedPermission(),
    }
    : { room: roomName, identity };

  try {
    const adminToken = await signLiveKitJwt(
      {
        iss: apiKey,
        nbf: getNumericDate(0),
        exp: getNumericDate(ADMIN_TOKEN_TTL_SECONDS),
        video: roomAdminGrant(roomName),
      },
      apiSecret,
    );
    const res = await fetch(
      `${livekitHttpUrl(livekitUrl)}/twirp/livekit.RoomService/${method}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(rsBody),
      },
    );
    if (res.ok) {
      await res.body?.cancel();
      return json({ ok: true });
    }
    const detail = await res.text().catch(() => "");
    if (classifyRoomServiceError(res.status) === "gone") {
      return json({ ok: true, gone: true });
    }
    console.error(`call-guest ${method} failed:`, res.status, detail.slice(0, 500));
    return json({ error: "LiveKit request failed", code: "LIVEKIT_ERROR" }, 502);
  } catch (err) {
    console.error(`call-guest ${method} error:`, err);
    return json({ error: "LiveKit request failed", code: "LIVEKIT_ERROR" }, 502);
  }
});
