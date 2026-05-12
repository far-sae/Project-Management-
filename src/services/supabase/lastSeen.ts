import { supabase } from "./config";
import { logger } from "@/lib/logger";

/**
 * Last-seen heartbeat / fan-out for the chat & team panels.
 *
 * Live presence (Supabase realtime channel) tells us who is *currently*
 * connected; this module fills in everyone else with a persisted
 * `user_profiles.last_seen_at` timestamp so we can render
 * "Last seen 5 min ago" instead of just "Offline".
 */

/** Update the current user's `last_seen_at` to now. Fire-and-forget. */
export const pingLastSeen = async (userId: string): Promise<void> => {
  if (!userId) return;
  try {
    const { error } = await supabase
      .from("user_profiles")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", userId);
    if (error) {
      // user_profiles row may not exist yet for brand-new sign-ups; not fatal.
      logger.warn("pingLastSeen: update failed", error);
    }
  } catch (err) {
    logger.warn("pingLastSeen: threw", err);
  }
};

/**
 * Best-effort heartbeat sent during `pagehide` so the user's last_seen_at
 * reflects the moment they closed the tab. Uses `fetch({ keepalive: true })`
 * because awaited promises won't complete during unload.
 */
export const pingLastSeenKeepalive = (userId: string): void => {
  if (!userId) return;
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) return;

    let accessToken: string | null = null;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("sb-") && k.endsWith("-auth-token")) {
          const raw = localStorage.getItem(k);
          if (!raw) continue;
          const parsed = JSON.parse(raw) as { access_token?: string };
          if (parsed?.access_token) {
            accessToken = parsed.access_token;
            break;
          }
        }
      }
    } catch {
      /* swallow — we'll try without bearer */
    }

    const url = `${supabaseUrl}/rest/v1/user_profiles?id=eq.${encodeURIComponent(userId)}`;
    void fetch(url, {
      method: "PATCH",
      keepalive: true,
      headers: {
        apikey: supabaseAnonKey,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
    }).catch(() => {});
  } catch {
    /* page is unloading — silent */
  }
};

/**
 * Fetch last_seen_at for a set of user ids. Returns a map keyed by userId
 * with the parsed Date (or null when the row exists but has never been
 * pinged). Missing users are simply absent from the map.
 */
export const fetchLastSeenForUsers = async (
  userIds: string[],
): Promise<Map<string, Date | null>> => {
  const out = new Map<string, Date | null>();
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return out;

  const { data, error } = await supabase
    .from("user_profiles")
    .select("id,last_seen_at")
    .in("id", unique);

  if (error) {
    logger.warn("fetchLastSeenForUsers: select failed", error);
    return out;
  }
  for (const row of data ?? []) {
    const id = row.id as string;
    const ts = row.last_seen_at as string | null;
    out.set(id, ts ? new Date(ts) : null);
  }
  return out;
};

/**
 * Subscribe to last_seen_at changes for any user in `userIds`. Calls
 * `onChange` with a fresh map whenever any of the watched profiles emit an
 * UPDATE. Returns an unsubscribe function.
 */
export const subscribeToLastSeen = (
  userIds: string[],
  onChange: (map: Map<string, Date | null>) => void,
): (() => void) => {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return () => {};

  let current: Map<string, Date | null> = new Map();
  let cancelled = false;

  // Seed with current values then subscribe.
  void fetchLastSeenForUsers(unique).then((map) => {
    if (cancelled) return;
    current = map;
    onChange(new Map(current));
  });

  // We can't filter `in.(…)` from a realtime channel, so subscribe to all
  // UPDATEs on user_profiles and drop those for irrelevant users on arrival.
  // Volume is low: this fires once a minute per active session.
  const watched = new Set(unique);
  const channel = supabase
    .channel(`last-seen-${unique.slice(0, 3).join("-")}-${Math.random().toString(36).slice(2, 8)}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "user_profiles" },
      (payload) => {
        const row = payload.new as { id?: string; last_seen_at?: string | null };
        if (!row?.id || !watched.has(row.id)) return;
        const next = new Map(current);
        next.set(row.id, row.last_seen_at ? new Date(row.last_seen_at) : null);
        current = next;
        onChange(new Map(current));
      },
    )
    .subscribe();

  return () => {
    cancelled = true;
    try {
      supabase.removeChannel(channel);
    } catch {
      /* noop */
    }
  };
};

/**
 * Heuristic: treat any user pinged within the last 90 seconds as online.
 * The heartbeat fires every 60s while the tab is visible, so a 90s window
 * covers a normal beat plus jitter without flagging long-gone tabs.
 */
export const ONLINE_THRESHOLD_MS = 90_000;

export const isUserOnline = (lastSeenAt: Date | null | undefined): boolean => {
  if (!lastSeenAt) return false;
  return Date.now() - lastSeenAt.getTime() <= ONLINE_THRESHOLD_MS;
};

/** Format a Date as "Online" / "Last seen Xm ago" — chat header style. */
export const formatLastSeen = (
  lastSeenAt: Date | null | undefined,
  isOnline: boolean,
): string => {
  if (isOnline) return "Online";
  if (!lastSeenAt) return "Offline";
  const diffMs = Date.now() - lastSeenAt.getTime();
  if (diffMs < 0) return "Online";
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "Last seen just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `Last seen ${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `Last seen ${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "Last seen yesterday";
  if (day < 7) return `Last seen ${day} days ago`;
  // Older — surface the absolute date so it doesn't drift into "weeks ago".
  return `Last seen ${lastSeenAt.toLocaleDateString()}`;
};
