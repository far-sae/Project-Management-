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
import {
  CLIENT_CSV_HEADERS,
  CsvRowError,
  ImportResult,
  importClientsFromCsv,
} from '@/services/supabase/clients';

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

interface ScanResult {
  totalRows: number;
  buckets: CurrencyBucket[];
  unspecified: CurrencyBucket;
  rawRows: Array<Record<string, string>>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | null;
  userId: string | undefined;
  userName: string | undefined;
  onComplete: () => void;
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
const scanRows = (rows: Array<Record<string, string>>): ScanResult => {
  const map = new Map<string, CurrencyBucket>();
  let unspecified: CurrencyBucket = {
    currency: '',
    rowCount: 0,
    totalRevenue: 0,
    sampleNames: [],
  };

  for (const raw of rows) {
    const normalised: Record<string, string> = {};
    for (const k of Object.keys(raw)) {
      normalised[k.toLowerCase().trim()] = (raw[k] ?? '').toString();
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
  };
};

type Phase = 'pick' | 'preview' | 'imported';

export const ImportClientsDialog: React.FC<Props> = ({
  open, onOpenChange, organizationId, userId, userName, onComplete,
}) => {
  const [phase, setPhase] = useState<Phase>('pick');
  const [file, setFile] = useState<File | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = () => {
    setPhase('pick');
    setFile(null);
    setScan(null);
    setParseErrors([]);
    setResult(null);
  };

  const handleFile = (f: File | null) => {
    setResult(null);
    setParseErrors([]);
    setScan(null);
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
      complete: (parsed) => {
        if (parsed.errors.length > 0) {
          setParseErrors(parsed.errors.map((e) => `Row ${e.row}: ${e.message}`));
          setBusy(false);
          return;
        }
        setScan(scanRows(parsed.data));
        setPhase('preview');
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
    setBusy(true);
    setResult(null);
    try {
      const imported = await importClientsFromCsv(
        organizationId,
        userId,
        userName,
        scan.rawRows,
      );
      setResult(imported);
      setPhase('imported');
      if (imported.imported.length > 0) onComplete();
    } catch (err) {
      setParseErrors([err instanceof Error ? err.message : 'Import failed']);
    } finally {
      setBusy(false);
    }
  };

  const distinctCurrencies =
    (scan?.buckets.length ?? 0) + (scan?.unspecified.rowCount ? 1 : 0);
  const isMixed = distinctCurrencies > 1;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import clients from CSV</DialogTitle>
          <DialogDescription>
            Upload a spreadsheet of clients. We'll scan it for currencies and
            show you a breakdown before anything gets imported.
          </DialogDescription>
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
            </div>
          )}

          {phase === 'imported' && result && (
            <div className="rounded-md border p-3 text-sm space-y-2">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-medium">
                <CheckCircle2 className="w-4 h-4" />
                Imported {result.imported.length} client{result.imported.length === 1 ? '' : 's'}
              </div>

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
                    Removed {result.errors.length} row{result.errors.length === 1 ? '' : 's'} that
                    didn't match the client template
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
              disabled={!scan || scan.totalRows === 0 || busy}
            >
              {busy ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4 mr-2" />
              )}
              Import {scan ? `${scan.totalRows} row${scan.totalRows === 1 ? '' : 's'}` : ''}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
