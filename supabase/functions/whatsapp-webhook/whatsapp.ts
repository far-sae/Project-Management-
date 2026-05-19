// supabase/functions/whatsapp-webhook/whatsapp.ts
// Minimal Meta Cloud API client. Only the methods we use.

const ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const API_VERSION = Deno.env.get("WHATSAPP_API_VERSION") ?? "v20.0";

const BASE = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}`;

export interface InteractiveButton {
  /** Callback id <= 256 chars, A-Z 0-9 _ -. We use "confirm:<uuid>" etc. */
  id: string;
  /** Visible label on the button (max 20 chars). */
  title: string;
}

const post = async (path: string, body: Record<string, unknown>) => {
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    throw new Error("WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not configured");
  }
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`whatsapp ${path} failed:`, res.status, json);
    throw new Error(
      `whatsapp ${path} failed: ${res.status} ${(json as any)?.error?.message ?? ""}`,
    );
  }
  return json;
};

/** Plain text message. WhatsApp doesn't render Markdown, so we strip
 *  asterisks and backticks before send. */
const stripMarkdown = (s: string): string =>
  s.replace(/\*([^*]+)\*/g, "$1").replace(/`([^`]+)`/g, "$1");

export const sendMessage = async (to: string, text: string): Promise<void> => {
  await post("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: stripMarkdown(text) },
  });
};

/** Interactive reply buttons (max 3). WhatsApp's hard cap. We use this
 *  for Confirm / Cancel / Edit and for disambiguation choices. */
export const sendButtons = async (
  to: string,
  body: string,
  buttons: InteractiveButton[],
): Promise<void> => {
  if (buttons.length === 0) {
    return sendMessage(to, body);
  }
  const capped = buttons.slice(0, 3);
  await post("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: stripMarkdown(body) },
      action: {
        buttons: capped.map((b) => ({
          type: "reply",
          reply: {
            id: b.id.slice(0, 256),
            title: b.title.slice(0, 20),
          },
        })),
      },
    },
  });
};

/** Acknowledges that we've read a message — purely a UX nicety (the
 *  user sees a blue tick faster). Failure is non-fatal. */
export const markRead = async (messageId: string): Promise<void> => {
  try {
    await post("/messages", {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    });
  } catch (err) {
    console.warn("whatsapp markRead failed:", err);
  }
};
