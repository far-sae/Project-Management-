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

export interface ListRow {
  /** Row id <= 200 chars, echoed back as interactive.list_reply.id. */
  id: string;
  /** Row title (max 24 chars). */
  title: string;
}

/** Interactive list message — up to 10 rows. Used for disambiguation when
 *  there are more candidates than WhatsApp's 3-button cap allows. */
export const sendList = async (
  to: string,
  body: string,
  rows: ListRow[],
): Promise<void> => {
  const capped = rows.slice(0, 10);
  await post("/messages", {
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: stripMarkdown(body) },
      action: {
        button: "Choose",
        sections: [{
          rows: capped.map((r) => ({
            id: r.id.slice(0, 200),
            title: r.title.slice(0, 24),
          })),
        }],
      },
    },
  });
};

export interface DownloadedMedia {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}

/** Resolve a WhatsApp media id to a temporary URL, then download the bytes.
 *  Both calls require the bearer token. */
export const downloadMedia = async (
  mediaId: string,
  fileNameHint: string,
): Promise<DownloadedMedia> => {
  const metaRes = await fetch(`https://graph.facebook.com/${API_VERSION}/${mediaId}`, {
    headers: { authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!metaRes.ok) throw new Error(`whatsapp media meta failed: ${metaRes.status}`);
  const meta = await metaRes.json() as { url: string; mime_type: string };
  const binRes = await fetch(meta.url, { headers: { authorization: `Bearer ${ACCESS_TOKEN}` } });
  if (!binRes.ok) throw new Error(`whatsapp media download failed: ${binRes.status}`);
  const bytes = new Uint8Array(await binRes.arrayBuffer());
  return { bytes, mimeType: meta.mime_type || "application/octet-stream", fileName: fileNameHint || `file-${mediaId}` };
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
