// supabase/functions/crm-run-automations/actions/sendSms.ts
import { ActionHandler } from "../shared/types.ts";
import { substitute } from "../shared/substitute.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Send an SMS via the sms-send edge function. config:
 *  { to: "<E.164>" | "client_phone" | template, body: "<template>" } */
export const sendSms: ActionHandler = async (ctx, config) => {
  const payload = ctx.event.payload as Record<string, unknown>;
  const clientId = (payload.client_id as string | undefined) ?? null;
  const dealId = (payload.deal_id as string | undefined) ?? null;

  // Resolve recipient.
  let to = "";
  const rawTo = String(config.to ?? "").trim();
  if (rawTo === "client_phone") {
    if (!clientId) return { status: "skipped", message: "No client to read a phone from" };
    const { data } = await ctx.admin
      .from("clients")
      .select("phone")
      .eq("client_id", clientId)
      .maybeSingle();
    to = (data as { phone?: string } | null)?.phone ?? "";
  } else {
    to = substitute(rawTo, {
      deal: payload as any,
      client: { name: payload.client_name as string | undefined },
      recipe: { name: ctx.recipeName },
    });
  }
  if (!to || !/^\+\d{6,}$/.test(to)) {
    return { status: "skipped", message: `No valid E.164 recipient ("${to}")` };
  }

  const body = substitute(String(config.body ?? ""), {
    deal: payload as any,
    client: { name: payload.client_name as string | undefined },
    recipe: { name: ctx.recipeName },
  });
  if (!body.trim()) return { status: "skipped", message: "Empty SMS body" };

  const res = await fetch(`${SUPABASE_URL}/functions/v1/sms-send`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ organizationId: ctx.orgId, to, body, clientId, dealId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data as { ok?: boolean }).ok === false) {
    return {
      status: "failure",
      message: (data as { error?: string }).error ?? `sms-send ${res.status}`,
    };
  }
  return {
    status: "success",
    meta: { provider_sid: (data as { providerSid?: string }).providerSid },
  };
};
