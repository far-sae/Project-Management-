// supabase/functions/crm-run-automations/shared/client.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
export const APP_ORIGIN = Deno.env.get("APP_ORIGIN") ?? "https://app.taskcalendar.com";

export const makeAdmin = () =>
  createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
