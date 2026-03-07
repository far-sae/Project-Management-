import { createClient, SupabaseClient } from "@supabase/supabase-js";

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

export const supabase: SupabaseClient = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
