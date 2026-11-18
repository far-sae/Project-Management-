import React, { useEffect, useId, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DOCUMENT_CATEGORY_LABEL,
  HR_DOCUMENT_MAX_BYTES,
  type DocumentCategory,
  type UploadDocumentInput,
} from '@/services/supabase/hrDocuments';
import { formatFileSize } from '@/services/supabase/storage';
import { errorText } from '../overview/errorText';
import type { HrPerson } from '../types';
import {
  buildUploadInput,
  fileBaseName,
  fileProblem,
  validateUpload,
  type UploadForm,
} from './documentHelpers';

const CATEGORIES = Object.keys(DOCUMENT_CATEGORY_LABEL) as DocumentCategory[];
const MAX_SIZE = formatFileSize(HR_DOCUMENT_MAX_BYTES);

const blankForm = (userId: string): UploadForm => ({
  userId,
  title: '',
  category: 'other',
  expiresOn: '',
  file: null,
});

interface UploadDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** People a document can be filed under, in the order to list them. */
  people: HrPerson[];
  /** Employee to start on, e.g. the one the table is filtered to. */
  defaultUserId?: string;
  onUpload: (input: UploadDocumentInput) => Promise<unknown>;
}

/** Upload one file to an employee's documents. */
export const UploadDocumentDialog: React.FC<UploadDocumentDialogProps> = ({
  open,
  onOpenChange,
  people,
  defaultUserId = '',
  onUpload,
}) => {
  const id = useId();
  const [form, setForm] = useState<UploadForm>(() => blankForm(defaultUserId));
  const [tried, setTried] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Start from a clean form every time the dialog opens.
  useEffect(() => {
    if (open) {
      setForm(blankForm(defaultUserId));
      setTried(false);
    }
  }, [open, defaultUserId]);

  const errors = useMemo(() => validateUpload(form), [form]);
  const employeeError = tried ? errors.userId : undefined;
  // A file that is too big is called out as soon as it is picked.
  const fileError = form.file ? fileProblem(form.file) : tried ? errors.file : undefined;

  const set = <K extends keyof UploadForm>(key: K, value: UploadForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (uploading) return;
    setTried(true);
    if (!form.file || Object.keys(errors).length > 0) return;
    setUploading(true);
    try {
      await onUpload(buildUploadInput({ ...form, file: form.file }));
      toast.success('Document uploaded');
      onOpenChange(false);
    } catch (err) {
      toast.error(errorText(err, 'Could not upload the document.'));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (uploading ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
          <DialogDescription>Add a file to an employee&apos;s record. Up to {MAX_SIZE} per file.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-employee`}>Employee</Label>
            <Select value={form.userId} onValueChange={(v) => set('userId', v)}>
              <SelectTrigger
                id={`${id}-employee`}
                aria-invalid={employeeError ? true : undefined}
                aria-describedby={employeeError ? `${id}-employee-error` : undefined}
              >
                <SelectValue placeholder="Choose an employee" />
              </SelectTrigger>
              <SelectContent>
                {people.map((p) => (
                  <SelectItem key={p.userId} value={p.userId}>
                    {p.displayName || p.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {employeeError && (
              <p id={`${id}-employee-error`} role="alert" className="text-xs text-destructive">
                {employeeError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-title`}>Title</Label>
            <Input
              id={`${id}-title`}
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder={form.file ? fileBaseName(form.file.name) : 'Uses the file name if left empty'}
              maxLength={200}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-category`}>Category</Label>
              <Select value={form.category} onValueChange={(v) => set('category', v as DocumentCategory)}>
                <SelectTrigger id={`${id}-category`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {DOCUMENT_CATEGORY_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-expires`}>
                Expiry date <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id={`${id}-expires`}
                type="date"
                value={form.expiresOn}
                onChange={(e) => set('expiresOn', e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${id}-file`}>File</Label>
            <Input
              id={`${id}-file`}
              type="file"
              onChange={(e) => set('file', e.target.files?.[0] ?? null)}
              aria-invalid={fileError ? true : undefined}
              aria-describedby={fileError ? `${id}-file-error` : undefined}
            />
            {fileError && (
              <p id={`${id}-file-error`} role="alert" className="text-xs text-destructive">
                {fileError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>
              Cancel
            </Button>
            <Button type="submit" disabled={uploading}>
              {uploading ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden />
                  Uploading…
                </>
              ) : (
                'Save'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default UploadDocumentDialog;
