import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ExternalLink, FileText, Loader2, Search, SearchX, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusPill } from '@/components/common/StatusPill';
import { cn } from '@/lib/utils';
import { todayYmd } from '@/lib/leave';
import type { UseEmployeeDocuments } from '@/hooks/useEmployeeDocuments';
import {
  DOCUMENT_CATEGORY_LABEL,
  type DocumentCategory,
  type EmployeeDocument,
} from '@/services/supabase/hrDocuments';
import { formatFileSize } from '@/services/supabase/storage';
import { documentExpiry, filterDocuments, type DocumentFilters } from './documents/documentHelpers';
import { UploadDocumentDialog } from './documents/UploadDocumentDialog';
import { HrSetupNotice } from './HrSetupNotice';
import { formatYmd } from './overview/dates';
import { errorText } from './overview/errorText';
import { PersonAvatar, personName } from './overview/SectionBox';
import type { HrPerson } from './types';

export interface HrDocumentsTabProps {
  people: HrPerson[];
  docs: UseEmployeeDocuments;
}

const CATEGORIES = Object.keys(DOCUMENT_CATEGORY_LABEL) as DocumentCategory[];
const NO_FILTERS: DocumentFilters = { userId: 'all', category: 'all', search: '' };

/** 28px square icon button in a table row (touch-sized on phones). */
const ROW_ICON_BUTTON = 'w-10 px-0 text-muted-foreground md:w-7';

