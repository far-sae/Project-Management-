// Supabase Edge Function: remove a member from a project.
// Deploy: supabase functions deploy remove-member
// Gateway has verify_jwt = false in config.toml so we can handle CORS preflight
// and perform our own JWT validation + role checks (owner/admin) before removal.
// Call from browser with Authorization: Bearer <user JWT>.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing or invalid Authorization header" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const token = authHeader.slice(7);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error("remove-member: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env");
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Verify JWT using Supabase Auth instead of manual decoding
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    console.error("remove-member: auth.getUser failed", userError);
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const requesterId = user.id;

  let body: { projectId: string; memberUserId: string; memberEmail?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { projectId, memberUserId } = body;
  if (!projectId || !memberUserId) {
    return new Response(
      JSON.stringify({ error: "Missing projectId or memberUserId" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // Fetch project with members to verify ownership/admin role and then remove member
  const { data: project, error: fetchError } = await supabase
    .from("projects")
    .select("project_id, owner_id, members, stats")
    .eq("project_id", projectId)
    .maybeSingle();

  if (fetchError) {
    console.error("remove-member: fetch project error", fetchError);
    return new Response(JSON.stringify({ error: "Failed to load project" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!project) {
    return new Response(JSON.stringify({ error: "Project not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const members = (project.members || []) as any[];
  const requesterMember = members.find(
    (m) => (m.userId || m.user_id) === requesterId,
  );
  const isOwner = project.owner_id === requesterId;
  const isAdmin =
    requesterMember && (requesterMember.role === "admin" || requesterMember.role === "owner");

  if (!isOwner && !isAdmin) {
    return new Response(
      JSON.stringify({ error: "Only the project owner or an admin can remove members" }),
      {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // Owner/admin are not allowed to remove themselves via this endpoint
  if (memberUserId === requesterId) {
    return new Response(JSON.stringify({ error: "You cannot remove yourself from the project" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { error: updateError } = await supabase.rpc("remove_project_member", {
    p_project_id: projectId,
    p_member_user_id: memberUserId,
  });

  if (updateError) {
    console.error("remove-member: update error", updateError);
    return new Response(JSON.stringify({ error: "Failed to remove member" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

