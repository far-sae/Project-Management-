import Papa from 'papaparse';
import type { Task } from '@/types';

/** Header columns used by both export and the import template. */
export const TASK_CSV_HEADERS = [
  'Title',
  'Description',
  'Status',
  'Priority',
  'Due Date',
  'Assignees',
  'Tags',
  'Subtasks',
  'Urgent',
  'Locked',
  'Created At',
  'Updated At',
] as const;

const formatDate = (d: Date | string | null | undefined): string => {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

/** Neutralize CSV/formula injection when a cell starts with =, +, -, @, or tab. */
export const escapeCsvFormula = (raw: string): string => {
  if (!raw) return raw;
  const s = String(raw);
  if (/^[=+\-@\t]/.test(s)) {
    return `'${s.replace(/'/g, "''")}`;
  }
  return s;
};

/** Convert tasks to a CSV string. */
export const tasksToCsv = (tasks: Task[]): string => {
  const rows = tasks.map((t) => ({
    Title: escapeCsvFormula(t.title ?? ''),
    Description: escapeCsvFormula(t.description ?? ''),
    Status: t.status ?? '',
    Priority: t.priority ?? '',
    'Due Date': formatDate(t.dueDate ?? null),
    Assignees: escapeCsvFormula(
      (t.assignees || [])
        .map((a) => a.displayName || a.email || a.userId)
        .filter(Boolean)
        .join('; '),
    ),
    Tags: escapeCsvFormula((t.tags || []).join('; ')),
    Subtasks: escapeCsvFormula(
      (t.subtasks || [])
        .map((s) => `${s.completed ? '[x]' : '[ ]'} ${s.title}`)
        .join(' | '),
    ),
    Urgent: t.urgent ? 'true' : 'false',
    Locked: t.isLocked ? 'true' : 'false',
    'Created At': formatDate(t.createdAt),
    'Updated At': formatDate(t.updatedAt),
  }));
  return Papa.unparse(rows, { columns: TASK_CSV_HEADERS as unknown as string[] });
};

/** Trigger a browser download for a CSV string. */
export const downloadCsv = (filename: string, content: string): void => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 250);
};

export interface ParsedCsvRow {
  Title?: string;
  Description?: string;
  Status?: string;
  Priority?: string;
  'Due Date'?: string;
  Assignees?: string;
  Tags?: string;
  Subtasks?: string;
  Urgent?: string;
  Locked?: string;
  [key: string]: string | undefined;
}

export interface ParseCsvResult {
  rows: ParsedCsvRow[];
  headers: string[];
  errors: string[];
}

/** Parse a CSV file with PapaParse. Returns rows + detected headers. */
export const parseCsvFile = (file: File): Promise<ParseCsvResult> => {
  return new Promise((resolve) => {
    Papa.parse<ParsedCsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (results) => {
        resolve({
          rows: results.data || [],
          headers: results.meta?.fields ?? [],
          errors: (results.errors || []).map((e) => e.message),
        });
      },
      error: (err) => {
        resolve({ rows: [], headers: [], errors: [err.message] });
      },
    });
  });
};

export interface ImportColumnMapping {
  /** Source header in the CSV → destination Task field. */
  [csvHeader: string]: keyof Task | 'subtasks_text' | 'assignees_text' | 'tags_text' | 'ignore';
}

export interface ImportableTask {
  title: string;
  description?: string;
  status?: string;
  priority?: 'low' | 'medium' | 'high';
  dueDate?: Date | null;
  assigneesRaw?: string;
  tagsRaw?: string;
  subtasksRaw?: string;
  urgent?: boolean;
  isLocked?: boolean;
}

const normalizePriority = (val?: string): 'low' | 'medium' | 'high' | undefined => {
  if (!val) return undefined;
  const v = val.trim().toLowerCase();
  if (v === 'high' || v === 'medium' || v === 'low') return v;
  return undefined;
};

const parseBool = (val?: string): boolean | undefined => {
  if (!val) return undefined;
  const v = val.trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(v)) return true;
  if (['false', '0', 'no', 'n'].includes(v)) return false;
  return undefined;
};

const parseDate = (val?: string): Date | null => {
  if (!val) return null;
  const t = new Date(val);
  if (Number.isNaN(t.getTime())) return null;
  return t;
};

/** Convert parsed CSV rows + mapping into importable task seeds. */
export const csvToImportableTasks = (
  rows: ParsedCsvRow[],
  mapping: ImportColumnMapping,
): ImportableTask[] => {
  const out: ImportableTask[] = [];
  for (const row of rows) {
    const task: ImportableTask = { title: '' };
    for (const [header, target] of Object.entries(mapping)) {
      const raw = row[header];
      if (raw === undefined || raw === '' || target === 'ignore') continue;
      switch (target) {
        case 'title':
          task.title = String(raw);
          break;
        case 'description':
          task.description = String(raw);
          break;
        case 'status':
          task.status = String(raw).toLowerCase();
          break;
        case 'priority':
          task.priority = normalizePriority(String(raw));
          break;
        case 'dueDate':
          task.dueDate = parseDate(String(raw));
          break;
        case 'urgent':
          task.urgent = parseBool(String(raw));
          break;
        case 'isLocked':
          task.isLocked = parseBool(String(raw));
          break;
        case 'assignees_text':
          task.assigneesRaw = String(raw);
          break;
        case 'tags_text':
          task.tagsRaw = String(raw);
          break;
        case 'subtasks_text':
          task.subtasksRaw = String(raw);
          break;
        default:
          break;
      }
    }
    if (task.title.trim()) out.push(task);
  }
  return out;
};
