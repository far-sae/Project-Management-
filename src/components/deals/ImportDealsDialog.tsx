import React, { useMemo, useRef, useState } from 'react';
import {
  Upload, Loader2, AlertTriangle, X, Download,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { parseLeadCsv } from '@/services/supabase/leads';
import type { Client } from '@/services/supabase/clients';
import {
  CreateDealInput, DealStage,
} from '@/services/supabase/deals';
import { toast } from 'sonner';

type Phase = 'pick' | 'preview' | 'importing' | 'imported';

interface ImportResult {
  imported: number;
  errors: Array<{ row: number; message: string }>;
  unknownHeaders: string[];
  missingRequired: string[];
  duplicateHeaders: Array<{ canonical: string; sources: string[] }>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | null;
  /** Workspace-scoped accounts the importer can attach deals to. The CSV
   *  must reference one of these by name in the "account" column. */
  accounts: Client[];
  workspaceName: string | null;
  create: (input: CreateDealInput) => Promise<unknown>;
  onComplete: (res: ImportResult) => void;
}

const REQUIRED_HEADERS = ['deal_name'] as const;

const KNOWN_HEADERS = new Set<string>([
  'deal_name', 'title', 'name',
  'amount', 'value',
  'currency',
  'closing_date', 'close_date', 'expected_close_date',
  'stage',
  'probability',
  'account', 'account_name', 'company', 'client_name',
  'type', 'deal_type',
  'next_step',
  'lead_source',
  'campaign_source',
  'description',
  'owner', 'owner_name', 'deal_owner',
  'tags',
]);

const TEMPLATE = `deal_name,amount,currency,closing_date,stage,account,type,next_step,lead_source,description
Website Design (Standard),10000,USD,2026-09-24,Proposal,Acme Corp,New Business,Closing meeting,Web Research,Initial discovery done\n`;

const STAGE_ALIASES: Record<string, DealStage> = {
  lead: 'lead', qualification: 'qualified', qualified: 'qualified',
  proposal: 'proposal', 'proposal/price quote': 'proposal',
  negotiation: 'negotiation', 'negotiation/review': 'negotiation',
  won: 'won', 'closed won': 'won',
  lost: 'lost', 'closed lost': 'lost',
};

const downloadFile = (filename: string, content: string, mime: string) => {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
};

const parseStage = (raw: string | undefined): DealStage => {
  if (!raw) return 'lead';
  const v = raw.trim().toLowerCase();
  return STAGE_ALIASES[v] ?? 'lead';
};

const parseNumber = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const cleaned = raw.replace(/[,\s$£€]/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

/**
 * Zoho-style Deals CSV importer. Mirrors the Accounts / Leads / Contacts
 * importer shape: big dialog, file pick → preview → import phases,
 * missing/unknown header diagnostics, and a "Keep extra columns" panel
 * that captures non-standard CSV columns into deals.custom_fields.
 */
export const ImportDealsDialog: React.FC<Props> = ({
  open, onOpenChange, organizationId, accounts, workspaceName,
  create, onComplete,
}) => {
  const [phase, setPhase] = useState<Phase>('pick');
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<Array<Record<string, string>>>([]);
  const [duplicateHeaders, setDuplicateHeaders] = useState<ImportResult['duplicateHeaders']>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [extraColumns, setExtraColumns] = useState<string[]>([]);
  const [newExtraCol, setNewExtraCol] = useState('');
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
    setExtraColumns([]);
    setNewExtraCol('');
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
        setParseErrors(['The file looks empty. Add a header row and at least one deal.']);
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
    const extra = new Set(extraColumns.map((s) => s.trim()).filter(Boolean));
    const unknownHeaders = headers.filter(
      (h) => !KNOWN_HEADERS.has(h) && !extra.has(h),
    );
    const missingRequired = REQUIRED_HEADERS.filter((h) => {
      if (h === 'deal_name') return !(seen.has('deal_name') || seen.has('title') || seen.has('name'));
      return !seen.has(h);
    });
    return { unknownHeaders, missingRequired: [...missingRequired] };
  }, [headers, extraColumns]);

  const buildInput = (
    row: Record<string, string>,
  ): { ok: true; input: CreateDealInput } | { ok: false; reason: string } => {
    const title = (row.deal_name || row.title || row.name || '').trim();
    if (!title) return { ok: false, reason: 'Missing Deal Name. Set a deal_name / title / name column.' };

    const accountName = (row.account || row.account_name || row.company || row.client_name || '').trim();
    let clientId: string | null = null;
    let clientName: string | null = accountName || null;
    if (accountName) {
      const match = accountByLowerName.get(accountName.toLowerCase());
      if (match) {
        clientId = match.clientId;
        clientName = match.name;
      }
    }

    const customFields: Record<string, unknown> = {};
    for (const col of extraColumns) {
      const key = col.trim();
      if (!key) continue;
      const val = row[key];
      if (val == null || val === '') continue;
      customFields[key] = val;
    }

    const closeRaw = (row.closing_date || row.close_date || row.expected_close_date || '').trim();
    const expectedCloseDate = closeRaw ? (() => {
      const d = new Date(closeRaw);
      return Number.isFinite(d.getTime()) ? d : null;
    })() : null;

    const input: CreateDealInput = {
      title,
      description: row.description?.trim() || null,
      clientId,
      clientName,
      stage: parseStage(row.stage),
      value: parseNumber(row.amount ?? row.value) ?? 0,
      currency: (row.currency || 'USD').trim().toUpperCase(),
      expectedCloseDate,
      ownerName: row.owner_name?.trim() || row.owner?.trim() || row.deal_owner?.trim() || null,
      tags: (row.tags || '').split(/[,;|]/).map((t) => t.trim()).filter(Boolean),
      dealType: row.deal_type?.trim() || row.type?.trim() || null,
      nextStep: row.next_step?.trim() || null,
      leadSource: row.lead_source?.trim() || null,
      campaignSource: row.campaign_source?.trim() || null,
      customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
    };
    return { ok: true, input };
  };

  const handleImport = async () => {
    if (!organizationId || parsed.length === 0) return;
    setPhase('importing');

    const errors: ImportResult['errors'] = [];
    let imported = 0;
    let lastErr: string | null = null;
    let consecutive = 0;

    for (let i = 0; i < parsed.length; i++) {
      const rowNum = i + 2;
      const built = buildInput(parsed[i]);
      if (!built.ok) {
        errors.push({ row: rowNum, message: built.reason });
        if (built.reason === lastErr) consecutive += 1;
        else { lastErr = built.reason; consecutive = 1; }
        if (consecutive >= 5) {
          errors.push({ row: rowNum + 1, message: `Aborted after ${consecutive} identical errors — fix the source and re-import.` });
          break;
        }
        continue;
      }
      try {
        await create(built.input);
        imported += 1;
        lastErr = null;
        consecutive = 0;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        errors.push({ row: rowNum, message: msg });
        if (msg === lastErr) consecutive += 1;
        else { lastErr = msg; consecutive = 1; }
        if (consecutive >= 5) {
          errors.push({ row: rowNum + 1, message: `Aborted after ${consecutive} identical errors — likely permission / workspace.` });
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
    };
    setResult(res);
    setPhase('imported');
    onComplete(res);
  };

  const sampleRows = parsed.slice(0, 3);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[97vw] max-w-[97vw] sm:max-w-6xl max-h-[95vh] sm:max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 break-words">
            <Upload className="w-5 h-5 text-primary shrink-0" />
            <span className="min-w-0">Import Deals from CSV</span>
          </DialogTitle>
          <DialogDescription className="break-words">
            Upload a spreadsheet of deals (sales pipeline). Standard CRM column
            names work out of the box; extra columns can be kept as custom fields.
          </DialogDescription>
          <p className="text-xs text-muted-foreground mt-1 break-words">
            Deals will land in workspace{' '}
            <strong className="text-foreground">{workspaceName ?? 'Default'}</strong>.
            Switch workspace in the sidebar before importing to send them elsewhere.
          </p>
        </DialogHeader>

        <div className="space-y-4">
          {phase === 'pick' && (
            <div className="space-y-3">
              <div className="rounded-md border-2 border-dashed border-border bg-muted/30 p-8 text-center">
                <Upload className="w-8 h-8 mx-auto text-muted-foreground" />
                <p className="text-sm mt-2 font-medium">Drop a CSV here or pick a file</p>
                <p className="text-xs text-muted-foreground mt-1">
                  We accept standard CRM exports (Zoho / Salesforce / HubSpot / Apollo column names).
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                  }}
                />
                <div className="flex justify-center gap-2 mt-3">
                  <Button onClick={() => fileInputRef.current?.click()} size="sm">
                    Pick a file
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    onClick={() => downloadFile('taskcalendar-deals-template.csv', TEMPLATE, 'text/csv')}
                  >
                    <Download className="w-3.5 h-3.5 mr-1" /> Download template
                  </Button>
                </div>
                {parseErrors.length > 0 && (
                  <div className="mt-3 text-xs text-destructive">
                    {parseErrors.map((e, i) => <p key={i}>{e}</p>)}
                  </div>
                )}
              </div>
            </div>
          )}

          {phase === 'preview' && headers && (
            <div className="space-y-3">
              <div className="rounded-md border p-3 bg-muted/30 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{file?.name ?? 'Uploaded file'}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {parsed.length} row{parsed.length === 1 ? '' : 's'} · {headers.length} column{headers.length === 1 ? '' : 's'}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={reset}>
                  <X className="w-3.5 h-3.5 mr-1" /> Different file
                </Button>
              </div>

              {precheck && precheck.missingRequired.length > 0 && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs">
                  <p className="font-semibold text-destructive inline-flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Missing required column{precheck.missingRequired.length === 1 ? '' : 's'}
                  </p>
                  <p className="mt-1 break-words">
                    We couldn't find: <code className="font-mono break-all">{precheck.missingRequired.join(', ')}</code>.
                  </p>
                </div>
              )}

              {precheck && precheck.unknownHeaders.length > 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs">
                  <p className="font-semibold text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Columns we'll ignore
                  </p>
                  <p className="text-amber-700/80 dark:text-amber-300/80 mt-1 break-words">
                    We don't have a place for:{' '}
                    <code className="font-mono break-all">{precheck.unknownHeaders.join(', ')}</code>.
                    Add them below to keep on each deal as a custom field.
                  </p>
                </div>
              )}

              <div className="rounded-md border p-3 space-y-2">
                <div>
                  <p className="text-sm font-semibold">Keep extra columns</p>
                  <p className="text-[11px] text-muted-foreground">
                    Type a column name from your CSV to capture it on each deal as a custom field.
                  </p>
                </div>
                <div className="flex gap-2 items-center">
                  <input
                    value={newExtraCol}
                    onChange={(e) => setNewExtraCol(e.target.value)}
                    placeholder="e.g. region, sla_tier, renewal_date"
                    className="flex-1 h-9 px-3 text-sm border rounded-md bg-background"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newExtraCol.trim()) {
                        e.preventDefault();
                        const v = newExtraCol.trim();
                        setExtraColumns((prev) => (prev.includes(v) ? prev : [...prev, v]));
                        setNewExtraCol('');
                      }
                    }}
                  />
                  <Button
                    type="button" size="sm" variant="outline"
                    disabled={!newExtraCol.trim()}
                    onClick={() => {
                      const v = newExtraCol.trim();
                      if (!v) return;
                      setExtraColumns((prev) => (prev.includes(v) ? prev : [...prev, v]));
                      setNewExtraCol('');
                    }}
                  >
                    Add column
                  </Button>
                </div>
                {precheck && precheck.unknownHeaders.filter((h) => !extraColumns.includes(h)).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <span className="text-[11px] text-muted-foreground self-center">Quick add:</span>
                    {precheck.unknownHeaders.filter((h) => !extraColumns.includes(h)).slice(0, 12).map((h) => (
                      <button
                        key={h} type="button"
                        onClick={() => setExtraColumns((prev) => [...prev, h])}
                        className="text-[10px] px-1.5 py-0.5 rounded border border-dashed border-amber-500/40 text-amber-700 hover:bg-amber-500/10"
                      >
                        + {h}
                      </button>
                    ))}
                  </div>
                )}
                {extraColumns.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <span className="text-[11px] text-muted-foreground self-center">Keeping:</span>
                    {extraColumns.map((c) => (
                      <Badge key={c} variant="outline" className="text-[10px] gap-1 pl-2 pr-1">
                        {c}
                        <button
                          type="button" className="opacity-60 hover:opacity-100"
                          onClick={() => setExtraColumns((prev) => prev.filter((x) => x !== c))}
                          title={`Stop keeping ${c}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Preview — first 3 rows
                </p>
                <div className="rounded-md border overflow-auto max-h-64">
                  <table className="text-[11px] w-full">
                    <thead className="bg-muted/40 sticky top-0">
                      <tr>
                        {headers.map((h) => (
                          <th key={h} className="px-2 py-1 text-left font-semibold whitespace-nowrap">{h}</th>
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
            <div className="space-y-3">
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
                <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                  Imported {result.imported} deal{result.imported === 1 ? '' : 's'}
                </p>
                {result.errors.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {result.errors.length} row{result.errors.length === 1 ? '' : 's'} skipped.
                  </p>
                )}
              </div>
              {result.errors.length > 0 && (
                <div className="rounded-md border p-3 max-h-48 overflow-y-auto">
                  <p className="text-xs font-semibold mb-2">Skipped rows</p>
                  <ul className="space-y-1 text-xs">
                    {result.errors.slice(0, 20).map((e, i) => (
                      <li key={i} className="break-words">
                        <span className="text-muted-foreground">Row {e.row}:</span> {e.message}
                      </li>
                    ))}
                    {result.errors.length > 20 && (
                      <li className="text-muted-foreground">+ {result.errors.length - 20} more…</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {(phase === 'pick' || phase === 'preview') && (
            <>
              <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
              {phase === 'preview' && (
                <Button
                  onClick={handleImport}
                  disabled={!precheck || precheck.missingRequired.length > 0 || !workspaceName || accounts.length === 0}
                >
                  Import {parsed.length} row{parsed.length === 1 ? '' : 's'}
                </Button>
              )}
            </>
          )}
          {phase === 'imported' && (
            <Button onClick={() => handleClose(false)}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
