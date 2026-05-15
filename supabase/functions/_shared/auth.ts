import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

export interface AuthContext {
  userId: string;
  supabase: SupabaseClient;
}

/**
 * Verifies the Authorization: Bearer <token> header against Supabase auth.
 * Mirrors the pattern in supabase/functions/create-checkout-session/index.ts.
 * Throws Response on failure (caller does `try { await verifyUser(req) } catch (r) { return r }`).
 */
export async function verifyUser(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const token = authHeader.slice(7);
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    throw new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const supabase = createClient(supabaseUrl, serviceKey);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return { userId: data.user.id, supabase };
}
