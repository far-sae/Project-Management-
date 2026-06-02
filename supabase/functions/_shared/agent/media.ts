// supabase/functions/_shared/agent/media.ts
// Provider-agnostic media handling: transcribe audio to text (OpenAI), and
// upload a file as an attachment on a CRM/PM record (Supabase Storage + the
// attachments table from migration 116). Downloading the bytes is the
// provider's job; this module takes the bytes.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { AgentProvider } from "./types.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const TRANSCRIBE_MODEL = Deno.env.get("OPENAI_TRANSCRIBE_MODEL") ?? "whisper-1";

// entity_type values permitted by the attachments CHECK constraint (migration 116).
export const ATTACH_ENTITY_TYPES = new Set([
  "lead", "contact", "client", "deal", "task", "meeting", "call",
]);

export interface LastEntity { type: string; id: string; label: string; }

/** Storage object path: <org_id>/<entity_type>/<entity_id>/<attachment_id>-<file>. */
export const storagePath = (
  orgId: string, entityType: string, entityId: string, attachmentId: string, fileName: string,
): string => `${orgId}/${entityType}/${entityId}/${attachmentId}-${fileName}`;

/** Transcribe audio bytes to text via OpenAI. apiKey defaults to the env key
 *  (passed explicitly in tests). Throws on a non-2xx response. */
export const transcribeAudio = async (
  bytes: Uint8Array,
  mimeType: string,
  apiKey: string = OPENAI_API_KEY,
): Promise<string> => {
  const form = new FormData();
  const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") || mimeType.includes("m4a") ? "m4a" : mimeType.includes("wav") ? "wav" : mimeType.includes("mpeg") ? "mp3" : "ogg";
  form.append("file", new Blob([bytes.buffer as ArrayBuffer], { type: mimeType }), `audio.${ext}`);
  form.append("model", TRANSCRIBE_MODEL);
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`transcription failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return (json.text ?? "").trim();
};

/** Upload bytes to the attachments bucket and insert the metadata row.
 *  Returns the attachment id. Caller must pass an attachable entityType. */
export const attachToEntity = async (
  admin: SupabaseClient,
  orgId: string,
  uploadedBy: string,
  entityType: string,
  entityId: string,
  bytes: Uint8Array,
  mimeType: string,
  fileName: string,
): Promise<string> => {
  const attachmentId = crypto.randomUUID();
  const path = storagePath(orgId, entityType, entityId, attachmentId, fileName);
  const { error: upErr } = await admin.storage.from("attachments").upload(path, bytes, {
    contentType: mimeType, upsert: false,
  });
  if (upErr) throw new Error(`upload failed: ${upErr.message}`);
  const { error: rowErr } = await admin.from("attachments").insert({
    attachment_id: attachmentId,
    organization_id: orgId,
    entity_type: entityType,
    entity_id: entityId,
    file_name: fileName,
    mime_type: mimeType,
    size_bytes: bytes.byteLength,
    storage_path: path,
    uploaded_by: uploadedBy,
  });
  if (rowErr) {
    await admin.storage.from("attachments").remove([path]);
    throw new Error(`attachment row failed: ${rowErr.message}`);
  }
  return attachmentId;
};

/** Persist the chat's most-recent record into integrations.metadata.last_entity. */
export const setLastEntity = async (
  admin: SupabaseClient,
  provider: AgentProvider,
  userId: string,
  entity: LastEntity,
): Promise<void> => {
  const { data } = await admin.from("integrations").select("metadata")
    .eq("provider", provider).eq("user_id", userId).maybeSingle();
  const meta = ((data?.metadata ?? {}) as Record<string, unknown>);
  await admin.from("integrations")
    .update({ metadata: { ...meta, last_entity: entity } })
    .eq("provider", provider).eq("user_id", userId);
};

/** Read back the last-touched record for a chat (for the default attach target). */
export const loadLastEntity = async (
  admin: SupabaseClient,
  provider: AgentProvider,
  userId: string,
): Promise<LastEntity | null> => {
  const { data } = await admin.from("integrations").select("metadata")
    .eq("provider", provider).eq("user_id", userId).maybeSingle();
  const le = (data?.metadata as { last_entity?: LastEntity } | null)?.last_entity;
  return le && le.type && le.id ? le : null;
};
