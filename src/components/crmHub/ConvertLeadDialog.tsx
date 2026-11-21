import { publicMessage } from '@/lib/publicError';
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { currencyNotSaved } from '@/lib/crmDealMoney';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useCrmCurrency } from '@/context/CrmCurrencyContext';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import { convertLeadToDeal } from '@/services/supabase/crmHub/flow';
import { COMMON_CURRENCIES } from '@/lib/countries';
import { conversionDefaults, leadName } from '@/lib/crmFlow';
import type { CrmCompany, CrmContact, CrmDealStage } from '@/types/crmHub';
import { Button } from '@/components/ui/button';
import { CurrencySelect } from '@/components/ui/currency-select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Props {
  lead: CrmContact | null;
  stages: CrmDealStage[];
  companies: CrmCompany[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the deal exists, before the page moves to it. */
  onConverted?: () => void | Promise<void>;
}

const NONE = '__none__';
const NEW = '__new__';

/** Qualified lead → deal in the pipeline, linked to the person and their company. */
export const ConvertLeadDialog: React.FC<Props> = ({ lead, stages, companies, open, onOpenChange, onConverted }) => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const navigate = useNavigate();
  const { selected } = useSelectedWorkspace();
  const { code: companyCurrency } = useCrmCurrency();

  const [dealName, setDealName] = useState('');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState(companyCurrency);
  const [stageId, setStageId] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [companyChoice, setCompanyChoice] = useState(NONE);
  const [newCompany, setNewCompany] = useState('');
  const [busy, setBusy] = useState(false);

  const openStages = useMemo(
    () => stages.filter((s) => s.status === 'open').sort((a, b) => a.sortOrder - b.sortOrder),
    [stages],
  );

  const leadId = lead?.id;
  useEffect(() => {
    if (!open || !lead) return;
    const company = companies.find((c) => c.id === lead.companyId) ?? null;
    const defaults = conversionDefaults(lead, company, stages);
    setDealName(defaults.dealName);
    setStageId(defaults.stageId ?? '');
    setValue('');
    setCurrency(companyCurrency);
    setCloseDate('');
    setCompanyChoice(company ? company.id : NONE);
    setNewCompany('');
    // Re-run only when the dialog opens for a (different) lead.
  }, [open, leadId]);

  if (!lead) return null;

  const stage = openStages.find((s) => s.id === stageId);
  // An old lead may have no workspace of its own; the deal then goes in the one that is open.
  const workspaceId = lead.workspaceId ?? selected?.workspaceId ?? null;
  const canSave =
    Boolean(dealName.trim() && stage && workspaceId) && (companyChoice !== NEW || Boolean(newCompany.trim()));

  const handleConvert = async () => {
    if (!organization || !user || !stage || !workspaceId) return;
    setBusy(true);
    try {
      const { deal } = await convertLeadToDeal({
        lead,
        organizationId: organization.organizationId,
        workspaceId,
        actorId: user.userId,
        dealName,
        value: Number(value) || 0,
        currency: currency || companyCurrency,
        stage,
        expectedCloseDate: closeDate || null,
        companyId: companyChoice === NONE || companyChoice === NEW ? null : companyChoice,
        newCompanyName: companyChoice === NEW ? newCompany : null,
      });
      if (currencyNotSaved(currency, deal, companyCurrency)) {
        toast.warning(`Saved, but in ${companyCurrency}. This database cannot keep a deal in another currency until migration 182 has been run.`);
      } else {
        toast.success(`Deal opened in ${stage.name}`);
      }
      await onConverted?.();
      onOpenChange(false);
      navigate(`/crm/deals/${deal.id}`);
    } catch (error) {
      toast.error(publicMessage(error, 'Could not convert the lead'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Convert {leadName(lead)} to a deal</DialogTitle>
          <DialogDescription>
            Opens a deal in the pipeline, linked to this lead. The lead stays in your list, marked “Deal open”.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="convert-name">Deal name</Label>
            <Input id="convert-name" value={dealName} onChange={(e) => setDealName(e.target.value)} disabled={busy} />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="convert-value">Value</Label>
              <Input
                id="convert-value"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                placeholder="0"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="convert-currency">Currency</Label>
              {/* A currency that is not in the list still shows, as the placeholder. */}
              <CurrencySelect
                id="convert-currency"
                value={COMMON_CURRENCIES.includes(currency) ? currency : ''}
                placeholder={currency}
                onValueChange={setCurrency}
                disabled={busy}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="convert-close">Expected close</Label>
            <Input id="convert-close" type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} disabled={busy} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Stage</Label>
            <Select value={stageId} onValueChange={setStageId} disabled={busy}>
              <SelectTrigger><SelectValue placeholder="Pick a stage" /></SelectTrigger>
              <SelectContent>
                {openStages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name} · {s.probability}%</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {openStages.length === 0 && (
              <p className="text-xs text-muted-foreground">Add an open stage in CRM settings first.</p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Company</Label>
            <Select value={companyChoice} onValueChange={setCompanyChoice} disabled={busy}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No company</SelectItem>
                <SelectItem value={NEW}>New company…</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {companyChoice === NEW && (
              <Input
                autoFocus
                placeholder="Company name"
                value={newCompany}
                onChange={(e) => setNewCompany(e.target.value)}
                disabled={busy}
                aria-label="New company name"
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleConvert} disabled={busy || !canSave}>
            {busy && <Loader2 className="animate-spin" />}
            Convert to deal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ConvertLeadDialog;
