import React, { useState } from 'react';
import Papa from 'papaparse';
import {
  Loader2, Upload, Download, AlertTriangle, CheckCircle2,
  Coins, RotateCcw, ArrowRight,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  CLIENT_CSV_HEADERS,
  CsvRowError,
  getClientCsvHeaderMappings,
  importClientsFromCsv,
  importClientsOverrideRow,
  isApolloStyleClientCsv,
  normalizeClientCsvHeader,
  previewClientImportRows,
  type Client,
  type ImportResult,
  type ImportPreviewIssue,
  type ImportPreviewResult,
} from '@/services/supabase/clients';

// Supabase + thrown plain objects don't always satisfy `instanceof Error`,
// so `err.message` on the unknown can yield "Override failed" when there's
// actually a useful Postgres message attached. Walk known shapes and pull
// the most informative string we can.
const extractErrorMessage = (err: unknown, fallback: string): string => {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const message = typeof e.message === 'string' ? e.message : '';
    const details = typeof e.details === 'string' ? e.details : '';
    const hint = typeof e.hint === 'string' ? e.hint : '';
    const code = typeof e.code === 'string' ? e.code : '';
    const composed = [message, details, hint && `(hint: ${hint})`, code && `[${code}]`]
      .filter(Boolean)
      .join(' — ');
    if (composed) return composed;
  }
  return fallback;
};

