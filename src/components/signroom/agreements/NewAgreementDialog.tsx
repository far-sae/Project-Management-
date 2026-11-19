import React, { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useSignroom } from '@/hooks/useSignroom';
import { useCrmCompanies, useCrmDeals } from '@/hooks/useCrmHub';
import { clientForCompany } from '@/services/signroom/clients';
import { newestTemplates, typeHint } from '@/lib/signroom/agreementFormat';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { TYPES, type Agreement, type AgreementTemplateSummary } from '../../../../api/_signroom/shared/types';
import { messageOf } from './files';

const NONE = '__none__';

export interface NewAgreementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The CRM company the agreement is for, when started from a company or deal page. */
  companyId?: string;
  /** The CRM deal this agreement closes, when started from a deal page. */
  dealId?: string;
  /**
   * A template to start from, when opened from the templates page: its type and
   * the template itself are already chosen (any version, not only the newest).
   */
  template?: Pick<AgreementTemplateSummary, 'id' | 'name' | 'type' | 'version'>;
  /** Called with the new draft. When left out, the draft opens in the editor. */
  onCreated?: (agreement: Agreement) => void;
}

/**
 * Starts an agreement: who it is for (a CRM company, optionally one of its
 * deals), what kind it is, and whether it begins blank or from a template.
 * The draft opens in the editor.
 */
export const NewAgreementDialog: React.FC<NewAgreementDialogProps> = ({ open, onOpenChange, ...start }) => {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-xl">
        {/* Mounted only while open: the CRM lists load when they are needed, and each opening starts fresh. */}
        <StartForm {...start} busy={busy} setBusy={setBusy} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
};

const StartForm: React.FC<Pick<NewAgreementDialogProps, 'companyId' | 'dealId' | 'template' | 'onCreated'> & {
  busy: boolean;
  setBusy: (busy: boolean) => void;
  close: () => void;
}> = ({ companyId: givenCompanyId, dealId: givenDealId, template: givenTemplate, onCreated, busy, setBusy, close }) => {
  const id = useId();
  const navigate = useNavigate();
  const { client, workspaceId } = useSignroom();
  const { items: companies } = useCrmCompanies();
  const { items: deals } = useCrmDeals();

  const [companyId, setCompanyId] = useState(givenCompanyId ?? '');
  const [dealId, setDealId] = useState(givenDealId ?? '');
  // The form is mounted afresh each time the dialog opens, so a given template only sets where it starts.
  const [given] = useState(givenTemplate);
  const [type, setType] = useState<string>(given?.type ?? TYPES[0]);
  const [title, setTitle] = useState('');
  const [templateId, setTemplateId] = useState(given?.id ?? '');
  const [templates, setTemplates] = useState<AgreementTemplateSummary[]>([]);
  const [error, setError] = useState('');

  // A deal names its company, so starting from a deal alone still fills the company in.
  useEffect(() => {
    if (companyId || !dealId) return;
    const company = deals.find((d) => d.id === dealId)?.companyId;
    if (company) setCompanyId(company);
  }, [companyId, dealId, deals]);

  // Templates are optional: without them the agreement simply starts blank.
  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    client.call<AgreementTemplateSummary[]>('templates')
      .then((list) => { if (active) setTemplates(list); })
      .catch(() => { if (active) setTemplates([]); });
    return () => { active = false; };
  }, [client, workspaceId]);

  const companyDeals = useMemo(() => deals.filter((d) => d.companyId === companyId), [deals, companyId]);
  const typeTemplates = useMemo(() => {
    const newest = newestTemplates(templates, type);
    // The list offers the newest version of each name; a template chosen on the templates page is offered whichever it is.
    return given && given.type === type && !newest.some((t) => t.id === given.id) ? [given, ...newest] : newest;
  }, [templates, type, given]);
  const company = companies.find((c) => c.id === companyId);

  const create = async () => {
    if (!companyId || busy) return;
    setBusy(true);
    setError('');
    try {
      // The documents server keeps its own record of who a document is for, made from the CRM company.
      const forCompany = await clientForCompany(client, companyId);
      const agreement = await client.call<Agreement>('agreements', {
        clientId: forCompany.id,
        type,
        title: title.trim() || undefined,
        templateId: templateId || undefined,
        dealId: dealId || undefined,
      });
      setBusy(false);
      toast.success('Draft created');
      close();
      if (onCreated) onCreated(agreement);
      else navigate(`/crm/agreements/${agreement.id}/edit`);
    } catch (e) {
      setBusy(false);
      const message = messageOf(e, 'Could not create the agreement.');
      setError(message);
      toast.error(message);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>New agreement</DialogTitle>
        <DialogDescription>
          Choose who it is for and a document type. Add your own terms, or start from one of your workspace templates.
        </DialogDescription>
      </DialogHeader>

      {!workspaceId ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Pick a workspace in the sidebar to start an agreement.
        </p>
      ) : (
        <div className="-mx-1 flex max-h-[62vh] flex-col gap-4 overflow-y-auto px-1 py-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={`${id}-company`}>Company</Label>
              <Select value={companyId} onValueChange={(value) => { setCompanyId(value); setDealId(''); }} disabled={busy}>
                <SelectTrigger id={`${id}-company`}><SelectValue placeholder="Choose a company" /></SelectTrigger>
                <SelectContent>
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  {companyId && !company && <SelectItem value={companyId}>This company</SelectItem>}
                </SelectContent>
              </Select>
              {companies.length === 0 && !companyId && (
                <p className="text-xs text-muted-foreground">Add a company in the CRM first.</p>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={`${id}-deal`}>Deal (optional)</Label>
              <Select value={dealId || NONE} onValueChange={(value) => setDealId(value === NONE ? '' : value)} disabled={busy || !companyId}>
                <SelectTrigger id={`${id}-deal`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No deal</SelectItem>
                  {companyDeals.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  {dealId && !companyDeals.some((d) => d.id === dealId) && <SelectItem value={dealId}>This deal</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span id={`${id}-type`} className="text-sm font-medium">Document type</span>
            <div role="radiogroup" aria-labelledby={`${id}-type`} className="grid gap-2 sm:grid-cols-2">
              {TYPES.map((t) => {
                const chosen = type === t;
                return (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    disabled={busy}
                    onClick={() => { setType(t); setTemplateId(''); }}
                    className={cn(
                      'flex min-h-[44px] items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                      chosen ? 'border-foreground bg-secondary' : 'border-border hover:bg-secondary/60',
                    )}
                  >
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">{t}</span>
                      <span className="block text-xs text-muted-foreground">{typeHint(t)}</span>
                    </span>
                    {chosen && <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-title`}>Title (optional)</Label>
            <Input
              id={`${id}-title`}
              value={title}
              maxLength={150}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`Leave blank to use "${type}" and the company name`}
            />
          </div>

          {typeTemplates.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-template`}>Starting point</Label>
              <Select value={templateId || NONE} onValueChange={(value) => setTemplateId(value === NONE ? '' : value)} disabled={busy}>
                <SelectTrigger id={`${id}-template`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Blank document · write my own terms</SelectItem>
                  {typeTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name} · v{t.version}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
        <Button onClick={() => void create()} disabled={busy || !workspaceId || !companyId}>
          {busy && <Loader2 className="animate-spin" aria-hidden />}
          {busy ? 'Creating…' : `Create ${type}`}
        </Button>
      </DialogFooter>
    </>
  );
};

export default NewAgreementDialog;
