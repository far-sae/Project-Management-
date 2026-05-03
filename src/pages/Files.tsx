// src/pages/Files.tsx
// Personal Files page. Each non-viewer user (owner, admin, member) sees ONLY
// their own uploads — strictly per-user isolation enforced at the query
// layer (uploaded_by + scope='personal') AND at the storage path
// ({orgId}/personal/{userId}/...). Viewers don't have access; the route
// redirects them away.
import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Navigate } from 'react-router-dom';
import {
  FileText,
  Upload,
  Folder,
  File as FileIcon,
  Image,
  FileSpreadsheet,
  Search,
  Grid,
  List,
  Download,
  Trash2,
  Loader2,
  Music,
  Video,
  CheckSquare,
  Square,
  X,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { FileUploadZone, FileUploadItem } from '@/components/files/FileUploadZone';
import {
  uploadPersonalFileWithProgress,
  getPersonalFiles,
  deleteFileComplete as deleteFile,
  formatFileSize,
  getFileTypeCategory,
} from '@/services/supabase/storage';
import { ProjectFile, FileUploadProgress } from '@/types/file';
import { cn } from '@/lib/utils';

export const Files: React.FC = () => {
  const { user } = useAuth();
  const { organization, isViewer, loading: orgLoading } = useOrganization();

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, FileUploadProgress>>({});
  const [showUploadZone, setShowUploadZone] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloadingAll, setDownloadingAll] = useState(false);

  const orgId = organization?.organizationId || user?.organizationId || '';

  useEffect(() => {
    const loadFiles = async () => {
      if (!user?.userId || !orgId) {
        setFiles([]);
        return;
      }

      setLoading(true);
      try {
        const personal = await getPersonalFiles(user.userId, orgId);
        setFiles(personal);
      } catch (error) {
        toast.error('Failed to load files');
        setFiles([]);
      } finally {
        setLoading(false);
      }
    };

    void loadFiles();
  }, [user?.userId, orgId]);

  const handleFilesSelected = useCallback(
    async (selectedFiles: File[]) => {
      if (!user || !orgId) {
        toast.error('Organization is not available for file upload');
        return;
      }

      setUploading(true);

      for (const file of selectedFiles) {
        const tempId = `temp_${Date.now()}_${file.name}`;

        setUploadProgress((prev) => ({
          ...prev,
          [tempId]: {
            fileId: tempId,
            fileName: file.name,
            progress: 0,
            status: 'uploading',
          },
        }));

        try {
          const uploadedFile = await uploadPersonalFileWithProgress(
            user.userId,
            user.displayName,
            orgId,
            file,
            (progress) => {
              setUploadProgress((prev) => ({
                ...prev,
                [tempId]: progress,
              }));
            },
          );

          setFiles((prev) => [uploadedFile, ...prev]);

          setTimeout(() => {
            setUploadProgress((prev) => {
              const next = { ...prev };
              delete next[tempId];
              return next;
            });
          }, 2000);
        } catch (error) {
          setUploadProgress((prev) => ({
            ...prev,
            [tempId]: {
              ...prev[tempId],
              status: 'error',
              error: 'Upload failed',
            },
          }));
          toast.error(`Upload failed: ${file.name}`);
        }
      }

      setUploading(false);
      setShowUploadZone(false);
    },
    [user, orgId],
  );

  const handleDeleteFile = async (fileId: string) => {
    if (!window.confirm('Are you sure you want to delete this file?')) return;

    if (!orgId) {
      toast.error('Organization is not available for file deletion');
      return;
    }

    const toastId = toast.loading('Deleting file...');
    try {
      await deleteFile(fileId, orgId);
      setFiles((prev) => prev.filter((f) => f.fileId !== fileId));
      toast.success('File deleted', { id: toastId });
    } catch (error) {
      toast.error('Failed to delete file', { id: toastId });
    }
  };

  const handleDownload = useCallback(async (file: ProjectFile): Promise<boolean> => {
    try {
      const res = await fetch(file.fileUrl, { mode: 'cors' });
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return true;
    } catch {
      window.open(file.fileUrl, '_blank');
      return false;
    }
  }, []);

  const getFileIcon = (fileType: string) => {
    const category = getFileTypeCategory(fileType);
    switch (category) {
      case 'image':
        return <Image className="w-8 h-8 text-green-500" />;
      case 'document':
        return <FileText className="w-8 h-8 text-blue-500" />;
      case 'spreadsheet':
        return <FileSpreadsheet className="w-8 h-8 text-emerald-500" />;
      case 'video':
        return <Video className="w-8 h-8 text-purple-500" />;
      case 'audio':
        return <Music className="w-8 h-8 text-pink-500" />;
      default:
        return <FileIcon className="w-8 h-8 text-muted-foreground" />;
    }
  };

  const filteredFiles = files.filter((file) =>
    file.fileName.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const toggleSelected = useCallback((fileId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const handleBulkDownload = useCallback(
    async (override?: ProjectFile[]) => {
      const visible = files.filter((file) =>
        file.fileName.toLowerCase().includes(searchQuery.toLowerCase()),
      );
      const snapshot =
        override ??
        (selectedIds.size > 0
          ? visible.filter((f) => selectedIds.has(f.fileId))
          : visible);
      if (snapshot.length === 0 || downloadingAll) return;
      setDownloadingAll(true);
      const toastId = toast.loading(
        `Downloading ${snapshot.length} file${snapshot.length === 1 ? '' : 's'}…`,
      );
      try {
        let failed = 0;
        for (let i = 0; i < snapshot.length; i++) {
          const ok = await handleDownload(snapshot[i]);
          if (!ok) failed += 1;
          if (i < snapshot.length - 1) {
            await new Promise((r) => setTimeout(r, 350));
          }
        }
        if (failed > 0) {
          toast.error('Some files could not be downloaded', { id: toastId });
        } else {
          toast.success(
            `Downloaded ${snapshot.length} file${snapshot.length === 1 ? '' : 's'}`,
            { id: toastId },
          );
        }
      } catch {
        toast.error('Some files could not be downloaded', { id: toastId });
      } finally {
        setDownloadingAll(false);
      }
    },
    [files, searchQuery, downloadingAll, handleDownload, selectedIds],
  );

  const uploadProgressItems = Object.values(uploadProgress);

  // Viewers are read-only and explicitly excluded from personal storage —
  // bounce them to /tasks (their default landing) if they reach this URL.
  // Wait for org info so we don't redirect during the initial fetch race.
  if (orgLoading) {
    return (
      <main className="flex-1 min-w-0 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </main>
    );
  }
  if (isViewer) {
    return <Navigate to="/tasks" replace />;
  }

  return (
    <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 mb-6 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">My Files</h1>
          <p className="text-sm text-muted-foreground">
            Your personal storage. Files here are private to you — no one else in your
            organization can see them.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <Button
            variant="outline"
            onClick={() => handleBulkDownload()}
            disabled={filteredFiles.length === 0 || downloadingAll}
            title={
              selectedIds.size > 0
                ? `Download ${selectedIds.size} selected file${selectedIds.size === 1 ? '' : 's'}`
                : filteredFiles.length
                  ? `Download all ${filteredFiles.length} files`
                  : 'No files to download'
            }
          >
            {downloadingAll ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            {selectedIds.size > 0 ? `Download (${selectedIds.size})` : 'Download all'}
          </Button>
          <Button
            className="bg-gradient-to-r from-orange-500 to-red-500"
            onClick={() => setShowUploadZone(!showUploadZone)}
          >
            <Upload className="w-4 h-4 mr-2" />
            Upload File
          </Button>
        </div>
      </div>

      {showUploadZone && (
        <Card className="mb-6">
          <CardContent className="py-6">
            <FileUploadZone
              onFilesSelected={handleFilesSelected}
              disabled={uploading}
              multiple={true}
              maxSizeMB={50}
            />
            {uploadProgressItems.length > 0 && (
              <div className="mt-4 space-y-2">
                {uploadProgressItems.map((item) => (
                  <FileUploadItem
                    key={item.fileId}
                    fileName={item.fileName}
                    progress={item.progress}
                    status={item.status}
                    error={item.error}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardContent className="py-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            {filteredFiles.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const allVisible = new Set(filteredFiles.map((f) => f.fileId));
                  const allSelected = filteredFiles.every((f) =>
                    selectedIds.has(f.fileId),
                  );
                  setSelectedIds(allSelected ? new Set() : allVisible);
                }}
                title="Select / deselect all visible files"
              >
                {filteredFiles.every((f) => selectedIds.has(f.fileId)) ? (
                  <CheckSquare className="w-4 h-4 mr-1.5" />
                ) : (
                  <Square className="w-4 h-4 mr-1.5" />
                )}
                Select all
              </Button>
            )}
            <div className="flex border rounded-lg overflow-hidden">
              <Button
                variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                size="sm"
                className="rounded-none"
                onClick={() => setViewMode('grid')}
              >
                <Grid className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                size="sm"
                className="rounded-none"
                onClick={() => setViewMode('list')}
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
          </div>
          {selectedIds.size > 0 && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
              <span className="font-medium text-foreground">
                {selectedIds.size} file{selectedIds.size === 1 ? '' : 's'} selected
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => handleBulkDownload()}
                  disabled={downloadingAll}
                >
                  {downloadingAll ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 mr-1.5" />
                  )}
                  Download selected
                </Button>
                <Button size="sm" variant="ghost" onClick={clearSelection}>
                  <X className="w-4 h-4 mr-1" />
                  Clear
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            All Files
            {files.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({filteredFiles.length} files)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-16 text-muted-foreground">
              <Loader2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground/60 animate-spin" />
              <p>Loading files...</p>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Folder className="w-16 h-16 mx-auto mb-4 text-muted-foreground/60" />
              <p className="text-lg font-medium">No files yet</p>
              <p className="text-sm">Upload files to get started</p>
              <Button
                className="mt-4 bg-gradient-to-r from-orange-500 to-red-500"
                onClick={() => setShowUploadZone(true)}
              >
                <Upload className="w-4 h-4 mr-2" />
                Upload your first file
              </Button>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
              {filteredFiles.map((file) => {
                const checked = selectedIds.has(file.fileId);
                return (
                  <div
                    key={file.fileId}
                    className={cn(
                      'p-4 border rounded-lg hover:bg-secondary/60 cursor-pointer text-center group relative',
                      checked && 'ring-2 ring-primary border-primary bg-primary/5',
                    )}
                    onClick={() => toggleSelected(file.fileId)}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelected(file.fileId);
                      }}
                      className={cn(
                        'absolute top-2 left-2 transition-opacity',
                        checked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                      )}
                      aria-label={checked ? 'Deselect file' : 'Select file'}
                    >
                      {checked ? (
                        <CheckSquare className="w-4 h-4 text-primary" />
                      ) : (
                        <Square className="w-4 h-4 text-muted-foreground" />
                      )}
                    </button>
                    {getFileTypeCategory(file.fileType) === 'image' &&
                      file.fileUrl.startsWith('http') ? (
                      <img
                        src={file.fileUrl}
                        alt={file.fileName}
                        className="w-16 h-16 mx-auto object-cover rounded"
                      />
                    ) : (
                      getFileIcon(file.fileType)
                    )}
                    <p
                      className="mt-2 text-sm font-medium truncate"
                      title={file.fileName}
                    >
                      {file.fileName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(file.fileSize)}
                    </p>

                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(file);
                        }}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFile(file.fileId);
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredFiles.map((file) => {
                const checked = selectedIds.has(file.fileId);
                return (
                  <div
                    key={file.fileId}
                    className={cn(
                      'flex items-center gap-4 p-3 border rounded-lg hover:bg-secondary/60 group',
                      checked && 'ring-2 ring-primary border-primary bg-primary/5',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSelected(file.fileId)}
                      aria-label={checked ? 'Deselect file' : 'Select file'}
                      className="shrink-0"
                    >
                      {checked ? (
                        <CheckSquare className="w-4 h-4 text-primary" />
                      ) : (
                        <Square className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                      )}
                    </button>
                    {getFileIcon(file.fileType)}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{file.fileName}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatFileSize(file.fileSize)} •{' '}
                        {new Date(file.uploadedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDownload(file)}
                      >
                        <Download className="w-4 h-4 mr-1" />
                        Download
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-700"
                        onClick={() => handleDeleteFile(file.fileId)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
};

export default Files;
