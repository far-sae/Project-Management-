import React, { useMemo, useRef, useState } from 'react';
import {
  Upload, Loader2, Download, FileSpreadsheet, AlertTriangle, CheckCircle2, X,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ImportLeadsResult,
  parseLeadCsv, importLeadsFromCsv, buildLeadsCsvTemplate,
  computeImportPrecheck,
} from '@/services/supabase/leads';
import { toast } from 'sonner';

type Phase = 'pick' | 'preview' | 'importing' | 'imported';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  userId: string | undefined;
  userName: string | undefined;
  /** Called once the import phase finishes. Receives the full result so
   *  the parent can audit success AND failure counts and surface partial
   *  outcomes (not just the imported leads). */
  onComplete: (result: ImportLeadsResult) => void;
}

const downloadFile = (filename: string, content: string, mime: string) => {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

export const ImportLeadsDialog: React.FC<Props> = ({
  open, onOpenChange, organizationId, workspaceId, workspaceName,
  userId, userName, onComplete,
}) => {
  const [phase, setPhase] = useState<Phase>('pick');
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<Array<Record<string, string>>>([]);
  const [duplicateHeaders, setDuplicateHeaders] = useState<Array<{ canonical: string; sources: string[] }>>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [result, setResult] = useState<ImportLeadsResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setPhase('pick');
    setFile(null);
    setParsed([]);
    setDuplicateHeaders([]);
    setParseErrors([]);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = (next: boolean) => {
    if (phase === 'importing') {
      // Surface a toast so the user knows why ESC / overlay-click did
      // nothing. Silent suppression looked like the dialog was frozen.
      if (!next) toast.info('Import in progress — please wait, this can take a minute.');
      return;
    }
    if (!next) reset();
    onOpenChange(next);
  };

  const handleFile = async (f: File) => {
    setFile(f);
    setParseErrors([]);
    try {
      const text = await f.text();
      const { rows, duplicateHeaders: dupes } = parseLeadCsv(text);
      if (rows.length === 0) {
        setParseErrors(['The file looks empty. Add a header row and at least one lead.']);
        return;
      }
      setParsed(rows);
      setDuplicateHeaders(dupes);
      setPhase('preview');
    } catch (err) {
      setParseErrors([
        err instanceof Error ? err.message : "Couldn't read the file.",
      ]);
    }
  };

  const headerSummary = useMemo(() => {
    if (parsed.length === 0) return null;
    return Object.keys(parsed[0]);
  }, [parsed]);

  // Compute precheck (unknown / missing required headers) the moment we
  // have parsed rows, so the preview screen can surface the exact same
  // diagnostics the import would produce — without a wasted round trip.
  const precheck = useMemo(
    () => (parsed.length > 0 ? computeImportPrecheck(parsed) : null),
    [parsed],
  );

  const handleImport = async () => {
    if (!organizationId || !workspaceId || !userId || parsed.length === 0) {
      toast.error('Missing workspace or signed-in user.');
      return;
    }
    setPhase('importing');
    try {
      const res = await importLeadsFromCsv(
        organizationId,
        userId ?? null,
        userName ?? null,
        workspaceId,
        parsed,
        { duplicateHeaders },
      );
      setResult(res);
      setPhase('imported');
      onComplete(res);
    } catch (err) {
      setPhase('preview');
      setParseErrors([err instanceof Error ? err.message : 'Import failed']);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 break-words">
            <Upload className="w-5 h-5 text-primary shrink-0" />
            <span className="min-w-0">Import Leads from CSV</span>
          </DialogTitle>
          <DialogDescription className="break-words">
            Upload a spreadsheet of prospects. We recognize common Salesforce,
            HubSpot, and Apollo column names.
          </DialogDescription>
          <p className="text-xs text-muted-foreground mt-1 break-words">
            Leads will land in workspace{' '}
            <strong className="text-foreground">{workspaceName ?? 'Default'}</strong>.
            Switch workspace in the sidebar before importing to send them
            elsewhere.
          </p>
        </DialogHeader>

        <div className="space-y-4">
          {phase === 'pick' && (
            <PickFile
              fileInputRef={fileInputRef}
              onFile={handleFile}
              parseErrors={parseErrors}
              onDownloadTemplate={() =>
                downloadFile('taskcalendar-leads-template.csv', buildLeadsCsvTemplate(), 'text/csv')
              }
            />
          )}

          {phase === 'preview' && headerSummary && (
            <PreviewBlock
              file={file}
              headers={headerSummary}
              rowCount={parsed.length}
              sampleRows={parsed.slice(0, 3)}
              missingRequired={precheck?.missingRequired ?? []}
              duplicateHeaders={duplicateHeaders}
              hasWorkspace={!!workspaceId}
              parseErrors={parseErrors}
              onReset={reset}
              onImport={handleImport}
            />
          )}

          {phase === 'importing' && (
            <div className="py-8 text-center">
              <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
              <p className="text-sm text-muted-foreground mt-2">
                Importing {parsed.length} row{parsed.length === 1 ? '' : 's'}…
              </p>
            </div>
          )}

          {phase === 'imported' && result && (
            <ResultBlock result={result} onClose={() => handleClose(false)} onReset={reset} />
          )}
        </div>

        <DialogFooter>
          {(phase === 'pick' || phase === 'preview') && (
            <Button variant="outline" onClick={() => handleClose(false)}>
              Cancel
            </Button>
          )}
          {phase === 'imported' && (
            <Button onClick={() => handleClose(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── Sub-components ──────────────────────────────────────────────────────

const PickFile: React.FC<{
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  onFile: (f: File) => void;
  parseErrors: string[];
  onDownloadTemplate: () => void;
}> = ({ fileInputRef, onFile, parseErrors, onDownloadTemplate }) => (
  <div className="space-y-3">
    <button
      type="button"
      onClick={() => fileInputRef.current?.click()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      onDragOver={(e) => e.preventDefault()}
      className="w-full rounded-md border-2 border-dashed border-border hover:border-primary/50 hover:bg-muted/20 p-8 text-center transition-colors"
    >
      <FileSpreadsheet className="w-8 h-8 mx-auto text-muted-foreground" />
      <p className="text-sm font-medium mt-2">Drop a CSV here or click to pick one</p>
      <p className="text-[11px] text-muted-foreground mt-1">
        Required: <strong>last_name</strong> and <strong>company</strong>.
        We also read first_name, email, phone, title, lead_source,
        lead_status, industry, annual_revenue, etc.
      </p>
    </button>
    <input
      ref={fileInputRef}
      type="file"
      accept=".csv,text/csv"
      onChange={(e) => {
        const f = e.target.files?.[0];
        // Clear the value so re-picking the same filename re-fires the
        // change event. Browsers suppress change when the value is
        // identical, which previously trapped users after a parse error.
        e.target.value = '';
        if (f) onFile(f);
      }}
      className="hidden"
    />
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={onDownloadTemplate}
        className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
      >
        <Download className="w-3 h-3" /> Download template CSV
      </button>
      <span className="text-[11px] text-muted-foreground">
        Header aliases like "First Name" / "firstname" / "Given Name" all work.
      </span>
    </div>
    {parseErrors.length > 0 && (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs space-y-1">
        {parseErrors.map((e, i) => (
          <p key={i} className="text-destructive">{e}</p>
        ))}
      </div>
    )}
  </div>
);

const PreviewBlock: React.FC<{
  file: File | null;
  headers: string[];
  rowCount: number;
  sampleRows: Array<Record<string, string>>;
  missingRequired: string[];
  duplicateHeaders: Array<{ canonical: string; sources: string[] }>;
  hasWorkspace: boolean;
  parseErrors: string[];
  onReset: () => void;
  onImport: () => void;
}> = ({
  file, headers, rowCount, sampleRows, missingRequired, duplicateHeaders,
  hasWorkspace, parseErrors, onReset, onImport,
}) => {
  const recognizedHeaders = new Set([
    'first_name', 'last_name', 'full_name', 'salutation', 'title',
    'email', 'phone', 'mobile', 'fax', 'website',
    'company', 'industry', 'annual_revenue', 'no_of_employees',
    'street', 'city', 'state', 'country', 'postal_code',
    'lead_owner_name', 'lead_source', 'lead_status', 'rating',
    'description', 'tags',
    'skype_id', 'twitter', 'linkedin_url',
  ]);
  const unknownHeaders = headers.filter((h) => !recognizedHeaders.has(h));

  return (
    <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
      <div className="rounded-md border p-3 bg-muted/30">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate" title={file?.name ?? undefined}>
              {file?.name ?? 'Uploaded file'}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {rowCount} row{rowCount === 1 ? '' : 's'} · {headers.length} column{headers.length === 1 ? '' : 's'}
            </p>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={onReset} className="shrink-0">
            <X className="w-3.5 h-3.5 mr-1" /> Different file
          </Button>
        </div>
      </div>

      {missingRequired.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs">
          <p className="font-semibold text-destructive inline-flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> Missing required column{missingRequired.length === 1 ? '' : 's'}
          </p>
          <p className="mt-1 break-words">
            We couldn't find: <code className="font-mono break-all">{missingRequired.join(', ')}</code>.
            Add the column (or rename an existing one) and try again.
          </p>
        </div>
      )}

      {unknownHeaders.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
          <p className="font-semibold text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> Columns we'll ignore
          </p>
          <p className="text-amber-700/80 dark:text-amber-300/80 mt-1 break-words">
            We don't have a place for:{' '}
            <code className="font-mono break-all">{unknownHeaders.join(', ')}</code>.
            The rows will still import, just without those values.
          </p>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
          Preview — first 3 rows
        </p>
        <div className="rounded-md border overflow-auto max-h-48">
          <table className="text-[11px] w-full">
            <thead className="bg-muted/40 sticky top-0">
              <tr>
                {headers.map((h) => (
                  <th key={h} className="px-2 py-1 text-left font-semibold whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sampleRows.map((r, i) => (
                <tr key={i} className="border-t border-border/60">
                  {headers.map((h) => (
                    <td key={h} className="px-2 py-1 whitespace-nowrap text-foreground/90">
                      {r[h] || <span className="text-muted-foreground">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {parseErrors.length > 0 && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs space-y-1">
          {parseErrors.map((e, i) => (
            <p key={i} className="text-destructive">{e}</p>
          ))}
        </div>
      )}

      {duplicateHeaders.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
          <p className="font-semibold text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> Duplicate column{duplicateHeaders.length === 1 ? '' : 's'} — only the rightmost wins
          </p>
          <ul className="mt-1 space-y-0.5 text-amber-700/80 dark:text-amber-300/80">
            {duplicateHeaders.map((d) => (
              <li key={d.canonical}>
                <code className="font-mono">{d.sources.join(', ')}</code> all map to <code className="font-mono">{d.canonical}</code>.
              </li>
            ))}
          </ul>
        </div>
      )}

      {!hasWorkspace && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs">
          <p className="font-semibold text-destructive inline-flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> Pick a workspace first
          </p>
          <p className="mt-1">
            You're viewing "All workspaces" or "Unassigned". Switch to a specific
            workspace in the sidebar so the imported leads land somewhere
            predictable.
          </p>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          onClick={onImport}
          disabled={missingRequired.length > 0 || !hasWorkspace}
        >
          <Upload className="w-4 h-4 mr-2" /> Import {rowCount} lead{rowCount === 1 ? '' : 's'}
        </Button>
      </div>
    </div>
  );
};

const ResultBlock: React.FC<{
  result: ImportLeadsResult;
  onClose: () => void;
  onReset: () => void;
}> = ({ result, onReset }) => {
  const total = result.imported.length + result.errors.length;
  return (
    <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
      <div className="rounded-md border bg-card p-3 space-y-1">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          <p className="text-sm font-semibold">
            Imported {result.imported.length} of {total} lead{total === 1 ? '' : 's'}
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {result.errors.length === 0
            ? 'No errors. Open the Leads tab to see them.'
            : `${result.errors.length} row${result.errors.length === 1 ? '' : 's'} skipped — see below.`}
        </p>
      </div>

      {result.unknownHeaders.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
          <p className="text-amber-700 dark:text-amber-300">
            Ignored columns: <code className="font-mono">{result.unknownHeaders.join(', ')}</code>
          </p>
        </div>
      )}

      {result.coercions.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
          <p className="font-semibold text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> Coerced values ({result.coercions.length})
          </p>
          <p className="mt-1 text-amber-700/80 dark:text-amber-300/80">
            These rows had values we didn't recognise. We picked a default
            so the import would still succeed — review and update them after
            you confirm the rest of the file looks right.
          </p>
          <ul className="mt-1 space-y-0.5 max-h-24 overflow-y-auto">
            {result.coercions.slice(0, 50).map((c, i) => (
              <li key={`${c.row}-${i}`} className="text-amber-700/80 dark:text-amber-300/80">
                Row {c.row} · {c.field}: <code className="font-mono">"{c.original}"</code> → <code className="font-mono">{c.coercedTo}</code>
              </li>
            ))}
            {result.coercions.length > 50 && (
              <li className="text-amber-700/70">+{result.coercions.length - 50} more…</li>
            )}
          </ul>
        </div>
      )}

      {result.aborted && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs">
          <p className="font-semibold text-destructive inline-flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> Import was aborted early
          </p>
          <p className="mt-1">
            Multiple consecutive rows failed with the same error — usually a
            permission or workspace mismatch. Fix the underlying problem and
            re-import the remaining rows.
          </p>
        </div>
      )}

      {result.errors.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Skipped rows
          </p>
          <div className="rounded-md border max-h-44 overflow-y-auto divide-y">
            {result.errors.slice(0, 50).map((e) => (
              <div key={`${e.row}-${e.message}`} className="p-2 text-[11px] flex items-start gap-2">
                <Badge variant="outline" className="text-[9px] shrink-0">Row {e.row}</Badge>
                <span className="text-foreground/80">{e.message}</span>
              </div>
            ))}
            {result.errors.length > 50 && (
              <p className="p-2 text-[11px] text-muted-foreground">
                +{result.errors.length - 50} more…
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" onClick={onReset}>
          Import another file
        </Button>
      </div>
    </div>
  );
};
