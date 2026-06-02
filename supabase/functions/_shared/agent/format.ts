// supabase/functions/_shared/agent/format.ts
// Timezone-aware helpers for the chat bot. formatLocal renders a UTC ISO
// instant in the user's IANA timezone; loadUserTimezone fetches that zone
// from user_profiles (null => "UTC").

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Render an ISO-8601 instant in the given IANA timezone as
 *  "1 Jun 2026, 16:00". Falls back to UTC for null/empty tz, and returns the
 *  input unchanged if it is not a parseable date. */
export const formatLocal = (iso: string, tz: string | null | undefined): string => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const zone = tz && tz.trim() ? tz.trim() : "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}`;
  } catch {
    return formatLocal(iso, "UTC");
  }
};

/** Look up a linked user's IANA timezone. Returns "UTC" when unset. */
export const loadUserTimezone = async (
  admin: SupabaseClient,
  userId: string,
): Promise<string> => {
  const { data } = await admin
    .from("user_profiles")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle();
  const tz = (data as { timezone?: string | null } | null)?.timezone;
  return tz && tz.trim() ? tz.trim() : "UTC";
};
