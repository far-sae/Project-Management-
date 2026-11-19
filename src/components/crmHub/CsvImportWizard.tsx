import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useCrmCompanies, useWorkspaceForCreate } from '@/hooks/useCrmHub';
import { supabase } from '@/services/supabase/config';
import { parseCSV } from '@/lib/csv';
import {
  CUSTOM, SKIP, autoMapColumns, buildCompanyImport, buildLeadImport, companyKey, importOwners, toCustomKey,
  type ImportField, type ImportOwnerMode,
} from '@/lib/crmImport';
import { listLeadCategories } from '@/services/supabase/crmHub/contacts';
import { ensureCompaniesByName } from '@/services/supabase/crmHub/companies';
import {
  ArrowLeft, ArrowRight, CheckCircle2, FileSpreadsheet, Upload, Loader2,
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

export type FieldDef = ImportField;
export type ImportResource = 'contacts' | 'companies';

const FIELDS: Record<ImportResource, FieldDef[]> = {
  contacts: [
    { key: 'full_name', label: 'Full name' },
    { key: 'first_name', label: 'First name' },
    { key: 'last_name', label: 'Last name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'job_title', label: 'Job title' },
    { key: 'company', label: 'Company' },
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

/** A lead needs something to be called by: one of these has to be matched. */
const LEAD_NAME_SOURCES = ['full_name', 'first_name', 'last_name', 'email', 'company'];

const TABLE: Record<ImportResource, string> = {
  contacts: 'crm_contacts',
  companies: 'crm_companies',
};

// People are called leads everywhere in the CRM (the table is still crm_contacts).
const RESOURCE_LABEL: Record<ImportResource, { singular: string; plural: string }> = {
  contacts: { singular: 'lead', plural: 'leads' },
  companies: { singular: 'company', plural: 'companies' },
};

/** Rows sent to the database per request. */
const BATCH = 500;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resource: ImportResource;
  onImported?: () => void | Promise<void>;
}

export const CsvImportWizard: React.FC<Props> = ({ open, onOpenChange, resource, onImported }) => {
  const fields = FIELDS[resource];
  const isLeads = resource === 'contacts';
  const totalSteps = isLeads ? 4 : 3;
  const label = RESOURCE_LABEL[resource];
  const { user } = useAuth();
  const { organization } = useOrganization();
  const orgId = organization?.organizationId ?? null;
  const workspaceId = useWorkspaceForCreate();
  const { items: companies } = useCrmCompanies();

  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  // For headers mapped to CUSTOM, the name the value is stored under.
  const [customNames, setCustomNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Choices for the whole file (leads only).
  const [existingCategories, setExistingCategories] = useState<string[]>([]);
  const [categoryAll, setCategoryAll] = useState('');
  const [companyAll, setCompanyAll] = useState('');
  const [ownerMode, setOwnerMode] = useState<ImportOwnerMode>('me');

  const reset = () => {
    setStep(1);
    setFileName('');
    setRows([]);
    setHeaders([]);
    setMapping({});
    setCustomNames({});
    setCategoryAll('');
    setCompanyAll('');
    setOwnerMode('me');
  };

  useEffect(() => {
    if (!open || !isLeads || !orgId) return;
    listLeadCategories(orgId)
      .then((found) => setExistingCategories(found))
      .catch(() => setExistingCategories([]));
  }, [open, isLeads, orgId]);

  /** People who can be given leads. */
  const team = useMemo(
    () => (organization?.members ?? []).filter((m) => m.status === 'active' && m.role !== 'viewer'),
    [organization],
  );

  const handleFile = async (file: File) => {
    if (/\.(xlsx?|numbers|ods)$/i.test(file.name)) {
      toast.error('Save the sheet as CSV first (File → Save as → CSV), then choose that file.');
      return;
    }
    try {
      const parsed = parseCSV(await file.text());
      if (!parsed.length) { toast.error('This file has no rows'); return; }
      const hs = Object.keys(parsed[0]!);
      setRows(parsed);
      setHeaders(hs);
      setFileName(file.name);
      setMapping(autoMapColumns(hs, fields));
      setStep(2);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read the file');
    }
  };

  const used = useMemo(() => new Set(Object.values(mapping)), [mapping]);
  const requiredOk = isLeads
    ? LEAD_NAME_SOURCES.some((key) => used.has(key))
    : fields.filter((f) => f.required).every((f) => used.has(f.key));

  const mappedCount = Object.values(mapping).filter((v) => v && v !== SKIP).length;
  const customCount = Object.values(mapping).filter((v) => v === CUSTOM).length;
  const categoryFromFile = isLeads && used.has('category');
  const companyFromFile = isLeads && used.has('company');

  /** A field belongs to one column: choosing it again moves it. */
  const mapColumn = (header: string, value: string) => {
    const next = { ...mapping };
    if (value !== SKIP && value !== CUSTOM) {
      for (const other of Object.keys(next)) if (next[other] === value) next[other] = SKIP;
    }
    next[header] = value;
    setMapping(next);
    if (value === CUSTOM && !customNames[header]) {
      setCustomNames({ ...customNames, [header]: toCustomKey(header) });
    }
  };

  const leadImport = useMemo(() => {
    if (!isLeads || !orgId) return null;
    return buildLeadImport(rows, mapping, customNames, {
      organizationId: orgId,
      workspaceId,
      category: categoryAll,
      company: companyAll,
      owners: importOwners(ownerMode, user?.userId ?? null, team.map((m) => m.userId)),
    });
  }, [isLeads, orgId, rows, mapping, customNames, workspaceId, categoryAll, companyAll, ownerMode, user, team]);

  const companyImport = useMemo(() => {
    if (isLeads || !orgId) return null;
    return buildCompanyImport(rows, mapping, customNames, {
      organizationId: orgId, workspaceId, ownerId: user?.userId ?? null,
    });
  }, [isLeads, orgId, rows, mapping, customNames, workspaceId, user]);

  const readyCount = leadImport?.leads.length ?? companyImport?.records.length ?? 0;
  const skippedCount = leadImport?.skipped ?? companyImport?.skipped ?? 0;

  /** How many leads get a company, and how many of those companies are new. */
  const companyLinks = useMemo(() => {
    const known = new Set(companies.map((c) => companyKey(c.name)));
    const wanted = new Set<string>();
    let linked = 0;
    for (const lead of leadImport?.leads ?? []) {
      if (!lead.companyName) continue;
      linked += 1;
      wanted.add(companyKey(lead.companyName));
    }
    return { linked, total: wanted.size, created: [...wanted].filter((k) => !known.has(k)).length };
  }, [leadImport, companies]);

  const ownerSummary = (() => {
    if (ownerMode === 'me') return 'you';
    if (ownerMode === 'none') return 'nobody yet';
    if (ownerMode === 'team') return `shared in turn between ${plural(team.length, 'person', 'people')}`;
    return team.find((m) => m.userId === ownerMode)?.displayName ?? 'one person';
  })();

  const insertInBatches = async (records: Array<Record<string, unknown>>) => {
    for (let i = 0; i < records.length; i += BATCH) {
      const { error } = await supabase.from(TABLE[resource]).insert(records.slice(i, i + BATCH) as never);
      if (error) throw error;
    }
  };

  const handleImport = async () => {
    if (!orgId) return;
    setBusy(true);
    try {
      if (leadImport) {
        const { leads } = leadImport;
        if (!leads.length) throw new Error('No rows have a name, email or company to call the lead by');
        const names = leads.flatMap((l) => (l.companyName ? [l.companyName] : []));
        const ids = names.length
          ? await ensureCompaniesByName(orgId, workspaceId, names, user?.userId ?? null)
          : new Map<string, string>();
        await insertInBatches(leads.map((l) => ({
          ...l.record,
          company_id: l.companyName ? ids.get(companyKey(l.companyName)) ?? null : null,
        })));
        toast.success(
          companyLinks.linked
            ? `Imported ${plural(leads.length, 'lead', 'leads')}, linked to ${plural(companyLinks.total, 'company', 'companies')}`
            : `Imported ${plural(leads.length, 'lead', 'leads')}`,
        );
      } else if (companyImport) {
        if (!companyImport.records.length) throw new Error('No rows have a company name');
        await insertInBatches(companyImport.records);
        toast.success(`Imported ${plural(companyImport.records.length, 'company', 'companies')}`);
      }
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
    if (step === 1) return 'choose a file';
    if (step === 2) return 'check the columns';
    if (step === 3 && isLeads) return 'company, owner and category';
    return 'review and import';
  })();

  const isFinalStep = step === totalSteps;
  const goNext = () => { if (!isFinalStep) setStep((step + 1) as 1 | 2 | 3 | 4); };
  const goBack = () => {
    if (step === 1) onOpenChange(false);
    else setStep((step - 1) as 1 | 2 | 3 | 4);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import {label.plural}</DialogTitle>
          <DialogDescription>
            Step {step} of {totalSteps}: {stepDescription}
          </DialogDescription>
        </DialogHeader>

        {/* Progress */}
        <div className="flex items-center gap-2" aria-hidden>
          {Array.from({ length: totalSteps }, (_, i) => i + 1).map((n) => (
            <div key={n} className={cn('flex items-center gap-2', n < totalSteps && 'flex-1')}>
              <div className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums',
                step === n ? 'border-foreground bg-foreground text-background'
                : step > n ? 'border-border bg-secondary text-foreground'
                : 'border-border text-muted-foreground',
              )}>
                {step > n ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}
              </div>
              {n < totalSteps && (
                <div className={cn('h-1 flex-1 rounded-full', step > n ? 'bg-foreground/70' : 'bg-foreground/10')} />
              )}
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-input bg-surface-2 px-4 py-10 text-center transition-colors hover:bg-secondary"
            >
              <Upload className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">Choose a CSV file</p>
              <p className="text-xs text-muted-foreground">
                The columns can be in any order and have any headings. They are matched to {label.singular} fields for you.
              </p>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.currentTarget.value = ''; }}
            />
            <div className="rounded-lg border border-border p-4 text-sm">
              <p className="font-medium">What a file can hold</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {isLeads
                  ? 'Name (one column, or first and last apart), Email, Phone, Job title, Company, Source, Category.'
                  : fields.map((f) => f.label + (f.required ? ' *' : '')).join(', ')}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {isLeads && 'Each lead is linked to the company in its row; a company that is not in the CRM yet is added. '}
                Any other column can be kept as a custom field.
              </p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate font-medium">{fileName}</span>
                <Badge variant="secondary" className="shrink-0 tabular-nums">{rows.length} rows</Badge>
              </div>
              <div className="flex items-center gap-2">
                {customCount > 0 && (
                  <Badge variant="outline" className="tabular-nums">
                    {customCount} custom
                  </Badge>
                )}
                <Badge variant={requiredOk ? 'secondary' : 'destructive'} className="tabular-nums">
                  {mappedCount} of {headers.length} matched
                </Badge>
              </div>
            </div>
            <div className="max-h-[50vh] overflow-auto rounded-lg border border-border">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead>
                  <tr className="h-10 border-b border-border bg-surface-2 text-xs text-muted-foreground">
                    <th scope="col" className="px-3 font-medium">Column in your file</th>
                    <th scope="col" className="px-3 font-medium">Example</th>
                    <th scope="col" className="px-3 font-medium">Goes into</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((h) => (
                    <tr key={h} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                      <td className="px-3 py-2 font-medium">{h}</td>
                      <td className="max-w-[14rem] truncate px-3 py-2 text-muted-foreground">
                        {rows.find((r) => r[h]?.trim())?.[h] || '—'}
                      </td>
                      <td className="px-3 py-2">
                        <Select value={mapping[h] ?? SKIP} onValueChange={(v) => mapColumn(h, v)}>
                          <SelectTrigger className="w-64" aria-label={`Field for column ${h}`}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={SKIP}>Don't import</SelectItem>
                            {fields.map((f) => (
                              <SelectItem key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</SelectItem>
                            ))}
                            <SelectItem value={CUSTOM}>Keep as a custom field</SelectItem>
                          </SelectContent>
                        </Select>
                        {mapping[h] === CUSTOM && (
                          <div className="mt-1.5 flex items-center gap-2">
                            <span className="whitespace-nowrap text-xs text-muted-foreground">Save as</span>
                            <Input
                              value={customNames[h] ?? ''}
                              onChange={(e) => setCustomNames({ ...customNames, [h]: e.target.value })}
                              placeholder="team_size"
                              maxLength={40}
                              className="w-44"
                              aria-label={`Custom field name for column ${h}`}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {isLeads && used.has('full_name') && (
              <p className="text-xs text-muted-foreground">
                A full name is split for you: “Elena Rossi” and “Rossi, Elena” both become first name Elena, last name Rossi.
              </p>
            )}
            {!requiredOk && (
              <p className="text-xs text-destructive">
                {isLeads
                  ? 'Match a column to Full name, First name, Email or Company to continue.'
                  : `Match a column to ${fields.filter((f) => f.required).map((f) => f.label).join(', ')} to continue.`}
              </p>
            )}
          </div>
        )}

        {step === 3 && isLeads && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-company">Company</Label>
              <Input
                id="import-company"
                list="import-companies"
                value={companyAll}
                onChange={(e) => setCompanyAll(e.target.value)}
                placeholder={companyFromFile ? 'Company for rows that have none (optional)' : 'One company for all these leads (optional)'}
                maxLength={120}
              />
              <datalist id="import-companies">
                {companies.map((c) => <option key={c.id} value={c.name} />)}
              </datalist>
              <p className="text-xs text-muted-foreground">
                {companyFromFile
                  ? 'Each lead is linked to the company in its row. A company that is not in the CRM yet is added.'
                  : 'Your file has no company column. Type a company to link every lead to it, or leave this empty.'}
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Owner</Label>
              <Select value={ownerMode} onValueChange={(v) => setOwnerMode(v as ImportOwnerMode)}>
                <SelectTrigger aria-label="Owner of the imported leads"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="me">Me</SelectItem>
                  {team.length > 1 && <SelectItem value="team">Share between the team, in turn</SelectItem>}
                  <SelectItem value="none">Nobody yet</SelectItem>
                  {team.filter((m) => m.userId !== user?.userId).map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>{m.displayName || m.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Every lead shows under All leads. A lead also shows under its owner&apos;s My leads.
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="import-category">Category</Label>
              <Input
                id="import-category"
                list="import-categories"
                value={categoryAll}
                onChange={(e) => setCategoryAll(e.target.value)}
                placeholder={categoryFromFile ? 'Category for rows that have none (optional)' : 'One category for all these leads (optional)'}
                maxLength={64}
              />
              <datalist id="import-categories">
                {existingCategories.map((c) => <option key={c} value={c} />)}
              </datalist>
              <p className="text-xs text-muted-foreground">
                A label to filter by later, such as Trade show or Warm intro.
              </p>
            </div>
          </div>
        )}

        {isFinalStep && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-surface-2 p-4">
              <p className="text-sm font-semibold">
                {plural(readyCount, label.singular, label.plural)} will be added
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                From <span className="font-medium text-foreground">{fileName}</span>.
                {skippedCount > 0 && (
                  <> {plural(skippedCount, 'row is', 'rows are')} left out: {isLeads ? 'no name, email or company' : 'no company name'}.</>
                )}
              </p>
              {isLeads && (
                <dl className="mt-3 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
                  <dt className="text-muted-foreground">Company</dt>
                  <dd>
                    {companyLinks.linked === 0
                      ? 'Not linked to a company'
                      : `${plural(companyLinks.linked, 'lead', 'leads')} linked to ${plural(companyLinks.total, 'company', 'companies')}`}
                    {companyLinks.created > 0 && (
                      <span className="text-muted-foreground">
                        {' · '}{plural(companyLinks.created, 'new company', 'new companies')} will be created
                      </span>
                    )}
                  </dd>
                  <dt className="text-muted-foreground">Owner</dt>
                  <dd className="first-letter:uppercase">{ownerSummary}</dd>
                  <dt className="text-muted-foreground">Category</dt>
                  <dd>
                    {categoryFromFile
                      ? `From your file${categoryAll.trim() ? `, otherwise ${categoryAll.trim()}` : ''}`
                      : categoryAll.trim() || 'None'}
                  </dd>
                </dl>
              )}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {Object.entries(mapping).filter(([, v]) => v && v !== SKIP).map(([h, v]) => {
                  const target = v === CUSTOM
                    ? `custom: ${toCustomKey(customNames[h] ?? h)}`
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
              Duplicates are not checked: a {label.singular} that is already in the CRM is added again.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <Button variant="ghost" onClick={goBack} disabled={busy}>
            <ArrowLeft aria-hidden />
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>
          {!isFinalStep ? (
            <Button disabled={step === 1 || (step === 2 && !requiredOk)} onClick={goNext}>
              Next
              <ArrowRight aria-hidden />
            </Button>
          ) : (
            <Button disabled={busy || readyCount === 0} onClick={handleImport}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Import {plural(readyCount, label.singular, label.plural)}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CsvImportWizard;