// Sample row uses every column the canonical template ships with so importers
// can see what kind of data each field expects. Columns are split into core
// (top-level Client fields) + business extras (captured into customFields).
const SAMPLE_VALUES: Record<string, string> = {
  name: 'Acme Corp',
  legal_name: 'Acme Corporation Ltd',
  industry: 'Manufacturing',
  type: 'customer',
  status: 'active',
  website: 'https://acme.com',
  email: 'sales@acme.com',
  phone: '+15550100',
  address_line1: '1 Market St',
  address_line2: 'Suite 200',
  city: 'San Francisco',
  state: 'CA',
  postal_code: '94105',
  country: 'US',
  annual_revenue: '5000000',
  employee_count: '250',
  rating: 'Hot',
  source: 'Referral',
  description: 'VIP enterprise account',
  tags: 'enterprise;priority',
  account_owner_name: 'Jane Doe',
  account_number: 'ACME-0001',
  tax_id: 'GB123456789',
  currency: 'USD',
  payment_terms: 'NET30',
  billing_email: 'billing@acme.com',
  billing_phone: '+15550199',
  primary_contact_name: 'John Smith',
  primary_contact_email: 'john@acme.com',
  primary_contact_phone: '+15550101',
  secondary_contact_name: '',
  secondary_contact_email: '',
  secondary_contact_phone: '',
  lifecycle_stage: 'customer',
  linkedin_url: 'https://linkedin.com/company/acme',
  twitter_url: 'https://twitter.com/acme',
  notes: 'Net-30 only via PO',
};
const SAMPLE_TEMPLATE = [
  CLIENT_CSV_HEADERS.join(','),
  CLIENT_CSV_HEADERS.map((h) => {
    const v = SAMPLE_VALUES[h] ?? '';
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(','),
  '',
].join('\n');

interface CurrencyBucket {
  currency: string;
  rowCount: number;
  totalRevenue: number;
  sampleNames: string[];
}

interface HeaderMapping {
  source: string;
  target: string;
  mapped: boolean;
  recognized: boolean;
}

interface ScanResult {
  totalRows: number;
  buckets: CurrencyBucket[];
  unspecified: CurrencyBucket;
  rawRows: Array<Record<string, string>>;
  headerMappings: HeaderMapping[];
  isApolloStyle: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | null;
  /** Workspace every imported row should land in. Comes from the page's
   *  current sidebar selection so imports respect the workspace boundary. */
  workspaceId?: string | null;
  workspaceName?: string | null;
  userId: string | undefined;
  userName: string | undefined;
  /** Called after every successful import phase. Receives the clients we
   *  just persisted so the parent can auto-switch to a grouped view, scroll
   *  to a category, etc. */
  onComplete: (imported?: Client[]) => void;
}

const downloadCsv = (filename: string, content: string) => {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const parseAmount = (v: string | undefined): number => {
  const cleaned = (v ?? '').replace(/[^\d.\-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};

const formatCurrencyTotal = (amount: number, currency: string): string => {
  if (!currency) {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 0,
    }).format(amount);
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
};

/**
 * Group parsed rows by their `currency` column value. Rows without a currency
 * fall into the "unspecified" bucket so the importer can spot when their
 * spreadsheet is missing the column entirely vs. having a mix.
 */
const scanRows = (
  rows: Array<Record<string, string>>,
  sourceHeaders: string[] = [],
): ScanResult => {
  const map = new Map<string, CurrencyBucket>();
  let unspecified: CurrencyBucket = {
    currency: '',
    rowCount: 0,
    totalRevenue: 0,
    sampleNames: [],
  };
  const headers = sourceHeaders.length > 0
    ? sourceHeaders
    : Object.keys(rows[0] ?? {});
  const headerMappings = getClientCsvHeaderMappings(headers);

  for (const raw of rows) {
    const normalised: Record<string, string> = {};
    for (const k of Object.keys(raw)) {
      normalised[normalizeClientCsvHeader(k)] = (raw[k] ?? '').toString();
    }
    const hasAnyValue = Object.values(normalised).some((v) => v.trim() !== '');
    if (!hasAnyValue) continue;

    const currency = (normalised.currency || '').trim().toUpperCase();
    const revenue = parseAmount(normalised.annual_revenue);
    const name = (normalised.name || '').trim() || '(unnamed)';

    const bucket =
      currency.length === 0
        ? unspecified
        : map.get(currency) ?? {
            currency,
            rowCount: 0,
            totalRevenue: 0,
            sampleNames: [],
          };
    bucket.rowCount += 1;
    bucket.totalRevenue += revenue;
    if (bucket.sampleNames.length < 3) bucket.sampleNames.push(name);
    if (currency.length > 0) map.set(currency, bucket);
    else unspecified = bucket;
  }

  // Sort: largest bucket first (most rows, then highest revenue).
  const buckets = Array.from(map.values()).sort((a, b) =>
    b.rowCount !== a.rowCount
      ? b.rowCount - a.rowCount
      : b.totalRevenue - a.totalRevenue,
  );

  return {
    totalRows: buckets.reduce((acc, b) => acc + b.rowCount, 0) + unspecified.rowCount,
    buckets,
    unspecified,
    rawRows: rows,
    headerMappings,
    isApolloStyle: isApolloStyleClientCsv(headers),
  };
};

type Phase = 'pick' | 'preview' | 'imported';

export const ImportClientsDialog: React.FC<Props> = ({
  open, onOpenChange, organizationId, workspaceId, workspaceName,
  userId, userName, onComplete,
}) => {
  const [phase, setPhase] = useState<Phase>('pick');
  const [file, setFile] = useState<File | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [checkingRows, setCheckingRows] = useState(false);
  const [rowReview, setRowReview] = useState<ImportPreviewResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  // User-picked extra column names to capture into customFields for this import.
  const [extraColumns, setExtraColumns] = useState<string[]>([]);
  const [newColumnInput, setNewColumnInput] = useState('');

  const reset = () => {
    setPhase('pick');
    setFile(null);
    setScan(null);
    setRowReview(null);
    setCheckingRows(false);
    setParseErrors([]);
    setResult(null);
  };

  const handleFile = (f: File | null) => {
    setResult(null);
    setParseErrors([]);
    setScan(null);
    setRowReview(null);
    setCheckingRows(false);
    setFile(f);
    if (!f) {
      setPhase('pick');
      return;
    }
    // Auto-parse the file the moment it lands so the user sees the currency
    // breakdown without an extra click. The actual DB writes are deferred to
    // the explicit "Confirm import" step.
    setBusy(true);
    Papa.parse<Record<string, string>>(f, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim().toLowerCase(),
      complete: async (parsed) => {
        if (parsed.errors.length > 0) {
          setParseErrors(parsed.errors.map((e) => `Row ${e.row}: ${e.message}`));
          setBusy(false);
          return;
        }
        const nextScan = scanRows(parsed.data, parsed.meta.fields ?? []);
        setScan(nextScan);
        setPhase('preview');
        if (organizationId) {
          setCheckingRows(true);
          try {
            setRowReview(await previewClientImportRows(organizationId, parsed.data, extraColumns));
          } catch (err) {
            setParseErrors([
              err instanceof Error
                ? err.message
                : 'Could not compare this CSV with existing clients',
            ]);
          } finally {
            setCheckingRows(false);
          }
        }
        setBusy(false);
      },
      error: (err: Error) => {
        setParseErrors([err.message || 'Failed to parse CSV']);
        setBusy(false);
      },
    });
  };

  const confirmImport = async () => {
    if (!scan || !organizationId || !userId || !userName) return;
    const rowsToImport = rowReview?.importableRows ?? scan.rawRows;
    if (rowsToImport.length === 0) {
      setParseErrors(['No clean rows to import. Fix or override the red rows first.']);
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const imported = await importClientsFromCsv(
        organizationId,
        userId,
        userName,
        rowsToImport,
        extraColumns,
        workspaceId ?? null,
      );
      setResult(imported);
      setPhase('imported');
      if (imported.imported.length > 0) onComplete(imported.imported);
    } catch (err) {
      setParseErrors([err instanceof Error ? err.message : 'Import failed']);
    } finally {
      setBusy(false);
    }
  };

  const distinctCurrencies =
    (scan?.buckets.length ?? 0) + (scan?.unspecified.rowCount ? 1 : 0);
  const isMixed = distinctCurrencies > 1;
  const mappedHeaders = scan?.headerMappings.filter((h) => h.mapped && h.recognized) ?? [];
  const ignoredHeaders = scan?.headerMappings.filter((h) => !h.recognized) ?? [];
  const readyRows = rowReview?.importableRows.length ?? scan?.totalRows ?? 0;
  const blockedRows =
    (rowReview?.invalidRows.length ?? 0) + (rowReview?.duplicateRows.length ?? 0);
  const visibleBlockedRows = rowReview
    ? Math.min(rowReview.duplicateRows.length, 8) + Math.min(rowReview.invalidRows.length, 8)
    : 0;

  const overrideDuplicate = async (issue: ImportPreviewIssue) => {
    if (!organizationId || !userId || !userName) {
      toast.error('Not signed in — refresh and try again.');
      return;
    }
    if (!issue.input) {
      toast.error("Couldn't override that row — the parsed input is missing. Try re-uploading the file.");
      return;
    }
    if (!issue.matches?.[0]) {
      toast.error("Couldn't override that row — no matched existing client to override against.");
      return;
    }
    if (!workspaceId) {
      toast.error('Pick a workspace first — overrides need to know where to file the new client.');
      return;
    }
    setBusy(true);
    try {
      const created = await importClientsOverrideRow(
        organizationId,
        userId,
        userName,
        issue.input,
        issue.matches[0].clientId,
        workspaceId,
      );
      setRowReview((prev) =>
        prev
          ? {
              ...prev,
              duplicateRows: prev.duplicateRows.filter((row) => row.row !== issue.row),
            }
          : prev,
      );
      onComplete([created]);
      toast.success(`Created "${issue.name}" as a new client`);
    } catch (err) {
      toast.error(extractErrorMessage(err, 'Override failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="w-[97vw] max-w-[97vw] sm:max-w-6xl max-h-[95vh] sm:max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import clients from CSV</DialogTitle>
          <DialogDescription>
            Upload a spreadsheet of clients or leads. We'll recognize common
            CRM and Apollo columns, show a preview, then import only after you confirm.
          </DialogDescription>
          <p className="text-xs text-muted-foreground mt-1">
            Imported rows will land in workspace{' '}
            <strong className="text-foreground">
              {workspaceName ?? 'Default'}
            </strong>
            . Switch workspace in the sidebar before importing to send them
            somewhere else.
          </p>
        </DialogHeader>

        <div className="space-y-4">
          {phase !== 'imported' && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => downloadCsv('clients-template.csv', SAMPLE_TEMPLATE)}
              >
                <Download className="w-4 h-4 mr-2" /> Download template
              </Button>
              {phase === 'preview' && (
                <Button type="button" variant="ghost" onClick={reset}>
                  <RotateCcw className="w-4 h-4 mr-2" /> Pick a different file
                </Button>
              )}
            </div>
          )}

          {phase === 'pick' && (
            <label
              htmlFor="csv-file"
              className="block border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:bg-secondary/40 transition-colors"
            >
              <Upload className="w-6 h-6 mx-auto text-muted-foreground" />
              <p className="text-sm font-medium mt-2">
                {file ? file.name : 'Click to choose a CSV file'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                .csv up to a few thousand rows
              </p>
              <input
                id="csv-file" type="file" accept=".csv,text/csv" className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                // Reset value so picking the same file again still fires onChange
                onClick={(e) => ((e.target as HTMLInputElement).value = '')}
              />
            </label>
          )}

          {parseErrors.length > 0 && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-md p-3 text-sm">
              <div className="flex items-center gap-2 text-destructive font-medium mb-1">
                <AlertTriangle className="w-4 h-4" /> CSV problems
              </div>
              <ul className="list-disc pl-5 space-y-0.5 text-destructive/90">
                {parseErrors.slice(0, 8).map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
                {parseErrors.length > 8 && (
                  <li>…and {parseErrors.length - 8} more</li>
                )}
              </ul>
            </div>
          )}

          {phase === 'preview' && scan && (
            <div className="rounded-md border border-border p-3 space-y-3">
              <div className="rounded-md bg-primary/5 border border-primary/20 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-primary mt-0.5" />
                  <div>
                    <p className="font-medium">
                      {scan.isApolloStyle
                        ? 'We recognized this as an Apollo-style leads file.'
                        : 'We checked your spreadsheet columns.'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Company columns become client fields. Person fields like
                      fullName, position, seniority, and LinkedIn are kept as client
                      details for now.
                    </p>
                    {mappedHeaders.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Mapped: {mappedHeaders.slice(0, 6).map((h) => `${h.source} → ${h.target}`).join(', ')}
                        {mappedHeaders.length > 6 && `, +${mappedHeaders.length - 6} more`}
                      </p>
                    )}
                    {ignoredHeaders.length > 0 && (
                      <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">
                        Ignored: {ignoredHeaders.slice(0, 6).map((h) => h.source).join(', ')}
                        {ignoredHeaders.length > 6 && `, +${ignoredHeaders.length - 6} more`}.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Add custom column — lets users keep ignored columns as customFields. */}
              <div className="rounded-md border border-border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="text-sm font-medium">Keep extra columns</p>
                    <p className="text-xs text-muted-foreground">
                      Type a column name from your CSV to capture it on each client as a custom field.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newColumnInput}
                    onChange={(e) => setNewColumnInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newColumnInput.trim()) {
                        e.preventDefault();
                        const k = newColumnInput.trim().toLowerCase().replace(/\s+/g, '_');
                        if (k && !extraColumns.includes(k)) setExtraColumns([...extraColumns, k]);
                        setNewColumnInput('');
                      }
                    }}
                    placeholder="e.g. region, sla_tier, renewal_date"
                    className="flex-1 h-8 rounded-md border border-input bg-transparent px-2 text-sm"
                  />
                  <Button
                    size="sm" variant="outline"
                    type="button"
                    onClick={() => {
                      const k = newColumnInput.trim().toLowerCase().replace(/\s+/g, '_');
                      if (k && !extraColumns.includes(k)) setExtraColumns([...extraColumns, k]);
                      setNewColumnInput('');
                    }}
                    disabled={!newColumnInput.trim()}
                  >
                    Add column
                  </Button>
                </div>
                {ignoredHeaders.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Quick add from ignored columns:
                    <div className="mt-1 flex flex-wrap gap-1">
                      {ignoredHeaders.slice(0, 8).map((h) => (
                        <button
                          key={h.source}
                          type="button"
                          className="px-2 py-0.5 rounded border border-border hover:bg-secondary text-foreground/80 text-[11px]"
                          onClick={() => {
                            if (!extraColumns.includes(h.source)) {
                              setExtraColumns([...extraColumns, h.source]);
                            }
                          }}
                        >
                          + {h.source}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {extraColumns.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {extraColumns.map((c) => (
                      <span
                        key={c}
                        className="inline-flex items-center gap-1 rounded bg-primary/10 text-primary px-2 py-0.5 text-[11px]"
                      >
                        {c}
                        <button
                          type="button"
                          className="hover:text-foreground"
                          onClick={() => setExtraColumns(extraColumns.filter((x) => x !== c))}
                          aria-label={`Remove ${c}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Coins className="w-4 h-4 text-primary" />
                  <span className="font-medium text-foreground">
                    Currency breakdown
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {scan.totalRows} row{scan.totalRows === 1 ? '' : 's'} ·{' '}
                    {distinctCurrencies} currenc{distinctCurrencies === 1 ? 'y' : 'ies'} detected
                  </span>
                </div>
                {isMixed && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                    Mixed currencies
                  </span>
                )}
              </div>

              {scan.buckets.length === 0 && scan.unspecified.rowCount === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No rows found in this file.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-muted-foreground border-b border-border">
                      <tr>
                        <th className="text-left py-2 pr-3">Currency</th>
                        <th className="text-right py-2 pr-3">Rows</th>
                        <th className="text-right py-2 pr-3">Total revenue</th>
                        <th className="text-left py-2">Sample</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scan.buckets.map((b) => (
                        <tr key={b.currency} className="border-b border-border last:border-0">
                          <td className="py-2 pr-3 font-mono font-medium">
                            {b.currency}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {b.rowCount}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {formatCurrencyTotal(b.totalRevenue, b.currency)}
                          </td>
                          <td className="py-2 text-muted-foreground truncate max-w-[18rem]">
                            {b.sampleNames.join(', ')}
                            {b.rowCount > b.sampleNames.length && '…'}
                          </td>
                        </tr>
                      ))}
                      {scan.unspecified.rowCount > 0 && (
                        <tr className="border-b border-border last:border-0">
                          <td className="py-2 pr-3 italic text-muted-foreground">
                            Unspecified
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {scan.unspecified.rowCount}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                            {formatCurrencyTotal(scan.unspecified.totalRevenue, '')}
                          </td>
                          <td className="py-2 text-muted-foreground truncate max-w-[18rem]">
                            {scan.unspecified.sampleNames.join(', ')}
                            {scan.unspecified.rowCount > scan.unspecified.sampleNames.length && '…'}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {scan.unspecified.rowCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  Rows without a <code>currency</code> column will inherit the
                  org default when the client's revenue is shown.
                </p>
              )}
              {isMixed && (
                <p className="text-xs text-muted-foreground">
                  Heads up: multiple currencies were detected. Each client's
                  values are stored in its own currency — the table above is
                  intentionally not converted to a single number.
                </p>
              )}

              <div className="rounded-md border border-border p-3 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-medium text-sm">Existing-client comparison</p>
                    <p className="text-xs text-muted-foreground">
                      We compare each row with your clients table before import. Red rows are removed from the import.
                    </p>
                  </div>
                  {checkingRows ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="w-3 h-3 animate-spin" /> Checking rows
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                        {readyRows} ready
                      </span>
                      <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-destructive border border-destructive/30">
                        {blockedRows} removed
                      </span>
                    </div>
                  )}
                </div>

                {rowReview && blockedRows > 0 && (
                  <div className="space-y-2">
                    {rowReview.duplicateRows.slice(0, 8).map((issue) => (
                      <div
                        key={`dup-${issue.row}`}
                        className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-medium text-destructive">
                              Row {issue.row}: {issue.name} removed as possible duplicate
                            </p>
                            <p className="text-muted-foreground">
                              Matches <strong>{issue.matches?.[0]?.name}</strong>
                              {issue.matches?.[0]?.reasons?.length
                                ? ` · ${issue.matches[0].reasons.join(', ')}`
                                : ''}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => overrideDuplicate(issue)}
                          >
                            Add as new anyway
                          </Button>
                        </div>
                      </div>
                    ))}

                    {rowReview.invalidRows.slice(0, 8).map((issue) => (
                      <div
                        key={`invalid-${issue.row}`}
                        className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs"
                      >
                        <p className="font-medium text-destructive">
                          Row {issue.row}: {issue.name} removed
                        </p>
                        <p className="text-muted-foreground">{issue.message}</p>
                      </div>
                    ))}

                    {blockedRows > visibleBlockedRows && (
                      <p className="text-xs text-muted-foreground">
                        And {blockedRows - visibleBlockedRows} more removed row
                        {blockedRows - visibleBlockedRows === 1 ? '' : 's'}.
                      </p>
                    )}
                  </div>
                )}

                {rowReview && blockedRows === 0 && (
                  <p className="text-xs text-emerald-700 dark:text-emerald-300">
                    No duplicates or invalid rows found. This file is ready to import.
                  </p>
                )}
              </div>
            </div>
          )}

          {phase === 'imported' && result && (
            <div className="rounded-md border p-3 text-sm space-y-2">
              <div
                className={`flex items-center gap-2 font-medium ${
                  result.imported.length > 0
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : 'text-amber-700 dark:text-amber-300'
                }`}
              >
                {result.imported.length > 0 ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <AlertTriangle className="w-4 h-4" />
                )}
                Imported {result.imported.length} client{result.imported.length === 1 ? '' : 's'}
              </div>
              {result.imported.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nothing was added. Check the skipped rows below; most import
                  issues come from missing company/client names or duplicate clients.
                </p>
              )}

              {result.unknownHeaders.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Ignored columns:</span>{' '}
                  {result.unknownHeaders.join(', ')}
                  {' '}— these aren't in the client template, so their values
                  weren't imported.
                </div>
              )}

              {result.errors.length > 0 && (
                <div>
                  <div className="text-amber-700 dark:text-amber-300 font-medium flex items-center gap-2 mb-1">
                    <AlertTriangle className="w-4 h-4" />
                    Skipped {result.errors.length} row{result.errors.length === 1 ? '' : 's'} that
                    could not become clients
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
                    {result.errors.slice(0, 8).map((e: CsvRowError, i) => (
                      <li key={i}>Row {e.row}: {e.message}</li>
                    ))}
                    {result.errors.length > 8 && (
                      <li>…and {result.errors.length - 8} more</li>
                    )}
                  </ul>
                </div>
              )}

              {result.rejectedDuplicates && result.rejectedDuplicates.length > 0 && (
                <div className="rounded-md border bg-amber-500/10 p-3 space-y-2">
                  <p className="font-medium text-sm">
                    Rejected: {result.rejectedDuplicates.length} duplicate(s)
                  </p>
                  {result.rejectedDuplicates.map((r) => (
                    <div key={r.row} className="text-xs flex items-center gap-2">
                      <span className="flex-1">
                        Row {r.row}: <strong>{r.input.name}</strong> matches{' '}
                        <strong>{r.matches[0]?.name}</strong>
                        {r.matches[0]?.reasons?.length
                          ? ` (${r.matches[0].reasons.join(', ')})`
                          : ''}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          if (!organizationId || !userId || !userName) return;
                          try {
                            await importClientsOverrideRow(
                              organizationId,
                              userId,
                              userName,
                              r.input,
                              r.matches[0].clientId,
                              workspaceId ?? null,
                            );
                            toast.success('Overridden');
                          } catch (err) {
                            toast.error(extractErrorMessage(err, 'Override failed'));
                          }
                        }}
                      >
                        Override and create anyway
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button" variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {phase === 'imported' ? 'Done' : 'Cancel'}
          </Button>
          {phase === 'preview' && (
            <Button
              onClick={confirmImport}
              disabled={!scan || readyRows === 0 || busy || checkingRows}
            >
              {busy ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4 mr-2" />
              )}
              Import {scan ? `${readyRows} clean row${readyRows === 1 ? '' : 's'}` : ''}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
