// slack_post action: posts a message to a Slack channel using the org's
// connected Slack integration token.
//
// We talk to Slack directly here instead of delegating through
// `integrations-action`. The integrations-action stub still only handles
// `whoami`; teaching it the dual auth dance (user JWT vs service-role)
// needed by the cron worker is more change than just doing the API call
// in place. If we later add a "Send test Slack message" button in the
// settings UI we can refactor both call sites onto a shared helper then.

import { ActionHandler } from "../shared/types.ts";
import { substitute } from "../shared/substitute.ts";
import { decrypt } from "../../_shared/crypto.ts";

const TOKEN_KEY = Deno.env.get("INTEGRATION_TOKEN_KEY");

export const slackPost: ActionHandler = async (ctx, config) => {
  const channelId = config.channel_id as string;
  if (!channelId) {
    return { status: "failure", message: "channel_id required" };
  }
  if (!TOKEN_KEY) {
    return { status: "failure", message: "INTEGRATION_TOKEN_KEY not set on the worker" };
  }

  // Slack is org-level — there's one row per org with provider='slack'.
  const { data: integration, error: lookupErr } = await ctx.admin
    .from("integrations")
    .select("access_token_encrypted, status")
    .eq("org_id", ctx.orgId)
    .eq("provider", "slack")
    .eq("status", "active")
    .maybeSingle();

  if (lookupErr) {
    return { status: "failure", message: `Integration lookup failed: ${lookupErr.message}` };
  }
  if (!integration) {
    return {
      status: "skipped",
      message: "No active Slack integration — connect in Settings → Integrations",
    };
  }

  let botToken: string;
  try {
    botToken = await decrypt(
      (integration as { access_token_encrypted: string }).access_token_encrypted,
      TOKEN_KEY,
    );
  } catch (err) {
    return {
      status: "failure",
      message: `Token decrypt failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const text = substitute(String(config.text ?? ""), {
    deal: ctx.event.payload as any,
    client: { name: (ctx.event.payload as any).client_name },
    actor: "Automation",
    recipe: { name: ctx.recipeName },
  });

  let res: Response;
  try {
    res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "authorization": `Bearer ${botToken}`,
      },
      body: JSON.stringify({
        channel: channelId,
        text: text || " ", // Slack requires non-empty when blocks are absent
        blocks: config.blocks ?? undefined,
      }),
    });
  } catch (err) {
    return {
      status: "failure",
      message: `Network error calling Slack: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    return { status: "failure", message: `Slack HTTP ${res.status}` };
  }

  // Slack always returns 200 even on logical errors; the `ok` field carries truth.
  const body = (await res.json()) as { ok: boolean; error?: string; ts?: string; channel?: string };
  if (!body.ok) {
    // Common errors: `not_in_channel` (bot not invited & no chat:write.public),
    // `channel_not_found`, `invalid_auth`, `account_inactive`.
    return { status: "failure", message: `Slack API error: ${body.error ?? "unknown"}` };
  }

  return {
    status: "success",
    meta: { ts: body.ts ?? null, channel: body.channel ?? channelId },
  };
};
