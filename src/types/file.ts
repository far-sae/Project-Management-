export type FileScope = 'project' | 'task';

export interface ProjectFile {
  fileId: string;
  projectId: string;
  organizationId: string;  // Multi-tenancy: link to organization
  taskId?: string;
  fileName: string;
  fileUrl: string;
  storagePath: string;
  fileType: string;
  fileSize: number;
  scope: FileScope;
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: Date;
  thumbnailUrl?: string;
  metadata?: {
    width?: number;
    height?: number;
    duration?: number;
  };
}

export interface FileUploadProgress {
  fileId: string;
  fileName: string;
  progress: number;
  status: 'uploading' | 'completed' | 'error';
  error?: string;
}

export interface CreateFileInput {
  projectId: string;
  taskId?: string;
  file: File;
  scope: FileScope;
}