/** Every employee's documents: filter, open, upload and delete. */
export const HrDocumentsTab: React.FC<HrDocumentsTabProps> = ({ people, docs }) => {
  const [filters, setFilters] = useState<DocumentFilters>(NO_FILTERS);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<EmployeeDocument | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const today = todayYmd();
  const sortedPeople = useMemo(
    () => [...people].sort((a, b) => personName(a).localeCompare(personName(b))),
    [people],
  );
  const peopleById = useMemo(() => new Map(people.map((p) => [p.userId, p])), [people]);
  const visible = useMemo(() => filterDocuments(docs.documents, filters), [docs.documents, filters]);

  const header = (withUpload: boolean) => (
    <PageHeader
      title="Documents"
      description="Contracts, ID, letters and certificates for each employee."
      actions={
        withUpload ? (
          <Button type="button" onClick={() => setUploadOpen(true)}>
            <Upload aria-hidden />
            Upload document
          </Button>
        ) : undefined
      }
    />
  );

  if (docs.setupMissing) {
    return (
      <>
        {header(false)}
        <HrSetupNotice feature="Documents" onRetry={() => void docs.refresh()} />
      </>
    );
  }

  if (docs.error) {
    return (
      <>
        {header(false)}
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-destructive/30 bg-destructive-soft px-4 py-2.5"
        >
          <p className="min-w-0 text-sm text-destructive-soft-foreground">{docs.error}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void docs.refresh()}>
            Retry
          </Button>
        </div>
      </>
    );
  }

  const openDocument = async (doc: EmployeeDocument) => {
    setOpeningId(doc.id);
    try {
      await docs.open(doc);
    } catch (e) {
      toast.error(errorText(e, 'Could not open the document.'));
    } finally {
      setOpeningId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await docs.remove(deleting);
      toast.success(`Deleted ${deleting.title}`);
      setDeleting(null);
    } catch (e) {
      toast.error(errorText(e, 'Could not delete the document.'));
    } finally {
      setDeleteBusy(false);
    }
  };

  const deletingOwner = deleting ? peopleById.get(deleting.userId) : undefined;
  const total = docs.documents.length;
  const filtered = visible.length !== total;

  return (
    <>
      {header(true)}

      {docs.loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading documents" />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-full sm:w-48">
              <Select value={filters.userId} onValueChange={(userId) => setFilters((f) => ({ ...f, userId }))}>
                <SelectTrigger aria-label="Employee">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everyone</SelectItem>
                  {sortedPeople.map((p) => (
                    <SelectItem key={p.userId} value={p.userId}>
                      {personName(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-44">
              <Select
                value={filters.category}
                onValueChange={(category) =>
                  setFilters((f) => ({ ...f, category: category as DocumentFilters['category'] }))
                }
              >
                <SelectTrigger aria-label="Category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {DOCUMENT_CATEGORY_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="relative w-full sm:w-64">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                aria-label="Search documents"
                placeholder="Search documents"
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                className="pl-8"
              />
            </div>
            {total > 0 && (
              <p className="ml-auto text-xs tabular-nums text-muted-foreground" aria-live="polite">
                {filtered ? `${visible.length} of ${total}` : total} {total === 1 ? 'document' : 'documents'}
              </p>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            {total === 0 ? (
              <div className="flex flex-col items-center px-4 py-12 text-center">
                <FileText className="mb-2 h-5 w-5 text-muted-foreground" aria-hidden />
                <p className="text-sm font-medium text-foreground">No documents yet.</p>
                <p className="mt-0.5 max-w-sm text-pretty text-xs text-muted-foreground">
                  Upload contracts, ID, letters and certificates to keep them with each employee.
                </p>
                <Button type="button" className="mt-4" onClick={() => setUploadOpen(true)}>
                  <Upload aria-hidden />
                  Upload document
                </Button>
              </div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center px-4 py-12 text-center">
                <SearchX className="mb-2 h-5 w-5 text-muted-foreground" aria-hidden />
                <p className="text-sm font-medium text-foreground">Nothing matches these filters.</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Try another employee, category or search.</p>
                <Button type="button" variant="outline" className="mt-4" onClick={() => setFilters(NO_FILTERS)}>
                  Clear filters
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-left text-sm">
                  <thead>
                    <tr className="h-10 border-b border-border bg-surface-2 text-xs text-muted-foreground">
                      <th scope="col" className="px-4 font-medium">Document</th>
                      <th scope="col" className="px-4 font-medium">Employee</th>
                      <th scope="col" className="px-4 font-medium">Category</th>
                      <th scope="col" className="px-4 font-medium">Expires</th>
                      <th scope="col" className="px-4 font-medium">Uploaded</th>
                      <th scope="col" className="px-4 text-right font-medium">Size</th>
                      <th scope="col" className="px-4 text-right font-medium">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((doc) => {
                      const person = peopleById.get(doc.userId);
                      const expiry = documentExpiry(doc.expiresOn, today);
                      return (
                        <tr
                          key={doc.id}
                          className="h-12 border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2"
                        >
                          <td className="px-4 py-2">
                            <p className="max-w-[18rem] truncate font-medium text-foreground" title={doc.title}>
                              {doc.title}
                            </p>
                            <p className="max-w-[18rem] truncate text-xs text-muted-foreground" title={doc.fileName}>
                              {doc.fileName}
                            </p>
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <PersonAvatar person={person} />
                              <span
                                className={cn(
                                  'max-w-[12rem] truncate',
                                  person ? 'text-foreground' : 'text-muted-foreground',
                                )}
                              >
                                {personName(person)}
                              </span>
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-2">{DOCUMENT_CATEGORY_LABEL[doc.category]}</td>
                          <td className="whitespace-nowrap px-4 py-2">
                            {doc.expiresOn ? (
                              <div className="flex items-center gap-2">
                                <span className="tabular-nums">{formatYmd(doc.expiresOn, { year: true })}</span>
                                {expiry && <StatusPill tone={expiry.tone}>{expiry.label}</StatusPill>}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 tabular-nums text-muted-foreground">
                            {format(doc.createdAt, 'd MMM yyyy')}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-muted-foreground">
                            {formatFileSize(doc.fileSize)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2 text-right">
                            <div className="inline-flex items-center gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className={ROW_ICON_BUTTON}
                                onClick={() => void openDocument(doc)}
                                disabled={openingId === doc.id}
                                title="Open in a new tab"
                                aria-label={`Open ${doc.title}`}
                              >
                                {openingId === doc.id ? (
                                  <Loader2 className="animate-spin" aria-hidden />
                                ) : (
                                  <ExternalLink aria-hidden />
                                )}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className={cn(
                                  ROW_ICON_BUTTON,
                                  'text-destructive hover:bg-destructive-soft hover:text-destructive',
                                )}
                                onClick={() => setDeleting(doc)}
                                title="Delete"
                                aria-label={`Delete ${doc.title}`}
                              >
                                <Trash2 aria-hidden />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <UploadDocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        people={sortedPeople}
        defaultUserId={filters.userId !== 'all' ? filters.userId : ''}
        onUpload={docs.upload}
      />

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && !deleteBusy && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              The file is removed from {deletingOwner ? `${personName(deletingOwner)}'s` : 'the'} documents for
              good. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteBusy}
              onClick={(e) => {
                // Keep the dialog open until the delete has gone through.
                e.preventDefault();
                void confirmDelete();
              }}
            >
              {deleteBusy && <Loader2 className="animate-spin" aria-hidden />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default HrDocumentsTab;
