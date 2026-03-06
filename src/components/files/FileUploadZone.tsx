import React, { useRef, useState } from 'react';
import { Upload, Loader2, X, AlertCircle, FileWarning } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface FileUploadZoneProps {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
  multiple?: boolean;
  accept?: string;
  maxSizeMB?: number;
  className?: string;
}

export const FileUploadZone: React.FC<FileUploadZoneProps> = ({
  onFilesSelected,
  disabled = false,
  multiple = true,
  accept,
  maxSizeMB = 50,
  className,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateFiles = (files: FileList | File[]): File[] => {
    const validFiles: File[] = [];
    const maxSize = maxSizeMB * 1024 * 1024;
    const oversizedFiles: string[] = [];

    Array.from(files).forEach((file) => {
      if (file.size > maxSize) {
        oversizedFiles.push(file.name);
        return;
      }
      validFiles.push(file);
    });

    if (oversizedFiles.length > 0) {
      const errorMsg = oversizedFiles.length === 1
        ? `${oversizedFiles[0]} exceeds ${maxSizeMB}MB limit`
        : `${oversizedFiles.length} files exceed ${maxSizeMB}MB limit`;
      setError(errorMsg);
      toast.error('File size limit exceeded', {
        description: errorMsg,
        icon: <FileWarning className="w-4 h-4" />,
      });
    }

    return validFiles;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setError(null);

    if (disabled) return;

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const validFiles = validateFiles(files);
      if (validFiles.length > 0) {
        onFilesSelected(multiple ? validFiles : [validFiles[0]]);
        toast.success(`File${validFiles.length > 1 ? 's' : ''} ready for upload`, {
          description: `${validFiles.length} file${validFiles.length > 1 ? 's' : ''} selected`,
        });
      }
    }
  };

  const handleClick = () => {
    if (!disabled && inputRef.current) {
      inputRef.current.click();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const files = e.target.files;
    if (files && files.length > 0) {
      const validFiles = validateFiles(files);
      if (validFiles.length > 0) {
        onFilesSelected(multiple ? validFiles : [validFiles[0]]);
        toast.success(`File${validFiles.length > 1 ? 's' : ''} selected`, {
          description: `${validFiles.length} file${validFiles.length > 1 ? 's' : ''} ready for upload`,
        });
      }
    }
    // Reset input so same file can be selected again
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  return (
    <div className={className}>
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        className={cn(
          'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
          isDragging
            ? 'border-orange-500 bg-orange-50'
            : 'border-gray-300 hover:border-orange-400 hover:bg-orange-50/50',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <Upload className="w-12 h-12 mx-auto mb-4 text-gray-400" />
        <p className="text-gray-700 font-medium">
          {isDragging ? 'Drop files here' : 'Drag and drop files here'}
        </p>
        <p className="text-sm text-gray-500 mt-1">or click to browse</p>
        <p className="text-xs text-gray-400 mt-2">Max file size: {maxSizeMB}MB</p>

        <input
          ref={inputRef}
          type="file"
          multiple={multiple}
          accept={accept}
          className="hidden"
          onChange={handleChange}
          disabled={disabled}
        />
      </div>

      {error && (
        <Alert variant="destructive" className="mt-3">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
};

// File upload progress item component
interface FileUploadItemProps {
  fileName: string;
  progress: number;
  status: 'uploading' | 'completed' | 'error';
  error?: string;
  onRemove?: () => void;
}

export const FileUploadItem: React.FC<FileUploadItemProps> = ({
  fileName,
  progress,
  status,
  error,
  onRemove,
}) => {
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);

  const handleRemove = () => {
    setShowRemoveDialog(true);
  };

  const confirmRemove = () => {
    onRemove?.();
    setShowRemoveDialog(false);
    toast.info('File removed', { description: fileName });
  };

  return (
    <>
      <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-700 truncate">{fileName}</p>
          {status === 'uploading' && (
            <div className="mt-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-orange-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
          {status === 'error' && error && (
            <Alert variant="destructive" className="mt-1 py-2">
              <AlertCircle className="h-3 w-3" />
              <AlertDescription className="text-xs">{error}</AlertDescription>
            </Alert>
          )}
          {status === 'completed' && (
            <p className="text-xs text-green-600 mt-1">Upload complete</p>
          )}
        </div>
        {status === 'uploading' && (
          <Loader2 className="w-5 h-5 text-orange-500 animate-spin" />
        )}
        {status === 'completed' && onRemove && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            className="text-gray-400 hover:text-red-500"
            aria-label="Remove file"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      <AlertDialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove File</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{fileName}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemove} className="bg-red-500 hover:bg-red-600">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default FileUploadZone;
