import { supabase } from './config';

export const HR_DOCUMENTS_BUCKET = 'hr-documents';
/** Matches the bucket's limit in migration 179. */
export const HR_DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

export type DocumentCategory = 'contract' | 'id' | 'letter' | 'certificate' | 'other';

export const DOCUMENT_CATEGORY_LABEL: Record<DocumentCategory, string> = {
  contract: 'Contract',
  id: 'ID',
  letter: 'Letter',
  certificate: 'Certificate',
  other: 'Other',
};

export interface EmployeeDocument {
  id: string;
  organizationId: string;
  userId: string;
  title: string;
  category: DocumentCategory;
  fileName: string;
  filePath: string;
  fileSize: number;
  fileType: string | null;
  /** `yyyy-MM-dd` */
  expiresOn: string | null;
  uploadedBy: string;
  createdAt: Date;
}

export interface UploadDocumentInput {
  userId: string;
  title: string;
  category: DocumentCategory;
  expiresOn?: string | null;
  file: File;
}

const mapDocument = (row: Record<string, unknown>): EmployeeDocument => ({
  id: row.id as string,
  organizationId: row.organization_id as string,
  userId: row.user_id as string,
  title: row.title as string,
  category: row.category as DocumentCategory,
  fileName: row.file_name as string,
  filePath: row.file_path as string,
  fileSize: Number(row.file_size ?? 0),
  fileType: (row.file_type as string) ?? null,
  expiresOn: (row.expires_on as string) ?? null,
  uploadedBy: row.uploaded_by as string,
  createdAt: new Date(row.created_at as string),
});

/** Storage path: `<org>/<employee>/<random>-<safe file name>`. */
export function hrDocumentPath(organizationId: string, userId: string, fileName: string, random: string): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'file';
  return `${organizationId}/${userId}/${random}-${safe}`;
}

export async function listEmployeeDocuments(organizationId: string): Promise<EmployeeDocument[]> {
  const { data, error } = await supabase
    .from('employee_documents')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapDocument);
}

export async function uploadEmployeeDocument(
  organizationId: string,
  uploadedBy: string,
  input: UploadDocumentInput,
): Promise<EmployeeDocument> {
  if (input.file.size > HR_DOCUMENT_MAX_BYTES) {
    throw new Error('That file is larger than 25 MB.');
  }
  const path = hrDocumentPath(organizationId, input.userId, input.file.name, crypto.randomUUID());
  const { error: uploadError } = await supabase.storage
    .from(HR_DOCUMENTS_BUCKET)
    .upload(path, input.file, { contentType: input.file.type || undefined, upsert: false });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from('employee_documents')
    .insert({
      organization_id: organizationId,
      user_id: input.userId,
      title: input.title.trim() || input.file.name,
      category: input.category,
      file_name: input.file.name,
      file_path: path,
      file_size: input.file.size,
      file_type: input.file.type || null,
      expires_on: input.expiresOn || null,
      uploaded_by: uploadedBy,
    })
    .select('*')
    .single();
  if (error) {
    // Don't leave a file nobody can see behind.
    await supabase.storage.from(HR_DOCUMENTS_BUCKET).remove([path]);
    throw error;
  }
  return mapDocument(data);
}

/** A link that opens the file for a few minutes (the bucket is private). */
export async function getEmployeeDocumentUrl(filePath: string, seconds = 300): Promise<string> {
  const { data, error } = await supabase.storage
    .from(HR_DOCUMENTS_BUCKET)
    .createSignedUrl(filePath, seconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteEmployeeDocument(doc: Pick<EmployeeDocument, 'id' | 'filePath'>): Promise<void> {
  const { error } = await supabase.from('employee_documents').delete().eq('id', doc.id);
  if (error) throw error;
  await supabase.storage.from(HR_DOCUMENTS_BUCKET).remove([doc.filePath]);
}
