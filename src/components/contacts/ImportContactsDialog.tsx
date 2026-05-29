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
import { parseLeadCsv } from '@/services/supabase/leads';   // CSV parser is generic enough to reuse
import type { Client } from '@/services/supabase/clients';
import {
  ContactWithAccount, CreateContactWithAccountInput,
} from '@/services/supabase/contacts';
import { toast } from 'sonner';

type Phase = 'pick' | 'preview' | 'importing' | 'imported';

interface ImportError { row: number; message: string }
interface ImportResult {
  imported: ContactWithAccount[];
  errors: ImportError[];
  unknownHeaders: string[];
  missingRequired: string[];
  duplicateHeaders: Array<{ canonical: string; sources: string[] }>;
  unmatchedAccounts: Array<{ row: number; name: string }>;
  aborted: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | null;
  accounts: Client[];               // workspace-scoped accounts (the only ones we can attach contacts to)
  workspaceName: string | null;
  createContact: (input: CreateContactWithAccountInput) => Promise<ContactWithAccount>;
  onComplete: (result: ImportResult) => void;
}

const REQUIRED_HEADERS = ['last_name', 'account'] as const;

const KNOWN_HEADERS = new Set<string>([
  'salutation', 'first_name', 'last_name', 'full_name',
  'title', 'department',
  'email', 'secondary_email',
  'phone', 'mobile', 'home_phone', 'other_phone', 'asst_phone', 'fax',
  'skype_id', 'twitter', 'linkedin_url',
  'mailing_street', 'mailing_city', 'mailing_state', 'mailing_zip', 'mailing_country',
  'other_street', 'other_city', 'other_state', 'other_zip', 'other_country',
  'assistant', 'reporting_to_name',
  'lead_source', 'date_of_birth',
  'description', 'tags',
  'account', 'company',
]);

const IDENTICAL_FAILURE_THRESHOLD = 5;

const downloadFile = (filename: string, content: string, mime: string) => {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
};

const TEMPLATE = `salutation,first_name,last_name,title,department,account,email,phone,mobile,lead_source,description,tags
Mr.,Sam,Smith,Owner,Operations,Sam's Cafe,sam@samscafe.com,+15551112222,+15553334444,Web Research,Long-term partner,vip\n`;

