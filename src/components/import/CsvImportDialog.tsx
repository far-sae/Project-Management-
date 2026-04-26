import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Upload, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import {
  parseCsvFile,
  csvToImportableTasks,
  type ImportColumnMapping,
  type ParsedCsvRow,
} from '@/services/csv/tasksCsv';
import type { CreateTaskInput, KanbanColumn } from '@/types';

interface CsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName?: string;
  columns: KanbanColumn[];
  /** Add tasks one by one (uses the same `addTask` plumbing as the modal). */
  addTask: (input: CreateTaskInput) => Promise<unknown>;
}

const TARGET_OPTIONS: {
  value: string;
  label: string;
  hint?: string;
}[] = [
  { value: 'ignore', label: 'Ignore column' },
  { value: 'title', label: 'Title' },
  { value: 'description', label: 'Description' },
  { value: 'status', label: 'Status' },
  { value: 'priority', label: 'Priority (low / medium / high)' },
  { value: 'dueDate', label: 'Due date' },
  { value: 'urgent', label: 'Urgent (true/false)' },
  { value: 'isLocked', label: 'Locked (true/false)' },
  { value: 'tags_text', label: 'Tags (separator: ; or ,)' },
  { value: 'assignees_text', label: 'Assignees (names; semicolon)' },
  { value: 'subtasks_text', label: 'Subtasks ("[ ] Item | [x] Done")' },
];

const guessTarget = (header: string): string => {
  const h = header.trim().toLowerCase();
  if (['title', 'name', 'task'].includes(h)) return 'title';
  if (['description', 'notes'].includes(h)) return 'description';
  if (['status', 'state', 'column'].includes(h)) return 'status';
  if (['priority', 'severity'].includes(h)) return 'priority';
  if (['due', 'due date', 'duedate', 'deadline'].includes(h)) return 'dueDate';
  if (h === 'urgent') return 'urgent';
  if (h === 'locked') return 'isLocked';
  if (['tags', 'labels'].includes(h)) return 'tags_text';
  if (['assignees', 'assignee', 'owner'].includes(h)) return 'assignees_text';
  if (['subtasks', 'sub-tasks', 'checklist'].includes(h)) return 'subtasks_text';
  return 'ignore';
};

