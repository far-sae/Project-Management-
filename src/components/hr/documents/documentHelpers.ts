import {
  HR_DOCUMENT_MAX_BYTES,
  type DocumentCategory,
  type EmployeeDocument,
  type UploadDocumentInput,
} from '@/services/supabase/hrDocuments';
import { daysBetweenYmd } from '../overview/dates';

/** Documents are flagged this many days before they expire. */
export const EXPIRY_WARNING_DAYS = 30;

export interface DocumentExpiry {
  tone: 'danger' | 'warning';
  label: string;
  /** Days until the expiry date; negative once it has passed. */
  daysLeft: number;
}

/**
 * The pill to show next to an expiry date: red once the date has passed,
 * amber in the last 30 days, nothing otherwise. A document is still valid on
 * the day it expires.
 */
export function documentExpiry(
  expiresOn: string | null,
  today: string,
  windowDays = EXPIRY_WARNING_DAYS,
): DocumentExpiry | null {
  if (!expiresOn) return null;
  const daysLeft = daysBetweenYmd(today, expiresOn);
  if (daysLeft > windowDays) return null;
  if (daysLeft < 0) return { tone: 'danger', label: 'Expired', daysLeft };
  if (daysLeft === 0) return { tone: 'warning', label: 'Expires today', daysLeft };
  return { tone: 'warning', label: `In ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`, daysLeft };
}

export interface DocumentFilters {
  /** An employee's user id, or `all`. */
  userId: string;
  /** A document category, or `all`. */
  category: DocumentCategory | 'all';
  /** Matches the title or the file name. */
  search: string;
}

export function filterDocuments(documents: EmployeeDocument[], filters: DocumentFilters): EmployeeDocument[] {
  const needle = filters.search.trim().toLowerCase();
  return documents.filter((d) => {
    if (filters.userId !== 'all' && d.userId !== filters.userId) return false;
    if (filters.category !== 'all' && d.category !== filters.category) return false;
    if (needle && !d.title.toLowerCase().includes(needle) && !d.fileName.toLowerCase().includes(needle)) {
      return false;
    }
    return true;
  });
}

/** A file name without its extension: `Contract.pdf` → `Contract`. */
export function fileBaseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/** What the upload form holds before it is saved. */
export interface UploadForm {
  userId: string;
  title: string;
  category: DocumentCategory;
  /** `yyyy-MM-dd`, or empty for no expiry. */
  expiresOn: string;
  file: File | null;
}

export type UploadErrors = Partial<Record<'userId' | 'file', string>>;

/** The message for a file that cannot be uploaded, if any. */
export function fileProblem(file: File | null): string | null {
  if (!file) return 'Choose a file.';
  if (file.size > HR_DOCUMENT_MAX_BYTES) {
    return `That file is larger than ${Math.round(HR_DOCUMENT_MAX_BYTES / (1024 * 1024))} MB.`;
  }
  return null;
}

/** What still has to be fixed before the form can be saved. Empty when ready. */
export function validateUpload(form: UploadForm): UploadErrors {
  const errors: UploadErrors = {};
  if (!form.userId) errors.userId = 'Choose an employee.';
  const problem = fileProblem(form.file);
  if (problem) errors.file = problem;
  return errors;
}

/** The form as the upload call wants it. Only call once `validateUpload` is empty. */
export function buildUploadInput(form: UploadForm & { file: File }): UploadDocumentInput {
  return {
    userId: form.userId,
    title: form.title.trim() || fileBaseName(form.file.name),
    category: form.category,
    expiresOn: form.expiresOn || null,
    file: form.file,
  };
}