export const ImportContactsDialog: React.FC<Props> = ({
  open, onOpenChange, organizationId, accounts, workspaceName,
  createContact, onComplete,
}) => {
  const [phase, setPhase] = useState<Phase>('pick');
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<Array<Record<string, string>>>([]);
  const [duplicateHeaders, setDuplicateHeaders] = useState<ImportResult['duplicateHeaders']>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const accountByLowerName = useMemo(() => {
    const m = new Map<string, Client>();
    for (const a of accounts) m.set(a.name.toLowerCase(), a);
    return m;
  }, [accounts]);

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
      if (!next) toast.info('Import in progress — please wait.');
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
        setParseErrors(['The file looks empty. Add a header row and at least one contact.']);
        return;
      }
      setParsed(rows);
      setDuplicateHeaders(dupes);
      setPhase('preview');
    } catch (err) {
      setParseErrors([err instanceof Error ? err.message : "Couldn't read the file."]);
    }
  };

  const headers = useMemo(() => (parsed.length > 0 ? Object.keys(parsed[0]) : null), [parsed]);

  const precheck = useMemo(() => {
    if (!headers) return null;
    const seen = new Set(headers);
    const unknownHeaders = headers.filter(
      (h) => !KNOWN_HEADERS.has(h) && h !== 'full_name',
    );
    const missingRequired = REQUIRED_HEADERS.filter((h) => {
      if (h === 'account') return !(seen.has('account') || seen.has('company'));
      if (h === 'last_name') return !(seen.has('last_name') || seen.has('full_name'));
      return !seen.has(h);
    });
    return { unknownHeaders, missingRequired: [...missingRequired] };
  }, [headers]);

  const buildInput = (
    row: Record<string, string>,
  ): { ok: true; input: CreateContactWithAccountInput; matchedAccountName: string }
    | { ok: false; reason: string; accountName?: string } => {
    let firstName = row.first_name?.trim() ?? '';
    let lastName = row.last_name?.trim() ?? '';
    if (!lastName && row.full_name?.trim()) {
      const parts = row.full_name.trim().split(/\s+/);
      if (parts.length === 1) lastName = parts[0];
      else {
        firstName = firstName || parts.slice(0, -1).join(' ');
        lastName = parts[parts.length - 1];
      }
    }
    if (!lastName) return { ok: false, reason: 'Missing last name (or full name).' };

    const accountName = (row.account?.trim() || row.company?.trim() || '');
    if (!accountName) {
      return { ok: false, reason: 'Missing Account — add an Account or Company column.' };
    }
    const match = accountByLowerName.get(accountName.toLowerCase());
    if (!match) {
      return {
        ok: false,
        reason: `No matching account found for "${accountName}". Create it first or check the spelling.`,
        accountName,
      };
    }

    const input: CreateContactWithAccountInput = {
      clientId: match.clientId,
      salutation: row.salutation || null,
      firstName: firstName || null,
      lastName,
      title: row.title || null,
      department: row.department || null,
      email: row.email || null,
      secondaryEmail: row.secondary_email || null,
      phone: row.phone || null,
      mobile: row.mobile || null,
      homePhone: row.home_phone || null,
      otherPhone: row.other_phone || null,
      asstPhone: row.asst_phone || null,
      fax: row.fax || null,
      skypeId: row.skype_id || null,
      twitter: row.twitter || null,
      linkedinUrl: row.linkedin_url || null,
      mailingStreet: row.mailing_street || null,
      mailingCity: row.mailing_city || null,
      mailingState: row.mailing_state || null,
      mailingZip: row.mailing_zip || null,
      mailingCountry: row.mailing_country || null,
      otherStreet: row.other_street || null,
      otherCity: row.other_city || null,
      otherState: row.other_state || null,
      otherZip: row.other_zip || null,
      otherCountry: row.other_country || null,
      assistant: row.assistant || null,
      leadSource: row.lead_source || null,
      dateOfBirth: row.date_of_birth ? new Date(row.date_of_birth) : null,
      description: row.description || null,
      tags: (row.tags || '').split(/[,;|]/).map((t) => t.trim()).filter(Boolean),
    };
    return { ok: true, input, matchedAccountName: match.name };
  };

  const handleImport = async () => {
    if (!organizationId || parsed.length === 0) return;
    setPhase('importing');

    const errors: ImportError[] = [];
    const imported: ContactWithAccount[] = [];
    const unmatched: ImportResult['unmatchedAccounts'] = [];
    let aborted = false;
    let lastError: string | null = null;
    let consecutive = 0;

    for (let i = 0; i < parsed.length; i++) {
      const rowNum = i + 2;
      const built = buildInput(parsed[i]);
      if (!built.ok) {
        errors.push({ row: rowNum, message: built.reason });
        if (built.accountName) {
          unmatched.push({ row: rowNum, name: built.accountName });
        }
        if (built.reason === lastError) consecutive += 1;
        else { lastError = built.reason; consecutive = 1; }
        if (consecutive >= IDENTICAL_FAILURE_THRESHOLD) {
          errors.push({
            row: rowNum + 1,
            message: `Aborted after ${consecutive} identical "${lastError}" errors — fix the source and re-import.`,
          });
          aborted = true;
          break;
        }
        continue;
      }
      try {
        const created = await createContact(built.input);
        imported.push(created);
        consecutive = 0;
        lastError = null;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        errors.push({ row: rowNum, message });
        if (message === lastError) consecutive += 1;
        else { lastError = message; consecutive = 1; }
        if (consecutive >= IDENTICAL_FAILURE_THRESHOLD) {
          errors.push({
            row: rowNum + 1,
            message: `Aborted after ${consecutive} identical "${message}" errors — likely permission / workspace.`,
          });
          aborted = true;
          break;
        }
      }
    }

    const res: ImportResult = {
      imported,
      errors,
      unknownHeaders: precheck?.unknownHeaders ?? [],
      missingRequired: precheck?.missingRequired ?? [],
      duplicateHeaders,
      unmatchedAccounts: unmatched,
      aborted,
    };
    setResult(res);
    setPhase('imported');
    onComplete(res);
  };

  const sampleRows = parsed.slice(0, 3);
  const hasWorkspace = !!workspaceName;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 break-words">
            <Upload className="w-5 h-5 text-primary shrink-0" />
            <span className="min-w-0">Import Contacts from CSV</span>
          </DialogTitle>
          <DialogDescription className="break-words">
            Upload a spreadsheet of contacts and match them to existing
            accounts by account name. Need an account first? Import accounts
            from the Accounts tab before bringing in contacts.
          </DialogDescription>
          <p className="text-xs text-muted-foreground mt-1 break-words">
            Contacts will attach to accounts in workspace{' '}
            <strong className="text-foreground">{workspaceName ?? 'Default'}</strong>.
          </p>
        </DialogHeader>

        <div className="space-y-4">
          {phase === 'pick' && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files?.[0];
                  if (f) handleFile(f);
                }}
                onDragOver={(e) => e.preventDefault()}
                className="w-full rounded-md border-2 border-dashed border-border hover:border-primary/50 hover:bg-muted/20 p-8 text-center transition-colors"
              >
                <FileSpreadsheet className="w-8 h-8 mx-auto text-muted-foreground" />
                <p className="text-sm font-medium mt-2">Drop a CSV here or click to pick one</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Required: <strong>last_name</strong> and <strong>account</strong>{' '}
                  (or company). Anything else (title, email, phone, lead_source,
                  addresses…) is optional.
                </p>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) handleFile(f);
                }}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => downloadFile('taskcalendar-contacts-template.csv', TEMPLATE, 'text/csv')}
                className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
              >
                <Download className="w-3 h-3" /> Download template CSV
              </button>
              {parseErrors.length > 0 && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs">
                  {parseErrors.map((e, i) => <p key={i} className="text-destructive">{e}</p>)}
                </div>
              )}
            </div>
          )}

          {phase === 'preview' && headers && (
            <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
              <div className="rounded-md border p-3 bg-muted/30">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate" title={file?.name ?? undefined}>
                      {file?.name ?? 'Uploaded file'}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {parsed.length} row{parsed.length === 1 ? '' : 's'} · {headers.length} column{headers.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={reset} className="shrink-0">
                    <X className="w-3.5 h-3.5 mr-1" /> Different file
                  </Button>
                </div>
              </div>

              {precheck?.missingRequired.length! > 0 && (
                <DiagBlock tone="destructive" title="Missing required columns">
                  <span className="break-words">
                    We couldn't find:{' '}
                    <code className="font-mono break-all">{precheck!.missingRequired.join(', ')}</code>.
                  </span>
                </DiagBlock>
              )}
              {precheck?.unknownHeaders.length! > 0 && (
                <DiagBlock tone="amber" title="Columns we'll ignore">
                  <span className="break-words">
                    <code className="font-mono break-all">{precheck!.unknownHeaders.join(', ')}</code>
                    {' '}— the rows still import, just without those values.
                  </span>
                </DiagBlock>
              )}
              {duplicateHeaders.length > 0 && (
                <DiagBlock tone="amber" title="Duplicate columns — only the rightmost wins">
                  <ul className="space-y-0.5">
                    {duplicateHeaders.map((d) => (
                      <li key={d.canonical} className="break-words">
                        <code className="font-mono break-all">{d.sources.join(', ')}</code>
                        {' → '}
                        <code className="font-mono break-all">{d.canonical}</code>
                      </li>
                    ))}
                  </ul>
                </DiagBlock>
              )}
              {!hasWorkspace && (
                <DiagBlock tone="destructive" title="Pick a workspace first">
                  You're on "All workspaces". Switch the sidebar to a specific workspace so we know where to attach the contacts.
                </DiagBlock>
              )}
              {accounts.length === 0 && (
                <DiagBlock tone="destructive" title="No accounts available">
                  This workspace has no accounts yet. Create or import accounts from the Accounts tab before importing contacts.
                </DiagBlock>
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

              <div className="flex items-center justify-end gap-2">
                <Button
                  onClick={handleImport}
                  disabled={
                    (precheck?.missingRequired.length ?? 0) > 0
                    || !hasWorkspace
                    || accounts.length === 0
                  }
                >
                  <Upload className="w-4 h-4 mr-2" /> Import {parsed.length} contact{parsed.length === 1 ? '' : 's'}
                </Button>
              </div>
            </div>
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
            <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
              <div className="rounded-md border bg-card p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  <p className="text-sm font-semibold">
                    Imported {result.imported.length} of {result.imported.length + result.errors.length} contact{result.imported.length + result.errors.length === 1 ? '' : 's'}
                  </p>
                </div>
              </div>

              {result.unmatchedAccounts.length > 0 && (
                <DiagBlock tone="amber" title={`Account name not found (${result.unmatchedAccounts.length})`}>
                  These rows referenced accounts we couldn't match in this workspace. Create them in the Accounts tab and re-import.
                  <ul className="mt-1 space-y-0.5 max-h-24 overflow-y-auto">
                    {Array.from(new Set(result.unmatchedAccounts.map((u) => u.name))).slice(0, 50).map((name) => (
                      <li key={name}><code className="font-mono">{name}</code></li>
                    ))}
                  </ul>
                </DiagBlock>
              )}

              {result.errors.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                    Skipped rows
                  </p>
                  <div className="rounded-md border max-h-44 overflow-y-auto divide-y">
                    {result.errors.slice(0, 50).map((e, i) => (
                      <div key={i} className="p-2 text-[11px] flex items-start gap-2">
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

              {result.aborted && (
                <DiagBlock tone="destructive" title="Import was aborted early">
                  Multiple consecutive rows failed with the same error. Fix
                  the underlying problem and re-import the remaining rows.
                </DiagBlock>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {(phase === 'pick' || phase === 'preview') && (
            <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
          )}
          {phase === 'imported' && (
            <Button onClick={() => handleClose(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const DiagBlock: React.FC<{
  tone: 'destructive' | 'amber';
  title: string;
  children: React.ReactNode;
}> = ({ tone, title, children }) => (
  <div className={
    'rounded-md border p-2 text-xs ' +
    (tone === 'destructive'
      ? 'border-destructive/30 bg-destructive/10'
      : 'border-amber-500/30 bg-amber-500/10')
  }>
    <p className={
      'font-semibold inline-flex items-center gap-1 ' +
      (tone === 'destructive'
        ? 'text-destructive'
        : 'text-amber-700 dark:text-amber-300')
    }>
      <AlertTriangle className="w-3.5 h-3.5" /> {title}
    </p>
    <div className={
      'mt-1 ' +
      (tone === 'destructive' ? '' : 'text-amber-700/80 dark:text-amber-300/80')
    }>
      {children}
    </div>
  </div>
);
