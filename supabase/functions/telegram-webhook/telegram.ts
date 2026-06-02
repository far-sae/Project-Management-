// supabase/functions/telegram-webhook/telegram.ts
// Minimal Telegram Bot API client. Only the methods we use.

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

export interface InlineButton {
  text: string;
  callback_data: string;
}

const tg = async (method: string, body: Record<string, unknown>) => {
  if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN not configured");
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) {
    console.error(`telegram ${method} failed:`, json);
    throw new Error(`telegram ${method} failed: ${json.description ?? res.status}`);
  }
  return json.result;
};

export const sendMessage = async (
  chatId: number | string,
  text: string,
  keyboard?: InlineButton[][],
): Promise<void> => {
  await tg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
};

export const answerCallbackQuery = async (
  callbackQueryId: string,
  text?: string,
): Promise<void> => {
  await tg("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
};

export const editMessageText = async (
  chatId: number | string,
  messageId: number,
  text: string,
): Promise<void> => {
  await tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "Markdown",
  });
};

export interface DownloadedMedia {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}

/** Fetch a Telegram file by file_id: getFile → download from the file API. */
export const downloadMedia = async (
  fileId: string,
  mimeHint: string,
  fileNameHint: string,
): Promise<DownloadedMedia> => {
  const file = await tg("getFile", { file_id: fileId }); // { file_path, ... }
  const path = (file as { file_path: string }).file_path;
  const res = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${path}`);
  if (!res.ok) throw new Error(`telegram file download failed: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, mimeType: mimeHint || "application/octet-stream", fileName: fileNameHint || path.split("/").pop() || "file" };
};
