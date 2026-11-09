// Supabase Edge Function: mint LiveKit access tokens for authenticated users.
// Deploy: supabase functions deploy livekit-token
//
// Secrets (Dashboard → Project Settings → Edge Functions → Manage secrets):
//   LIVEKIT_API_KEY     — required (e.g. APIxxx... from cloud.livekit.io)
//   LIVEKIT_API_SECRET  — required (the matching secret)
//   LIVEKIT_URL         — required (e.g. wss://yourname.livekit.cloud)
//   ALLOWED_ORIGINS     — optional comma-list of permitted browser origins
//
// Why a server endpoint: LiveKit access tokens are HS256-signed JWTs that
// embed room + participant grants. The signing secret cannot ship to the
// browser, so the client calls this function with its Supabase auth header
// and we sign a short-lived token scoped to the room they asked for.
//
// The client never picks the room name freely — it must match a project the
// user belongs to (project:<projectId>) or a DM pair they're a participant
// in (dm:<sortedUserPair>). Anything else is rejected so a stolen token
// can't be used to crash a different team's call.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
import {
  guestsToEvict,
  livekitHttpUrl,
  type LiveKitRoomAdminGrant,
  type LiveKitVideoGrant,
  memberGrant,
  roomAdminGrant,
} from "../_shared/livekitRoles.ts";

const allowedOriginsRaw = Deno.env.get("ALLOWED_ORIGINS") ?? "";
// Normalize: trim, strip trailing slashes, lowercase scheme+host. Browsers send
// `Origin: https://example.com` (no slash, no path); a misconfigured secret of
// `https://example.com/` would otherwise echo back with the slash and fail the
// CORS check.
const normalizeOrigin = (o: string): string =>
  o.trim().replace(/\/+$/, "");
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

// LiveKit's video grant (subset) lives in ../_shared/livekitRoles.ts — full
// schema in https://github.com/livekit/protocol.

interface LiveKitAccessTokenClaims extends Record<string, unknown> {
  iss: string; // API key
  sub: string; // participant identity
  nbf: number;
  exp: number;
  name?: string;
  metadata?: string;
  video: LiveKitVideoGrant;
}

interface LiveKitServerClaims extends Record<string, unknown> {
  iss: string;
  nbf: number;
  exp: number;
  video: LiveKitRoomAdminGrant;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/**
 * Guests must never outlive the team in a room: project rooms are reused and
 * guest tokens last 2h, so an admitted guest left behind would otherwise see
 * the next call. When a member is about to join a room that holds only
 * guests, remove the admitted ones (waiting guests can't see or hear anything
 * and may simply be early). Best effort — every failure is logged and ignored
 * (the room usually doesn't exist yet → 404).
 */
async function evictLeftoverGuests(
  roomName: string,
  apiKey: string,
  apiSecret: string,
  livekitUrl: string,
): Promise<void> {
  try {
    const claims: LiveKitServerClaims = {
      iss: apiKey,
      nbf: getNumericDate(0),
      exp: getNumericDate(60),
      video: roomAdminGrant(roomName),
    };
    const adminToken = await create(
      { alg: "HS256", typ: "JWT" },
      claims,
      await importHmacKey(apiSecret),
    );
    const base = `${livekitHttpUrl(livekitUrl)}/twirp/livekit.RoomService`;
    const call = (method: string, body: Record<string, unknown>) =>
      fetch(`${base}/${method}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(body),
        // Never let cleanup hold up the member's token for long.
        signal: AbortSignal.timeout(3000),
      });

    const listRes = await call("ListParticipants", { room: roomName });
    if (!listRes.ok) {
      await listRes.body?.cancel();
      if (listRes.status !== 404) {
        console.warn("livekit-token ListParticipants failed:", listRes.status);
      }
      return;
    }
    const listed = (await listRes.json()) as {
      participants?: Array<{ identity?: unknown; metadata?: unknown }>;
    };
    const participants = (listed.participants ?? []).map((p) => ({
      identity: typeof p.identity === "string" ? p.identity : "",
      metadata: typeof p.metadata === "string" ? p.metadata : undefined,
    }));
    for (const identity of guestsToEvict(participants)) {
      try {
        const res = await call("RemoveParticipant", { room: roomName, identity });
        await res.body?.cancel();
        if (!res.ok && res.status !== 404) {
          console.warn("livekit-token RemoveParticipant failed:", res.status);
        }
      } catch (err) {
        console.warn("livekit-token RemoveParticipant error:", err);
      }
    }
  } catch (err) {
    console.warn("livekit-token guest cleanup error:", err);
  }
}

/**
 * Validate the requested room name against a fixed allowlist of shapes:
 *   project:<uuid-ish>
 *   dm:<sortedUserA>__<sortedUserB>
 *
 * Anything else is rejected — we don't want a compromised client to mint a
 * token for an attacker-controlled room and grief other tenants.
 */
function isValidRoomName(name: string): boolean {
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
  return false;
}

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

  // Authenticated users only — prevents anonymous abuse of LiveKit billing
  // and ensures we know which Supabase user is asking for a token.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    return json(
      { error: "Server misconfigured: missing SUPABASE_URL/ANON_KEY" },
      500,
    );
  }
  const authClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user }, error: authError } = await authClient.auth.getUser(
    authHeader.slice(7),
  );
  if (authError || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const apiKey = (Deno.env.get("LIVEKIT_API_KEY") ?? "").trim();
  const apiSecret = (Deno.env.get("LIVEKIT_API_SECRET") ?? "").trim();
  const livekitUrl = (Deno.env.get("LIVEKIT_URL") ?? "").trim();
  if (!apiKey || !apiSecret || !livekitUrl) {
    return json(
      {
        error:
          "LIVEKIT_* secrets are not set on this Edge Function. In Supabase: Project Settings → Edge Functions → Secrets, add LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL, then redeploy: supabase functions deploy livekit-token",
        code: "MISSING_LIVEKIT_CONFIG",
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

  const body = payload as {
    roomName?: unknown;
    participantName?: unknown;
  };
  const roomName = typeof body.roomName === "string" ? body.roomName.trim() : "";
  const participantName =
    typeof body.participantName === "string"
      ? body.participantName.trim().slice(0, 100)
      : "";
  if (!roomName || !isValidRoomName(roomName)) {
    return json({ error: "Invalid roomName" }, 400);
  }

  // Use the Supabase user id as the LiveKit identity so we can correlate
  // room participants with our database. LiveKit identity must be unique
  // per participant within a room — Supabase user IDs are UUIDs, so this
  // also guarantees stable display across reconnects.
  const identity = user.id;
  const ttlSeconds = 60 * 60; // 1h — covers a long meeting plus reconnects

  // canUpdateOwnMetadata lets members set the `recording` attribute that
  // shows the "Recording" badge to everyone (guests included).
  const grant: LiveKitVideoGrant = memberGrant(roomName);
  const claims: LiveKitAccessTokenClaims = {
    iss: apiKey,
    sub: identity,
    nbf: getNumericDate(0),
    exp: getNumericDate(ttlSeconds),
    name: participantName || identity,
    video: grant,
  };

  try {
    const key = await importHmacKey(apiSecret);
    const token = await create(
      { alg: "HS256", typ: "JWT" },
      claims,
      key,
    );
    await evictLeftoverGuests(roomName, apiKey, apiSecret, livekitUrl);
    return json({ token, url: livekitUrl, identity, roomName }, 200);
  } catch (err) {
    console.error("livekit-token sign error:", err);
    return json(
      {
        error: err instanceof Error ? err.message : "Token sign failed",
      },
      500,
    );
  }
});
