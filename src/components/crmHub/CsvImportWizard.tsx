import React, { useMemo, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { supabase } from '@/services/supabase/config';
import { parseCSV } from '@/lib/csv';
import {
  ArrowLeft, ArrowRight, CheckCircle2, FileSpreadsheet, Upload, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface FieldDef {
  key: string;
  label: string;
  required?: boolean;
}

export type ImportResource = 'contacts' | 'companies';

const FIELDS: Record<ImportResource, FieldDef[]> = {
  contacts: [
    { key: 'first_name', label: 'First name', required: true },
    { key: 'last_name', label: 'Last name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'job_title', label: 'Job title' },
    { key: 'source', label: 'Source' },
  ],
  companies: [
    { key: 'name', label: 'Company name', required: true },
    { key: 'website', label: 'Website' },
    { key: 'industry', label: 'Industry' },
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email' },
    { key: 'address', label: 'Address' },
    { key: 'city', label: 'City' },
    { key: 'country', label: 'Country' },
    { key: 'company_size', label: 'Company size' },
    { key: 'annual_revenue', label: 'Annual revenue' },
  ],
};

const TABLE: Record<ImportResource, string> = {
  contacts: 'crm_contacts',
  companies: 'crm_companies',
};

const SKIP = '__skip__';

function autoMatch(header: string, fields: FieldDef[]): string {
  const h = header.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const f of fields) {
    const k = f.key.replace(/[^a-z0-9]/g, '');
    if (h === k) return f.key;
    if (h.includes(k) || k.includes(h)) return f.key;
  }
  const has = (k: string) => fields.some((f) => f.key === k);
  if (h.includes('first') && has('first_name')) return 'first_name';
  if ((h.includes('last') || h === 'surname') && has('last_name')) return 'last_name';
  if ((h.includes('title') || h === 'role') && has('job_title')) return 'job_title';
  if (h.includes('mail') && has('email')) return 'email';
  if ((h.includes('tel') || h.includes('mobile') || h.includes('phone')) && has('phone')) return 'phone';
  if ((h.includes('org') || h.includes('companyname')) && has('name')) return 'name';
  if (h.includes('size') && has('company_size')) return 'company_size';
  if (h.includes('revenue') && has('annual_revenue')) return 'annual_revenue';
  return SKIP;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resource: ImportResource;
  onImported?: () => void | Promise<void>;
}

export const CsvImportWizard: React.FC<Props> = ({ open, onOpenChange, resource, onImported }) => {
  const fields = FIELDS[resource];
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;

  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setStep(1); setFileName(''); setRows([]); setHeaders([]); setMapping({});
  };

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      if (!parsed.length) { toast.error('CSV looks empty'); return; }
      const hs = Object.keys(parsed[0]);
      setRows(parsed);
      setHeaders(hs);
      setFileName(file.name);
      const m: Record<string, string> = {};
      hs.forEach((h) => { m[h] = autoMatch(h, fields); });
      setMapping(m);
      setStep(2);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read CSV');
    }
  };

  const requiredOk = useMemo(() => {
    const used = new Set(Object.values(mapping));
    return fields.filter((f) => f.required).every((f) => used.has(f.key));
  }, [mapping, fields]);

  const mappedCount = Object.values(mapping).filter((v) => v && v !== SKIP).length;

  const handleImport = async () => {
    if (!orgId) return;
    setBusy(true);
    try {
      const payload = rows.map((r) => {
        const o: Record<string, unknown> = {
          organization_id: orgId,
          owner_id: user?.userId ?? null,
        };
        for (const [header, key] of Object.entries(mapping)) {
          if (!key || key === SKIP) continue;
          const v = r[header]?.trim();
          if (!v) continue;
          // Numeric coercion for known number columns
          if (key === 'annual_revenue') {
            const n = Number(v.replace(/[^\d.-]/g, ''));
            if (Number.isFinite(n)) o[key] = n;
          } else {
            o[key] = v;
          }
        }
        return o;
      }).filter((o) => fields.filter((f) => f.required).every((f) => o[f.key]));

      if (!payload.length) throw new Error('No valid rows after mapping');

      const { error } = await supabase.from(TABLE[resource]).insert(payload as never);
      if (error) throw error;

      toast.success(`Imported ${payload.length} ${resource}`);
      await onImported?.();
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="capitalize">Import {resource}</DialogTitle>
          <DialogDescription>
            Step {step} of 3 — {step === 1 ? 'upload a CSV file' : step === 2 ? 'match your columns to fields' : 'review & import'}
          </DialogDescription>
        </DialogHeader>

        {/* Progress */}
        <div className="flex items-center gap-2 pb-2">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex flex-1 items-center gap-2">
              <div className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
                step === n ? 'bg-primary text-primary-foreground'
                : step > n ? 'bg-primary/20 text-primary'
                : 'bg-muted text-muted-foreground',
              )}>
                {step > n ? <CheckCircle2 className="h-4 w-4" /> : n}
              </div>
              <div className={cn('h-1 flex-1 rounded-full', step > n ? 'bg-primary' : 'bg-muted')} />
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-muted/30 p-10 text-center transition-colors hover:border-primary hover:bg-muted"
            >
              <div className="grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">
                <Upload className="h-7 w-7" />
              </div>
              <div>
                <p className="text-base font-semibold">Drop a CSV file or click to browse</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  We'll auto-match your columns to {resource === 'contacts' ? 'contact' : 'company'} fields in the next step.
                </p>
              </div>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.currentTarget.value = ''; }}
            />
            <div className="rounded-lg border border-border bg-card p-4 text-sm">
              <p className="font-medium">Expected columns</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {fields.map((f) => f.label + (f.required ? ' *' : '')).join(', ')}
              </p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                <span className="font-medium">{fileName}</span>
                <Badge variant="secondary">{rows.length} rows</Badge>
              </div>
              <Badge variant={requiredOk ? 'secondary' : 'destructive'}>{mappedCount} mapped</Badge>
            </div>
            <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Column from file</th>
                    <th className="px-3 py-2 text-left">Preview</th>
                    <th className="px-3 py-2 text-left">Map to field</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((h) => (
                    <tr key={h} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{h}</td>
                      <td className="px-3 py-2 text-muted-foreground">{rows[0]?.[h] || '—'}</td>
                      <td className="px-3 py-2">
                        <Select value={mapping[h] ?? SKIP} onValueChange={(v) => setMapping({ ...mapping, [h]: v })}>
                          <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={SKIP}>— Don't import —</SelectItem>
                            {fields.map((f) => (
                              <SelectItem key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!requiredOk && (
              <p className="text-xs text-destructive">
                Map all required fields ({fields.filter((f) => f.required).map((f) => f.label).join(', ')}) to continue.
              </p>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-muted/40 p-5">
              <p className="text-sm font-semibold">Ready to import</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {rows.length} rows from <span className="font-medium">{fileName}</span> will be added to {resource}.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {Object.entries(mapping).filter(([, v]) => v && v !== SKIP).map(([h, v]) => (
                  <Badge key={h} variant="secondary" className="font-normal">
                    {h} → {fields.find((f) => f.key === v)?.label ?? v}
                  </Badge>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Duplicates are not checked. Records will be created with your user as the owner.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { if (step === 1) onOpenChange(false); else setStep((step - 1) as 1 | 2 | 3); }}
            disabled={busy}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />{step === 1 ? 'Cancel' : 'Back'}
          </Button>
          {step < 3 ? (
            <Button
              size="sm"
              disabled={step === 2 && !requiredOk}
              onClick={() => setStep((step + 1) as 1 | 2 | 3)}
            >
              Next <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button size="sm" disabled={busy} onClick={handleImport}>
              {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Import {rows.length} rows
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CsvImportWizard;
