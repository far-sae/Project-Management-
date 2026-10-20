import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useWorkspaceForCreate } from '@/hooks/useCrmHub';
import { supabase } from '@/services/supabase/config';
import { parseCSV } from '@/lib/csv';
import { listLeadCategories } from '@/services/supabase/crmHub/contacts';
import {
  ArrowLeft, ArrowRight, CheckCircle2, FileSpreadsheet, Upload, Loader2, Tag as TagIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
    { key: 'lifecycle_stage', label: 'Lifecycle stage' },
    { key: 'lead_status', label: 'Lead status' },
    { key: 'category', label: 'Category' },
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

const RESOURCE_LABEL: Record<ImportResource, { singular: string; plural: string; titleCase: string }> = {
  contacts: { singular: 'contact', plural: 'contacts', titleCase: 'Contacts' },
  companies: { singular: 'company', plural: 'companies', titleCase: 'Companies' },
};

// Only these values are valid for the two enum-constrained contact columns —
// if a CSV cell doesn't match, we drop the field so Postgres doesn't reject
// the row.
const LIFECYCLE_STAGES = new Set([
  'subscriber', 'lead', 'marketing_qualified_lead', 'sales_qualified_lead',
  'opportunity', 'customer', 'evangelist', 'other',
]);
const LEAD_STATUSES = new Set([
  'new', 'open', 'in_progress', 'open_deal', 'unqualified',
  'attempted_to_contact', 'connected', 'bad_timing',
]);

const SKIP = '__skip__';
const CUSTOM = '__custom__';

// Normalises a header (or user-typed override) into a clean JSONB key.
// Preserves alphanumerics + underscore, collapses everything else to '_',
// caps length, and lowercases.
const toCustomKey = (raw: string): string => {
  const s = raw.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return s.slice(0, 40) || 'field';
};

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
  if ((h.includes('org') || h.includes('businessname') || h.includes('companyname')) && has('name')) return 'name';
  if (h.includes('size') && has('company_size')) return 'company_size';
  if (h.includes('revenue') && has('annual_revenue')) return 'annual_revenue';
  if ((h === 'category' || h === 'segment' || h === 'bucket' || h === 'tier') && has('category')) return 'category';
  if ((h === 'lifecycle' || h.includes('lifecyclestage')) && has('lifecycle_stage')) return 'lifecycle_stage';
  if ((h === 'status' || h.includes('leadstatus')) && has('lead_status')) return 'lead_status';
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
  const totalSteps = resource === 'contacts' ? 4 : 3;
  const label = RESOURCE_LABEL[resource];
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const workspaceId = useWorkspaceForCreate();

  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  // For headers mapped to CUSTOM, the JSONB key the user wants to store under.
  // Seeded from the header name whenever CUSTOM is picked.
  const [customNames, setCustomNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Categories — only used when resource === 'contacts'.
  const [existingCategories, setExistingCategories] = useState<string[]>([]);
  const [categoryMode, setCategoryMode] = useState<'none' | 'pick' | 'new'>('none');
  const [categoryPick, setCategoryPick] = useState<string>('');
  const [categoryNew, setCategoryNew] = useState<string>('');

  const reset = () => {
    setStep(1);
    setFileName('');
    setRows([]);
    setHeaders([]);
    setMapping({});
    setCustomNames({});
    setCategoryMode('none');
    setCategoryPick('');
    setCategoryNew('');
  };

  // Load existing categories on open (contacts only)
  useEffect(() => {
    if (!open || resource !== 'contacts' || !orgId) return;
    listLeadCategories(orgId)
      .then((rows) => setExistingCategories(rows))
      .catch(() => setExistingCategories([]));
  }, [open, resource, orgId]);

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
  const customCount = Object.values(mapping).filter((v) => v === CUSTOM).length;

  // Is the `category` column mapped to any file column?
  const categoryMappedFromCsv = useMemo(
    () => resource === 'contacts' && Object.values(mapping).some((v) => v === 'category'),
    [mapping, resource],
  );

  // The final category the user chose in Step 3, resolved to a string or null.
  const resolvedCategory = useMemo<string | null>(() => {
    if (resource !== 'contacts') return null;
    if (categoryMappedFromCsv) return null; // per-row from CSV wins
    if (categoryMode === 'pick' && categoryPick.trim()) return categoryPick.trim();
    if (categoryMode === 'new' && categoryNew.trim()) return categoryNew.trim();
    return null;
  }, [resource, categoryMappedFromCsv, categoryMode, categoryPick, categoryNew]);

  const handleImport = async () => {
    if (!orgId) return;
    setBusy(true);
    try {
      const payload = rows.map((r) => {
        const o: Record<string, unknown> = {
          organization_id: orgId,
          workspace_id: workspaceId,
          owner_id: user?.userId ?? null,
        };
        const custom: Record<string, string> = {};
        for (const [header, key] of Object.entries(mapping)) {
          if (!key || key === SKIP) continue;
          const v = r[header]?.trim();
          if (!v) continue;
          if (key === CUSTOM) {
            const k = toCustomKey(customNames[header] ?? header);
            custom[k] = v;
            continue;
          }
          if (key === 'annual_revenue') {
            const n = Number(v.replace(/[^\d.-]/g, ''));
            if (Number.isFinite(n)) o[key] = n;
          } else if (key === 'lifecycle_stage') {
            const norm = v.toLowerCase().replace(/[\s-]+/g, '_');
            if (LIFECYCLE_STAGES.has(norm)) o[key] = norm;
          } else if (key === 'lead_status') {
            const norm = v.toLowerCase().replace(/[\s-]+/g, '_');
            if (LEAD_STATUSES.has(norm)) o[key] = norm;
          } else {
            o[key] = v;
          }
        }
        if (Object.keys(custom).length) o.custom_fields = custom;
        // If the user picked an org-wide category in step 3 and didn't map a
        // per-row category column, apply the picked value.
        if (resource === 'contacts' && !categoryMappedFromCsv && resolvedCategory) {
          o.category = resolvedCategory;
        }
        return o;
      }).filter((o) => fields.filter((f) => f.required).every((f) => o[f.key]));

      if (!payload.length) throw new Error('No valid rows after mapping');

      const { error } = await supabase.from(TABLE[resource]).insert(payload as never);
      if (error) throw error;

      toast.success(`Imported ${payload.length} ${label.plural}`);
      await onImported?.();
      onOpenChange(false);
      reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const stepDescription = (() => {
    if (step === 1) return 'upload a CSV file';
    if (step === 2) return 'match your columns to fields';
    if (step === 3 && resource === 'contacts') return 'assign a category';
    return 'review & import';
  })();

  const goNext = () => {
    if (step === 1 || step === 2) setStep((step + 1) as 1 | 2 | 3 | 4);
    else if (step === 3 && resource === 'contacts') setStep(4);
  };
  const goBack = () => {
    if (step === 1) onOpenChange(false);
    else setStep((step - 1) as 1 | 2 | 3 | 4);
  };
  const isFinalStep = (resource === 'contacts' && step === 4) || (resource === 'companies' && step === 3);

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import {label.titleCase}</DialogTitle>
          <DialogDescription>
            Step {step} of {totalSteps} — {stepDescription}
          </DialogDescription>
        </DialogHeader>

        {/* Progress */}
        <div className="flex items-center gap-2 pb-2">
          {Array.from({ length: totalSteps }, (_, i) => i + 1).map((n) => (
            <div key={n} className="flex flex-1 items-center gap-2">
              <div className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold',
                step === n ? 'bg-primary text-primary-foreground'
                : step > n ? 'bg-primary/20 text-primary'
                : 'bg-muted text-muted-foreground',
              )}>
                {step > n ? <CheckCircle2 className="h-4 w-4" /> : n}
              </div>
              {n < totalSteps && (
                <div className={cn('h-1 flex-1 rounded-full', step > n ? 'bg-primary' : 'bg-muted')} />
              )}
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
                  We'll auto-match your columns to {label.singular} fields in the next step.
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
              <p className="mt-2 text-[11px] text-muted-foreground">
                Anything else in your file (columns not in this list) can be saved as
                a <span className="font-medium">Custom field</span> during mapping.
                {resource === 'contacts' && ' Optional — if your CSV doesn’t have a category column, you’ll assign one in step 3.'}
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
              <div className="flex items-center gap-2">
                {customCount > 0 && (
                  <Badge variant="outline" className="text-xs">
                    {customCount} custom
                  </Badge>
                )}
                <Badge variant={requiredOk ? 'secondary' : 'destructive'}>{mappedCount} mapped</Badge>
              </div>
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
                        <Select
                          value={mapping[h] ?? SKIP}
                          onValueChange={(v) => {
                            setMapping({ ...mapping, [h]: v });
                            if (v === CUSTOM && !customNames[h]) {
                              setCustomNames({ ...customNames, [h]: toCustomKey(h) });
                            }
                          }}
                        >
                          <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={SKIP}>— Don't import —</SelectItem>
                            {fields.map((f) => (
                              <SelectItem key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</SelectItem>
                            ))}
                            <SelectItem value={CUSTOM}>+ Custom field…</SelectItem>
                          </SelectContent>
                        </Select>
                        {mapping[h] === CUSTOM && (
                          <div className="mt-1.5 flex items-center gap-2">
                            <span className="text-[11px] text-muted-foreground whitespace-nowrap">Save as</span>
                            <Input
                              value={customNames[h] ?? ''}
                              onChange={(e) => setCustomNames({ ...customNames, [h]: e.target.value })}
                              placeholder="e.g. company_size_v2"
                              maxLength={40}
                              className="h-7 text-xs w-44"
                            />
                          </div>
                        )}
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

        {step === 3 && resource === 'contacts' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/30 p-5">
              <div className="flex items-center gap-2 mb-2">
                <TagIcon className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">Assign a category to these leads</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Tag every imported lead with the same category so you can filter them later
                (e.g. <em>VIP</em>, <em>Q4 outreach</em>, <em>Warm intro</em>). Optional —
                you can skip this and leave them uncategorised.
              </p>
            </div>

            {categoryMappedFromCsv ? (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
                <p className="font-medium text-foreground">Using your CSV's category column</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  You mapped a Category column in Step 2, so each row will keep its own value.
                  This step is skipped.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 cursor-pointer hover:border-primary/40">
                  <input
                    type="radio"
                    checked={categoryMode === 'none'}
                    onChange={() => setCategoryMode('none')}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Skip — leave them uncategorised</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      You can categorise leads one by one later.
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 cursor-pointer hover:border-primary/40">
                  <input
                    type="radio"
                    checked={categoryMode === 'pick'}
                    onChange={() => setCategoryMode('pick')}
                    className="mt-0.5"
                    disabled={existingCategories.length === 0}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      Pick an existing category
                      {existingCategories.length === 0 && (
                        <span className="text-xs text-muted-foreground font-normal ml-2">(none yet)</span>
                      )}
                    </p>
                    {categoryMode === 'pick' && existingCategories.length > 0 && (
                      <Select value={categoryPick} onValueChange={setCategoryPick}>
                        <SelectTrigger className="mt-2 h-9"><SelectValue placeholder="Choose category" /></SelectTrigger>
                        <SelectContent>
                          {existingCategories.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </label>

                <label className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 cursor-pointer hover:border-primary/40">
                  <input
                    type="radio"
                    checked={categoryMode === 'new'}
                    onChange={() => setCategoryMode('new')}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Create a new category</p>
                    {categoryMode === 'new' && (
                      <div className="mt-2 space-y-1.5">
                        <Label className="text-xs">Name</Label>
                        <Input
                          value={categoryNew}
                          onChange={(e) => setCategoryNew(e.target.value)}
                          placeholder="e.g. VIP customers"
                          maxLength={64}
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Free text. Anything you type becomes a reusable category next time.
                        </p>
                      </div>
                    )}
                  </div>
                </label>
              </div>
            )}
          </div>
        )}

        {isFinalStep && (
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-muted/40 p-5">
              <p className="text-sm font-semibold">Ready to import</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {rows.length} rows from <span className="font-medium">{fileName}</span> will be added to {label.plural}.
              </p>
              {resource === 'contacts' && (
                <div className="mt-2">
                  <span className="text-xs text-muted-foreground">Category:</span>
                  <span className="ml-1 text-xs font-medium">
                    {categoryMappedFromCsv
                      ? 'from CSV column (per row)'
                      : resolvedCategory
                      ? `all rows → ${resolvedCategory}`
                      : 'none'}
                  </span>
                </div>
              )}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {Object.entries(mapping).filter(([, v]) => v && v !== SKIP).map(([h, v]) => {
                  const target = v === CUSTOM
                    ? `custom · ${toCustomKey(customNames[h] ?? h)}`
                    : fields.find((f) => f.key === v)?.label ?? v;
                  return (
                    <Badge key={h} variant={v === CUSTOM ? 'outline' : 'secondary'} className="font-normal">
                      {h} → {target}
                    </Badge>
                  );
                })}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Duplicates are not checked. Records will be created with you as the owner
              (so they'll show up under &quot;My {label.plural}&quot;).
            </p>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-3">
          <Button variant="ghost" size="sm" onClick={goBack} disabled={busy}>
            <ArrowLeft className="mr-1 h-4 w-4" />{step === 1 ? 'Cancel' : 'Back'}
          </Button>
          {!isFinalStep ? (
            <Button
              size="sm"
              disabled={step === 2 && !requiredOk}
              onClick={goNext}
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
