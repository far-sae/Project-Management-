import React, { useState } from 'react';
import Papa from 'papaparse';
import { Loader2, Upload, Download, AlertTriangle, CheckCircle2 } from 'lucide-react';
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

export const ImportClientsDialog: React.FC<Props> = ({
  open, onOpenChange, organizationId, userId, userName, onComplete,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = () => {
    setFile(null);
    setParseErrors([]);
    setResult(null);
  };

  const handleFile = (f: File | null) => {
    setResult(null);
    setParseErrors([]);
    setFile(f);
  };

  const startImport = async () => {
    if (!file || !organizationId || !userId || !userName) return;
    setBusy(true);
    setResult(null);
    setParseErrors([]);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim().toLowerCase(),
      complete: async (parsed) => {
        if (parsed.errors.length > 0) {
          setParseErrors(parsed.errors.map((e) => `Row ${e.row}: ${e.message}`));
          setBusy(false);
          return;
        }
        try {
          const imported = await importClientsFromCsv(
            organizationId,
            userId,
            userName,
            parsed.data,
          );
          setResult(imported);
          if (imported.imported.length > 0) onComplete();
        } catch (err) {
          setParseErrors([err instanceof Error ? err.message : 'Import failed']);
        } finally {
          setBusy(false);
        }
      },
      error: (err: Error) => {
        setParseErrors([err.message || 'Failed to parse CSV']);
        setBusy(false);
      },
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import clients from CSV</DialogTitle>
          <DialogDescription>
            Upload a spreadsheet of clients. We'll create one client per row.
            Download the template to get the expected column names.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => downloadCsv('clients-template.csv', SAMPLE_TEMPLATE)}
            >
              <Download className="w-4 h-4 mr-2" /> Download template
            </Button>
          </div>

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

          {result && (
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
            Close
          </Button>
          <Button onClick={startImport} disabled={!file || busy}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
