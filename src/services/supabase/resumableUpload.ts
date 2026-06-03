// src/services/supabase/resumableUpload.ts
// Resumable (TUS) uploads to Supabase Storage — reliable for large files
// (up to 500 MB) where a single-request .upload() would time out.
import * as tus from "tus-js-client";
import { supabase } from "./config";

export const MAX_ATTACHMENT_BYTES = 500 * 1024 * 1024; // 500 MB

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export interface ResumableUploadOpts {
  bucket: string;
  path: string;
  file: File;
  contentType?: string;
  onProgress?: (pct: number) => void;
}

/** Upload a file to Supabase Storage via the resumable (TUS) protocol.
 *  Resolves when the object is fully stored; rejects on unrecoverable error. */
export const resumableUpload = async (opts: ResumableUploadOpts): Promise<void> => {
  if (opts.file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`File exceeds the ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB limit`);
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(opts.file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      chunkSize: 6 * 1024 * 1024, // Supabase requires exactly 6MB chunks
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: {
        authorization: `Bearer ${token}`,
        apikey: ANON_KEY,
        "x-upsert": "false",
      },
      metadata: {
        bucketName: opts.bucket,
        objectName: opts.path,
        contentType: opts.contentType || opts.file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      onError: (err) => reject(err instanceof Error ? err : new Error(String(err))),
      onProgress: (sent, total) => opts.onProgress?.(total ? Math.round((sent / total) * 100) : 0),
      onSuccess: () => resolve(),
    });
    upload.findPreviousUploads().then((prev) => {
      if (prev.length > 0) upload.resumeFromPreviousUpload(prev[0]);
      upload.start();
    }).catch(() => upload.start());
  });
};
