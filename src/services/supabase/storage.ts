import { supabase } from "./config";
import { logger } from "@/lib/logger";

export interface FileUploadResult {
  url: string;
  path: string;
  name: string;
  size: number;
  type: string;
}

export const uploadFile = async (
  file: File,
  bucket: string,
  path: string,
): Promise<FileUploadResult> => {
  const fileName = `${Date.now()}-${sanitizeFileName(file.name)}`;
  const filePath = `${path}/${fileName}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (error) {
    logger.error("Failed to upload file:", error);
    throw error;
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(filePath);

  return {
    url: urlData.publicUrl,
    path: filePath,
    name: file.name,
    size: file.size,
    type: file.type,
  };
};

export const deleteFile = async (
  bucket: string,
  path: string,
): Promise<void> => {
  const { error } = await supabase.storage.from(bucket).remove([path]);

  if (error) {
    logger.error("Failed to delete file:", error);
    throw error;
  }
};

export const getFileUrl = (bucket: string, path: string): string => {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
};

export const listFiles = async (bucket: string, path: string = "") => {
  const { data, error } = await supabase.storage.from(bucket).list(path);

  if (error) {
    logger.error("Failed to list files:", error);
    throw error;
  }

  return data;
};

// Helper functions for common buckets
export const uploadProjectFile = (file: File, projectId: string) =>
  uploadFile(file, "project-files", `projects/${projectId}`);

export const uploadAttachment = (file: File, taskId: string) =>
  uploadFile(file, "attachments", `tasks/${taskId}`);

export const uploadAvatar = (file: File, userId: string) =>
  uploadFile(file, "avatars", `users/${userId}`);

export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
};

// File type category detector
export const getFileTypeCategory = (fileType: string): string => {
  const type = fileType.toLowerCase();

  if (
    type.includes("image") ||
    type.match(/\.(jpg|jpeg|png|gif|svg|webp|bmp)$/)
  ) {
    return "image";
  }
  if (
    type.includes("video") ||
    type.match(/\.(mp4|avi|mov|wmv|flv|webm|mkv)$/)
  ) {
    return "video";
  }
  if (type.includes("audio") || type.match(/\.(mp3|wav|ogg|m4a|aac|flac)$/)) {
    return "audio";
  }
  if (
    type.includes("pdf") ||
    type.includes("word") ||
    type.includes("document") ||
    type.match(/\.(doc|docx|txt|rtf|odt)$/)
  ) {
    return "document";
  }
  if (
    type.includes("sheet") ||
    type.includes("excel") ||
    type.match(/\.(xls|xlsx|csv|ods)$/)
  ) {
    return "spreadsheet";
  }
  if (
    type.includes("presentation") ||
    type.includes("powerpoint") ||
    type.match(/\.(ppt|pptx|odp)$/)
  ) {
    return "presentation";
  }
  if (
    type.includes("zip") ||
    type.includes("rar") ||
    type.includes("7z") ||
    type.match(/\.(zip|rar|7z|tar|gz)$/)
  ) {
    return "archive";
  }

  return "other";
};

// Get project files from database (includes both project-level and task/comment files when scope is 'project')
export const getProjectFiles = async (
  projectId: string,
  organizationId: string,
  scope: string,
) => {
  const scopesToFetch = scope === "project" ? ["project", "task"] : [scope];
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("project_id", projectId)
    .eq("organization_id", organizationId)
    .in("scope", scopesToFetch)
    .order("uploaded_at", { ascending: false });

  if (error) {
    logger.error("Failed to get project files:", error);
    return [];
  }

  return (data || []).map((file: any) => ({
    fileId: file.file_id,
    projectId: file.project_id,
    organizationId: file.organization_id,
    taskId: file.task_id,
    fileName: file.file_name,
    fileUrl: file.file_url,
    storagePath: file.storage_path,
    fileType: file.file_type,
    fileSize: file.file_size,
    scope: file.scope,
    uploadedBy: file.uploaded_by,
    uploadedByName: file.uploaded_by_name,
    uploadedAt: new Date(file.uploaded_at),
    thumbnailUrl: file.thumbnail_url,
    metadata: file.metadata,
  }));
};

// Upload file with progress tracking
export const uploadFileWithProgress = async (
  userId: string,
  userName: string,
  organizationId: string,
  input: {
    projectId: string;
    taskId?: string;
    file: File;
    scope: string;
  },
  onProgress?: (progress: any) => void,
) => {
  const fileName = `${Date.now()}-${sanitizeFileName(input.file.name)}`;
  const bucket = "project-files";
  const path = input.taskId
    ? `${organizationId}/${input.projectId}/tasks/${input.taskId}/${fileName}`
    : `${organizationId}/${input.projectId}/${fileName}`;

  // Start upload with progress
  if (onProgress) {
    onProgress({
      fileId: fileName,
      fileName: input.file.name,
      progress: 0,
      status: "uploading",
    });
  }

  // Upload to storage
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, input.file, {
      cacheControl: "3600",
      upsert: false,
    });

  if (uploadError) {
    logger.error("Failed to upload file:", uploadError);
    if (onProgress) {
      onProgress({
        fileId: fileName,
        fileName: input.file.name,
        progress: 0,
        status: "error",
        error: uploadError.message,
      });
    }
    throw uploadError;
  }

  // Get public URL
  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);

  if (onProgress) {
    onProgress({
      fileId: fileName,
      fileName: input.file.name,
      progress: 50,
      status: "uploading",
    });
  }

  // Save to database
  const fileRecord = {
    file_id: crypto.randomUUID(),
    project_id: input.projectId,
    task_id: input.taskId || null,
    organization_id: organizationId,
    file_name: input.file.name,
    file_url: urlData.publicUrl,
    storage_path: path,
    file_type: input.file.type,
    file_size: input.file.size,
    scope: input.scope,
    uploaded_by: userId,
    uploaded_by_name: userName,
    uploaded_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("files")
    .insert(fileRecord)
    .select()
    .single();

  if (error) {
    logger.error("Failed to save file record:", error);
    // Clean up uploaded file
    await supabase.storage.from(bucket).remove([path]);
    throw error;
  }

  if (onProgress) {
    onProgress({
      fileId: data.file_id,
      fileName: input.file.name,
      progress: 100,
      status: "completed",
    });
  }

  return {
    fileId: data.file_id,
    projectId: data.project_id,
    organizationId: data.organization_id,
    taskId: data.task_id,
    fileName: data.file_name,
    fileUrl: data.file_url,
    storagePath: data.storage_path,
    fileType: data.file_type,
    fileSize: data.file_size,
    scope: data.scope,
    uploadedBy: data.uploaded_by,
    uploadedByName: data.uploaded_by_name,
    uploadedAt: new Date(data.uploaded_at),
  };
};

// Delete file from storage and database (handles both project-files and attachments buckets)
export const deleteFileComplete = async (
  fileId: string,
  organizationId: string,
): Promise<void> => {
  const { data: file, error: fetchError } = await supabase
    .from("files")
    .select("storage_path")
    .eq("file_id", fileId)
    .eq("organization_id", organizationId)
    .single();

  if (fetchError) {
    logger.error("Failed to fetch file:", fetchError);
    throw fetchError;
  }

  const isAttachment = file.storage_path && String(file.storage_path).startsWith("attachments/");
  const bucket = isAttachment ? "attachments" : "project-files";
  const path = isAttachment ? String(file.storage_path).replace(/^attachments\//, "") : file.storage_path;

  const { error: storageError } = await supabase.storage
    .from(bucket)
    .remove([path]);

  if (storageError) {
    logger.error("Failed to delete from storage:", storageError);
  }

  // Delete from database
  const { error: dbError } = await supabase
    .from("files")
    .delete()
    .eq("file_id", fileId)
    .eq("organization_id", organizationId);

  if (dbError) {
    logger.error("Failed to delete file record:", dbError);
    throw dbError;
  }
};

// Upload comment attachment and optionally register in files table so it appears on Files page
export const uploadCommentAttachment = async (
  file: File,
  taskId: string,
  organizationId: string,
  options?: {
    projectId?: string;
    userId?: string;
    userName?: string;
  },
): Promise<{
  fileId: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
}> => {
  const safeName = sanitizeFileName(file.name);
  const fileName = `${Date.now()}-${safeName}`;
  const path = `${organizationId}/tasks/${taskId}/${fileName}`;
  const bucket = "attachments";

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { cacheControl: "3600", upsert: false });

  if (error) {
    logger.error("Failed to upload comment attachment:", error);
    throw error;
  }

  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
  const fileId = crypto.randomUUID();

  if (options?.projectId) {
    const fileRecord = {
      file_id: fileId,
      project_id: options.projectId,
      task_id: taskId,
      organization_id: organizationId,
      file_name: file.name,
      file_url: urlData.publicUrl,
      storage_path: `attachments/${path}`,
      file_type: file.type,
      file_size: file.size,
      scope: "task",
      uploaded_by: options.userId || null,
      uploaded_by_name: options.userName || "User",
      uploaded_at: new Date().toISOString(),
    };
    await supabase.from("files").insert(fileRecord).then(({ error: insertErr }) => {
      if (insertErr) logger.warn("Failed to register comment file for Files page:", insertErr);
    });
  }

  return {
    fileId,
    fileName: file.name,
    fileUrl: urlData.publicUrl,
    fileType: file.type,
  };
};

// Upload a chat attachment (project chat or direct message). Returns just the
// public URL + metadata — chat messages embed a small attachment array rather
// than registering rows in the files table (those are scoped to projects/tasks).
export const uploadChatAttachment = async (
  file: File,
  scope: { kind: "project"; projectId: string } | { kind: "dm"; threadKey: string },
): Promise<{
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  storagePath: string;
}> => {
  const safe = `${Date.now()}-${sanitizeFileName(file.name)}`;
  const dir =
    scope.kind === "project"
      ? `chat/projects/${scope.projectId}`
      : `chat/dm/${scope.threadKey}`;
  const path = `${dir}/${safe}`;
  const bucket = "attachments";

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { cacheControl: "3600", upsert: false });
  if (error) {
    logger.error("Failed to upload chat attachment:", error);
    throw error;
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return {
    fileName: file.name,
    fileUrl: data.publicUrl,
    fileType: file.type,
    fileSize: file.size,
    storagePath: path,
  };
};

const sanitizeFileName = (name: string): string => {
  // Decode any URL-encoded characters first
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    decoded = name;
  }

  // Replace all invalid characters with underscores
  // Supabase allows: letters, numbers, hyphens, underscores, dots, slashes
  const ext = decoded.substring(decoded.lastIndexOf(".")); // keep extension
  const base = decoded.substring(0, decoded.lastIndexOf(".")); // everything before ext

  const cleanBase = base
    .replace(/[^a-zA-Z0-9_\-]/g, "_") // replace anything invalid with _
    .replace(/_+/g, "_") // collapse multiple underscores
    .slice(0, 80); // cap length

  return `${cleanBase}${ext}`;
};