export const CsvImportDialog: React.FC<CsvImportDialogProps> = ({
  open,
  onOpenChange,
  projectId,
  projectName,
  columns,
  addTask,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'upload' | 'map' | 'importing'>('upload');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedCsvRow[]>([]);
  const [mapping, setMapping] = useState<ImportColumnMapping>({});
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [importStats, setImportStats] = useState<{ ok: number; failed: number } | null>(null);

  const reset = useCallback(() => {
    setStep('upload');
    setHeaders([]);
    setRows([]);
    setMapping({});
    setParseErrors([]);
    setImportStats(null);
  }, []);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast.error('Please choose a .csv file');
      return;
    }
    const result = await parseCsvFile(file);
    setHeaders(result.headers);
    setRows(result.rows);
    setParseErrors(result.errors);
    const guessed: ImportColumnMapping = {};
    for (const h of result.headers) {
      guessed[h] = guessTarget(h) as ImportColumnMapping[string];
    }
    setMapping(guessed);
    setStep('map');
  }, []);

  const previewTasks = useMemo(
    () => csvToImportableTasks(rows.slice(0, 5), mapping),
    [rows, mapping],
  );

  const validStatusIds = useMemo(
    () => new Set(columns.map((c) => c.id)),
    [columns],
  );

  const runImport = useCallback(async () => {
    const items = csvToImportableTasks(rows, mapping);
    if (items.length === 0) {
      toast.error('Nothing to import. Make sure Title is mapped.');
      return;
    }
    setStep('importing');
    let ok = 0;
    let failed = 0;
    for (const it of items) {
      const status = it.status && validStatusIds.has(it.status) ? it.status : columns[0]?.id;
      const tags = it.tagsRaw
        ? it.tagsRaw
            .split(/[,;]/)
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined;
      const subtasks = it.subtasksRaw
        ? it.subtasksRaw
            .split('|')
            .map((part) => part.trim())
            .filter(Boolean)
            .map((entry) => {
              const completed = /^\[(?:x|X)\]\s*/i.test(entry);
              const title = entry.replace(/^\[(?:\s|x|X)\]\s*/, '').trim();
              return {
                id: crypto.randomUUID(),
                title: title || entry,
                completed,
              };
            })
        : undefined;
      const payload: CreateTaskInput = {
        projectId,
        projectName,
        title: it.title,
        description: it.description,
        status: status as CreateTaskInput['status'],
        priority: it.priority,
        dueDate: it.dueDate ?? undefined,
        tags,
        subtasks,
        urgent: it.urgent,
        isLocked: it.isLocked,
      };
      try {
        const res = await addTask(payload);
        if (res) ok += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    setImportStats({ ok, failed });
    if (failed === 0) {
      toast.success(`Imported ${ok} task${ok === 1 ? '' : 's'}`);
    } else {
      toast.warning(`Imported ${ok}, ${failed} failed`);
    }
  }, [rows, mapping, validStatusIds, columns, projectId, projectName, addTask]);

  const handleClose = useCallback(
    (next: boolean) => {
      onOpenChange(next);
      if (!next) reset();
    },
    [onOpenChange, reset],
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            Import tasks from CSV
          </DialogTitle>
          <DialogDescription>
            Upload a CSV with one task per row. We'll let you map columns to
            task fields before importing.
          </DialogDescription>
        </DialogHeader>

        {step === 'upload' && (
          <div className="py-4 space-y-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center w-full h-40 rounded-lg border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 transition-colors text-muted-foreground"
            >
              <Upload className="w-8 h-8 mb-2" />
              <span className="text-sm font-medium">Click to choose a CSV file</span>
              <span className="text-xs">Or drag and drop</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
                e.target.value = '';
              }}
            />
            <p className="text-xs text-muted-foreground">
              Tip: include columns named "Title", "Description", "Status",
              "Priority", "Due Date", "Tags", "Assignees".
            </p>
          </div>
        )}

        {step === 'map' && (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto">
            <p className="text-xs text-muted-foreground">
              Found {rows.length} row{rows.length === 1 ? '' : 's'}. Map each
              CSV column to a task field. Title is required.
            </p>
            {parseErrors.length > 0 && (
              <div className="text-xs text-warning-soft-foreground bg-warning-soft p-2 rounded-md">
                Warnings: {parseErrors.slice(0, 3).join('; ')}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {headers.map((h) => (
                <div key={h} className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-foreground truncate">
                    {h}
                  </span>
                  <Select
                    value={mapping[h] ?? 'ignore'}
                    onValueChange={(v) =>
                      setMapping((prev) => ({
                        ...prev,
                        [h]: v as ImportColumnMapping[string],
                      }))
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TARGET_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value} className="text-xs">
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {previewTasks.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-1.5">
                  Preview ({previewTasks.length} of {rows.length})
                </div>
                <div className="rounded-md border border-border overflow-x-auto">
                  <table className="text-xs w-full">
                    <thead className="bg-secondary text-secondary-foreground">
                      <tr>
                        <th className="px-2 py-1 text-left">Title</th>
                        <th className="px-2 py-1 text-left">Status</th>
                        <th className="px-2 py-1 text-left">Priority</th>
                        <th className="px-2 py-1 text-left">Due</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {previewTasks.map((p, i) => (
                        <tr key={i} className="bg-card">
                          <td className="px-2 py-1 truncate max-w-[180px]">{p.title}</td>
                          <td className="px-2 py-1">{p.status || '—'}</td>
                          <td className="px-2 py-1">{p.priority || '—'}</td>
                          <td className="px-2 py-1">
                            {p.dueDate ? p.dueDate.toLocaleDateString() : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 'importing' && (
          <div className="py-8 flex flex-col items-center justify-center gap-3 text-center">
            {importStats === null ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Importing tasks…</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground">
                  Imported {importStats.ok} task{importStats.ok === 1 ? '' : 's'}
                  {importStats.failed > 0
                    ? `, ${importStats.failed} failed`
                    : ''}
                </p>
                <Button onClick={() => handleClose(false)}>Close</Button>
              </>
            )}
          </div>
        )}

        {step !== 'importing' && (
          <DialogFooter>
            <Button variant="outline" onClick={() => handleClose(false)}>
              Cancel
            </Button>
            {step === 'map' && (
              <Button
                onClick={runImport}
                disabled={!Object.values(mapping).includes('title')}
              >
                Import {rows.length} task{rows.length === 1 ? '' : 's'}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default CsvImportDialog;
