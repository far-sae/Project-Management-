import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { GoTrueClientOptions } from "@supabase/auth-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

const hasSupabaseEnv = Boolean(supabaseUrl && supabaseAnonKey);

if (!hasSupabaseEnv) {
  console.warn(
    "⚠️ Missing Supabase env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY). Copy .env.example to .env and add your Supabase project credentials. Auth and data will not work until then."
  );
}

// Use placeholder values when env is missing so the app loads locally without crashing
const url = hasSupabaseEnv ? supabaseUrl : "https://placeholder.supabase.co";
const key = hasSupabaseEnv ? supabaseAnonKey : "placeholder-anon-key";

/**
 * Skip navigator.locks for auth in the browser. Default Web Locks + React 18 Strict Mode
 * (double mount/unmount) often leaves orphaned locks → repeated "not released within 5000ms"
 * warnings and `AbortError: Lock broken ... steal`, and can interrupt in-flight requests.
 * Session refresh still runs; cross-tab serialization is best-effort only without locks.
 * @see https://github.com/supabase/supabase-js/issues/2111
 */
const browserNoopAuthLock: NonNullable<GoTrueClientOptions["lock"]> = async (
  _name,
  _acquireTimeout,
  fn,
) => fn();

const authOptions: GoTrueClientOptions = {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true,
  /** Used when a real lock is in play (non-browser); noop lock below bypasses wait in the browser. */
  lockAcquireTimeout: 15_000,
  ...(typeof window !== "undefined" ? { lock: browserNoopAuthLock } : {}),
};

export const supabase: SupabaseClient = createClient(url, key, {
  auth: authOptions,
});
