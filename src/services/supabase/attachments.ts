// src/services/supabase/attachments.ts
//
// File attachments for any CRM entity (lead / contact / client / deal /
// task / meeting / call). Metadata lives in public.attachments
// (migration 116); blobs live in the 'attachments' Supabase Storage
// bucket. Path convention is enforced here so the storage RLS policies
// (also in 116) can extract the org_id from the first path segment.

import { supabase } from "./config";
import { logger } from "@/lib/logger";
import { resumableUpload, MAX_ATTACHMENT_BYTES } from "./resumableUpload";

export type AttachmentEntityType =
  | "lead" | "contact" | "client" | "deal"
  | "task" | "meeting" | "call";

export interface Attachment {
  attachmentId: string;
  organizationId: string;
  entityType: AttachmentEntityType;
  entityId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  storagePath: string;
  uploadedBy: string | null;
  uploadedByName: string | null;
  createdAt: Date;
}

const BUCKET = "attachments";

const mapAttachment = (row: Record<string, unknown>): Attachment => ({
  attachmentId: row.attachment_id as string,
  organizationId: row.organization_id as string,
  entityType: row.entity_type as AttachmentEntityType,
  entityId: row.entity_id as string,
  fileName: row.file_name as string,
  mimeType: (row.mime_type as string | null) ?? null,
  sizeBytes: Number(row.size_bytes ?? 0),
  storagePath: row.storage_path as string,
  uploadedBy: (row.uploaded_by as string | null) ?? null,
  uploadedByName: (row.uploaded_by_name as string | null) ?? null,
  createdAt: new Date(row.created_at as string),
});

/** List every attachment on a given entity, newest first. */
export const listEntityAttachments = async (
  organizationId: string,
  entityType: AttachmentEntityType,
  entityId: string,
): Promise<Attachment[]> => {
  const { data, error } = await supabase
    .from("attachments")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false });
  if (error) {
    logger.error("listEntityAttachments failed:", error);
    throw new Error(error.message);
  }
  return (data ?? []).map((r) => mapAttachment(r as Record<string, unknown>));
};

/**
 * Upload a file against an entity:
 *   1. PUT bytes to <org>/<entity_type>/<entity_id>/<rand>-<name>
 *   2. INSERT metadata row pointing at the path
 *   3. Roll back the storage object if the metadata insert fails so
 *      we never leave orphan blobs.
 */
export const uploadAttachment = async (params: {
  organizationId: string;
  entityType: AttachmentEntityType;
  entityId: string;
  file: File;
  uploadedBy: string | null;
  uploadedByName: string | null;
  onProgress?: (pct: number) => void;
}): Promise<Attachment> => {
  const { organizationId, entityType, entityId, file, uploadedBy, uploadedByName } = params;
  // Stable per-row prefix keeps blobs grouped + makes signed-URL
  // requests obvious in logs. Random suffix avoids collisions when the
  // user uploads two files with the same name.
  const rand = crypto.randomUUID().slice(0, 8);
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const storagePath = `${organizationId}/${entityType}/${entityId}/${rand}-${safeName}`;

  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`File exceeds the ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB limit`);
  }
  try {
    await resumableUpload({
      bucket: BUCKET, path: storagePath, file,
      contentType: file.type || undefined, onProgress: params.onProgress,
    });
  } catch (uploadErr) {
    logger.error("attachment upload failed:", uploadErr);
    throw new Error(uploadErr instanceof Error ? uploadErr.message : "Upload failed");
  }

  const { data, error: insertErr } = await supabase
    .from("attachments")
    .insert({
      organization_id: organizationId,
      entity_type: entityType,
      entity_id: entityId,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      storage_path: storagePath,
      uploaded_by: uploadedBy,
      uploaded_by_name: uploadedByName,
    })
    .select("*")
    .single();

  if (insertErr) {
    // Roll back the storage object so a failed insert doesn't leave
    // an orphan we can't see in the metadata table.
    await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    logger.error("attachment insert failed:", insertErr);
    throw new Error(insertErr.message);
  }
  return mapAttachment(data as Record<string, unknown>);
};

/** Get a short-lived signed URL the browser can use to download a blob. */
export const getAttachmentSignedUrl = async (
  storagePath: string,
  expiresInSeconds = 60,
): Promise<string> => {
  const { data, error } = await supabase
    .storage.from(BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Could not create download link");
  }
  return data.signedUrl;
};

/** Delete both the metadata row and the underlying blob. */
export const deleteAttachment = async (a: Attachment): Promise<void> => {
  // Delete the storage object first; if the metadata delete later
  // fails, the operator at least won't see the file in the list (and
  // a periodic sweep can drop the dangling row).
  await supabase.storage.from(BUCKET).remove([a.storagePath]).catch((err) => {
    logger.warn("attachment storage delete failed:", err);
  });
  const { error } = await supabase
    .from("attachments")
    .delete()
    .eq("attachment_id", a.attachmentId);
  if (error) {
    logger.error("attachment metadata delete failed:", error);
    throw new Error(error.message);
  }
};

/** Pretty-printable size — "1.2 MB", "812 KB", "4 B". */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};
