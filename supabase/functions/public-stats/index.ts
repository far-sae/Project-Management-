// Supabase Edge Function: Admin-only aggregated stats
// Deploy: supabase functions deploy public-stats
// Requires JWT. Validates admin via user_profiles.role or ADMIN_USER_IDS secret.
// Returns counts only - no PII. Uses service role to bypass RLS.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) {
      return new Response(
        JSON.stringify({ error: "Server not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(url, serviceKey);
    const adminIdsRaw = Deno.env.get("ADMIN_USER_IDS") ?? "";
    const adminIds = adminIdsRaw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const isInAdminList = adminIds.length > 0 && adminIds.includes(user.id);

    let isAdmin = isInAdminList;
    if (!isAdmin) {
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      isAdmin = profile?.role === "admin";
    }
    if (!isAdmin) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // User count
    const { count: userCount } = await supabase
      .from("user_profiles")
      .select("*", { count: "exact", head: true });

    // Organization count
    const { count: orgCount } = await supabase
      .from("organizations")
      .select("*", { count: "exact", head: true });

    // Service usage: projects and tasks
    const { count: projectCount } = await supabase
      .from("projects")
      .select("*", { count: "exact", head: true });
    const { count: taskCount } = await supabase
      .from("tasks")
      .select("*", { count: "exact", head: true });

    // Subscriptions - get all for aggregation
    const { data: subs } = await supabase.from("subscriptions").select("status, plan");

    let activeTrials = 0;
    let activeStarter = 0;
    let activeBasic = 0;
    let activeAdvanced = 0;
    let activePremium = 0;
    let cancelled = 0;
    let expired = 0;
    let newThisMonth = 0;

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    for (const s of subs || []) {
      const plan = String(s?.plan || "starter").toLowerCase();
      const status = String(s?.status || "").toLowerCase();

      if (status === "trial" || plan === "trial") activeTrials++;
      else if (status === "active" || plan === "starter") {
        if (plan === "basic") activeBasic++;
        else if (plan === "advanced") activeAdvanced++;
        else if (plan === "premium") activePremium++;
        else activeStarter++;
      } else if (status === "cancelled" || status === "canceled") cancelled++;
      else if (status === "expired") expired++;
    }

    const totalActivePaid = activeStarter + activeBasic + activeAdvanced + activePremium;
    const totalActive = activeTrials + totalActivePaid;
    const totalChurned = cancelled + expired;
    const churnRate =
      totalActive + totalChurned > 0
        ? Math.round((totalChurned / (totalActive + totalChurned)) * 100)
        : 0;

    // New users this month (from user_profiles created_at)
    const { count: newUsersCount } = await supabase
      .from("user_profiles")
      .select("*", { count: "exact", head: true })
      .gte("created_at", monthStart.toISOString());
    newThisMonth = newUsersCount ?? 0;

    const body = {
      totalUsers: userCount ?? 0,
      totalOrganizations: orgCount ?? 0,
      totalProjects: projectCount ?? 0,
      totalTasks: taskCount ?? 0,
      newUsersThisMonth: newThisMonth,
      activeTrials,
      byPlan: {
        starter: activeStarter,
        basic: activeBasic,
        advanced: activeAdvanced,
        premium: activePremium,
      },
      totalActiveSubscriptions: totalActivePaid,
      totalActiveWithTrial: totalActive,
      churned: totalChurned,
      churnRate,
    };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("public-stats error:", err);
    return new Response(
      JSON.stringify({ error: "Failed to load stats" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
