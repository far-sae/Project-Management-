// src/pages/Files.tsx
import React, { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
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
} from 'lucide-react';

import { Sidebar } from '@/components/sidebar/Sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useProjects } from '@/hooks/useProjects';
import { FileUploadZone, FileUploadItem } from '@/components/files/FileUploadZone';
import {
  uploadFileWithProgress as uploadFile,
  getProjectFiles,
  deleteFileComplete as deleteFile,
  formatFileSize,
  getFileTypeCategory,
} from '@/services/supabase/storage';
import { ProjectFile, FileUploadProgress } from '@/types/file';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export const Files: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { projects } = useProjects();

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState('');
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, FileUploadProgress>>({});
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [showUploadZone, setShowUploadZone] = useState(false);


  // Load files when project is selected
  useEffect(() => {
    const loadFiles = async () => {
      if (!selectedProject || !organization?.organizationId) {
        setFiles([]);
        return;
      }

      setLoading(true);
      const toastId = toast.loading('Loading files...');

      try {
        const projectFiles = await getProjectFiles(
          selectedProject,
          organization.organizationId,
          'project'
        );
        setFiles(projectFiles);
        toast.dismiss(toastId);
      } catch (error) {
        toast.error('Failed to load files', { id: toastId });
        setFiles([]);
      } finally {
        setLoading(false);
      }
    };

    loadFiles();
  }, [selectedProject, organization?.organizationId]);

  // Auto-select first project
  useEffect(() => {
    if (projects.length > 0 && !selectedProject) {
      setSelectedProject(projects[0].projectId);
    }
  }, [projects, selectedProject]);

  const handleFilesSelected = useCallback(
    async (selectedFiles: File[]) => {
      if (!user || !selectedProject) return;

      const orgIdResolved = organization?.organizationId || user.organizationId;
      if (!orgIdResolved) {
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
          const uploadedFile = await uploadFile(
            user.userId,
            user.displayName,
            orgIdResolved,
            {
              projectId: selectedProject,
              file,
              scope: 'project',
            },
            (progress) => {
              setUploadProgress((prev) => ({
                ...prev,
                [tempId]: progress,
              }));
            }
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
    [user, organization, selectedProject]
  );

  const handleDeleteFile = async (fileId: string) => {
    if (!window.confirm('Are you sure you want to delete this file?')) return;

    const orgIdResolved = organization?.organizationId || user?.organizationId || '';
    if (!orgIdResolved) {
      toast.error('Organization is not available for file deletion');
      return;
    }

    const toastId = toast.loading('Deleting file...');
    try {
      await deleteFile(fileId, orgIdResolved);
      setFiles((prev) => prev.filter((f) => f.fileId !== fileId));
      toast.success('File deleted', { id: toastId });
    } catch (error) {
      toast.error('Failed to delete file', { id: toastId });
    }
  };

  const handleDownload = (file: ProjectFile) => {
    window.open(file.fileUrl, '_blank');
  };

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
        return <FileIcon className="w-8 h-8 text-gray-500" />;
    }
  };

  const filteredFiles = files.filter((file) =>
    file.fileName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const uploadProgressItems = Object.values(uploadProgress);

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Files</h1>
            <p className="text-gray-500">Manage your project files and documents</p>
          </div>
          <div className="flex items-center gap-4">
            <Select
              value={selectedProject}
              onValueChange={setSelectedProject}
              disabled={projects.length === 0}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder={projects.length ? 'Select project' : 'No projects'} />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.projectId} value={project.projectId}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="bg-gradient-to-r from-orange-500 to-red-500"
              onClick={() => setShowUploadZone(!showUploadZone)}
              disabled={!selectedProject}
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload File
            </Button>
          </div>
        </div>

        {/* Upload Zone */}
        {showUploadZone && selectedProject && (
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
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search files..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              All Files
              {files.length > 0 && (
                <span className="ml-2 text-sm font-normal text-gray-500">
                  ({filteredFiles.length} files)
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-16 text-gray-500">
                <Loader2 className="w-12 h-12 mx-auto mb-4 text-gray-300 animate-spin" />
                <p>Loading files...</p>
              </div>
            ) : !selectedProject ? (
              <div className="text-center py-16 text-gray-500">
                <Folder className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <p className="text-lg font-medium">Select a project</p>
                <p className="text-sm">Choose a project to view its files</p>
              </div>
            ) : filteredFiles.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                <Folder className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                <p className="text-lg font-medium">No files yet</p>
                <p className="text-sm">Upload files to get started</p>
                <Button
                  className="mt-4 bg-gradient-to-r from-orange-500 to-red-500"
                  onClick={() => setShowUploadZone(true)}
                  disabled={!selectedProject}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload your first file
                </Button>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {filteredFiles.map((file) => (
                  <div
                    key={file.fileId}
                    className="p-4 border rounded-lg hover:bg-gray-50 cursor-pointer text-center group relative"
                  >
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
                    <p className="text-xs text-gray-500">
                      {formatFileSize(file.fileSize)}
                    </p>

                    {/* Hover actions */}
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
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredFiles.map((file) => (
                  <div
                    key={file.fileId}
                    className="flex items-center gap-4 p-3 border rounded-lg hover:bg-gray-50 group"
                  >
                    {getFileIcon(file.fileType)}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{file.fileName}</p>
                      <p className="text-sm text-gray-500">
                        {formatFileSize(file.fileSize)} • Uploaded by{' '}
                        {file.uploadedByName} •{' '}
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
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Files;
