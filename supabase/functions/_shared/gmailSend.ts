// supabase/functions/_shared/gmailSend.ts
// Shared Gmail send helper used by the recipe sendEmail action handler
// and by ai-agent-approve (and any future caller). Pure side-effect of
// sending the email; no run logging, no usage events. Caller decides
// what to record.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decrypt } from "./crypto.ts";

const TOKEN_KEY = Deno.env.get("INTEGRATION_TOKEN_KEY") ?? "";

export interface GmailSendArgs {
  admin: SupabaseClient;
  senderUserId: string;
  to: string;
  subject: string;
  bodyText?: string;        // if omitted, derived from bodyHtml
  bodyHtml: string;
  replyToToken?: string;    // becomes reply+<token>@inboundDomain
  inboundDomain?: string;
}

export interface GmailSendResult {
  messageId: string | null;
  threadId: string | null;
  to: string;
  replyTo: string;
}

const base64Url = (utf8: Uint8Array): string => {
  let bin = "";
  utf8.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const buildRawMessage = (a: {
  fromEmail: string;
  fromName: string | null;
  to: string;
  replyTo: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
}): string => {
  const fromHeader = a.fromName
    ? `${a.fromName.replace(/"/g, "")} <${a.fromEmail}>`
    : a.fromEmail;
  const boundary = `tcb_${crypto.randomUUID()}`;
  const lines = [
    `From: ${fromHeader}`,
    `To: ${a.to}`,
    `Reply-To: ${a.replyTo}`,
    `Subject: ${a.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    a.bodyText,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "",
    a.bodyHtml,
    "",
    `--${boundary}--`,
  ];
  return base64Url(new TextEncoder().encode(lines.join("\r\n")));
};

export const sendViaGmail = async (a: GmailSendArgs): Promise<GmailSendResult> => {
  if (!TOKEN_KEY) throw new Error("INTEGRATION_TOKEN_KEY not configured");

  const { data: integration, error } = await a.admin
    .from("integrations")
    .select("access_token_encrypted, metadata")
    .eq("user_id", a.senderUserId)
    .eq("provider", "gmail")
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`gmail integration lookup failed: ${error.message}`);
  if (!integration) {
    throw new Error(`no active Gmail integration for user ${a.senderUserId}`);
  }

  const accessToken = await decrypt(
    integration.access_token_encrypted as string,
    TOKEN_KEY,
  );

  const metadata = (integration.metadata ?? {}) as { email?: string; name?: string };
  const fromEmail = metadata.email;
  if (!fromEmail) {
    throw new Error("Gmail integration metadata has no email — reconnect");
  }
  const fromName = metadata.name ?? null;

  const replyTo = a.replyToToken && a.inboundDomain
    ? `reply+${a.replyToToken}@${a.inboundDomain}`
    : fromEmail;

  const bodyText = a.bodyText ?? a.bodyHtml.replace(/<[^>]+>/g, "");

  const raw = buildRawMessage({
    fromEmail, fromName,
    to: a.to, replyTo,
    subject: a.subject,
    bodyText, bodyHtml: a.bodyHtml,
  });

  const res = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ raw }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`gmail HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json() as { id?: string; threadId?: string };
  return {
    messageId: json.id ?? null,
    threadId: json.threadId ?? null,
    to: a.to,
    replyTo,
  };
};
