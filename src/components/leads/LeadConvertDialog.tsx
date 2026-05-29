import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Repeat, CheckCircle2, Building2, User as UserIcon, TrendingUp } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Lead, ConvertLeadInput, ConvertLeadResult, leadDisplayName } from '@/services/supabase/leads';
import type { Client } from '@/services/supabase/clients';
import { usePipelines } from '@/hooks/usePipelines';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  existingClients: Client[];
  onConvert: (lead: Lead, input: ConvertLeadInput) => Promise<ConvertLeadResult>;
  onConverted?: (result: ConvertLeadResult) => void;
}

const NEW_ACCOUNT = '__new__';

export const LeadConvertDialog: React.FC<Props> = ({
  open, onOpenChange, lead, existingClients, onConvert, onConverted,
}) => {
  const { pipelines, defaultPipeline, stagesByPipeline } = usePipelines();

  const [accountChoice, setAccountChoice] = useState<string>(NEW_ACCOUNT);
  const [createContact, setCreateContact] = useState(true);
  const [createDeal, setCreateDeal] = useState(false);
  const [dealTitle, setDealTitle] = useState('');
  const [dealValue, setDealValue] = useState('0');
  const [dealCurrency, setDealCurrency] = useState('USD');
  const [pipelineId, setPipelineId] = useState<string>('');
  const [stageId, setStageId] = useState<string>('');
  const [expectedClose, setExpectedClose] = useState<string>('');
  const [busy, setBusy] = useState(false);

  // Default pipeline + stage when the deal-creation toggle flips on.
  useEffect(() => {
    if (!createDeal || pipelineId) return;
    if (defaultPipeline) {
      setPipelineId(defaultPipeline.pipelineId);
      const firstStage = stagesByPipeline[defaultPipeline.pipelineId]?.[0];
      if (firstStage) setStageId(firstStage.stageId);
    }
  }, [createDeal, defaultPipeline, stagesByPipeline, pipelineId]);

  useEffect(() => {
    if (!open || !lead) return;
    setAccountChoice(NEW_ACCOUNT);
    setCreateContact(true);
    setCreateDeal(false);
    setDealTitle(`${lead.company} — Initial deal`);
    setDealValue('0');
    setDealCurrency('USD');
    setPipelineId('');
    setStageId('');
    setExpectedClose('');
  }, [open, lead]);

  // Filter accounts in the same workspace as the lead so we don't suggest a
  // cross-workspace merge that would surprise the user.
  const accountChoices = useMemo(() => {
    if (!lead) return [] as Client[];
    return existingClients
      .filter((c) => c.workspaceId === lead.workspaceId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [existingClients, lead]);

  const dealReady = !createDeal || (
    dealTitle.trim().length > 0 && pipelineId !== '' && stageId !== ''
  );

  const handleConvert = async () => {
    if (!lead) return;
    if (createDeal && !dealTitle.trim()) {
      toast.error('Add a deal title or turn off "Create a deal"');
      return;
    }
    if (createDeal && (!pipelineId || !stageId)) {
      toast.error('Pick a pipeline and stage, or turn off "Create a deal"');
      return;
    }
    setBusy(true);
    try {
      const input: ConvertLeadInput = {
        existingClientId: accountChoice === NEW_ACCOUNT ? null : accountChoice,
        createContact,
        createDeal: createDeal
          ? {
              title: dealTitle.trim(),
              value: Number(dealValue) || 0,
              currency: dealCurrency,
              pipelineId: pipelineId || null,
              stageId: stageId || null,
              expectedCloseDate: expectedClose ? new Date(expectedClose) : null,
            }
          : null,
      };
      const result = await onConvert(lead, input);
      // Inspect the result so the toast reflects what actually happened.
      // The service returns warnings when contact/deal couldn't be created
      // even though the lead was successfully stamped — we want to be
      // honest about partial success, not paint everything green.
      const dealRequested = !!input.createDeal;
      const contactRequested = input.createContact !== false;
      const dealOk = !dealRequested || !!result.dealId;
      const contactOk = !contactRequested || !!result.contactId;
      if ((result.warnings && result.warnings.length > 0) || !dealOk || !contactOk) {
        const parts: string[] = [];
        if (!contactOk) parts.push("contact wasn't created");
        if (!dealOk)    parts.push("deal wasn't created");
        if (result.warnings?.length) parts.push(...result.warnings);
        toast.warning(
          `Converted "${leadDisplayName(lead)}" but ${parts.join(' · ')}. Open the new account to finish manually.`,
        );
      } else {
        toast.success(`Converted "${leadDisplayName(lead)}" to an account`);
      }
      onConverted?.(result);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Convert failed');
    } finally {
      setBusy(false);
    }
  };

  if (!lead) return null;
  const stages = pipelineId ? stagesByPipeline[pipelineId] ?? [] : [];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Repeat className="w-5 h-5 text-emerald-600" />
            Convert Lead
          </DialogTitle>
          <DialogDescription>
            {leadDisplayName(lead)} — {lead.company}. Convert promotes this
            lead to an Account (and optionally a Contact and a Deal). The lead
            row stays for audit but won't show in active lists.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Account */}
          <section className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" /> Account
            </p>
            <Select value={accountChoice} onValueChange={setAccountChoice} disabled={busy}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_ACCOUNT}>
                  Create new account — {lead.company}
                </SelectItem>
                {accountChoices.length > 0 && (
                  <>
                    <div className="px-2 py-1 text-[10px] uppercase text-muted-foreground">
                      Attach to existing account
                    </div>
                    {accountChoices.map((c) => (
                      <SelectItem key={c.clientId} value={c.clientId}>{c.name}</SelectItem>
                    ))}
                  </>
                )}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Picking an existing account moves the lead's company info into
              the contact (which links there) without overwriting the
              account record.
            </p>
          </section>

          {/* Contact */}
          <section className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-border"
                checked={createContact}
                onChange={(e) => setCreateContact(e.target.checked)}
                disabled={busy}
              />
              <span className="text-sm font-semibold flex items-center gap-1.5">
                <UserIcon className="w-3.5 h-3.5" /> Create Contact
              </span>
              <Badge variant="outline" className="text-[10px]">
                {leadDisplayName(lead)}
              </Badge>
            </label>
            <p className="text-[11px] text-muted-foreground pl-6">
              Pre-filled from the lead's name, title, email, phone.
            </p>
          </section>

          {/* Deal */}
          <section className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-border"
                checked={createDeal}
                onChange={(e) => setCreateDeal(e.target.checked)}
                disabled={busy}
              />
              <span className="text-sm font-semibold flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" /> Create Deal
              </span>
            </label>
            {createDeal && (
              <div className="space-y-2 pl-6">
                <div>
                  <Label className="text-xs">Title</Label>
                  <Input
                    value={dealTitle}
                    onChange={(e) => setDealTitle(e.target.value)}
                    disabled={busy}
                    maxLength={200}
                  />
                </div>
                <div className="grid grid-cols-[1fr_100px] gap-2">
                  <div>
                    <Label className="text-xs">Value</Label>
                    <Input
                      type="number" min={0} step="0.01"
                      value={dealValue}
                      onChange={(e) => setDealValue(e.target.value)}
                      disabled={busy}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Currency</Label>
                    <Input
                      value={dealCurrency}
                      onChange={(e) => setDealCurrency(e.target.value.toUpperCase().slice(0, 4))}
                      disabled={busy}
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Pipeline</Label>
                  <Select
                    value={pipelineId}
                    onValueChange={(v) => {
                      setPipelineId(v);
                      const first = stagesByPipeline[v]?.[0];
                      setStageId(first ? first.stageId : '');
                    }}
                    disabled={busy}
                  >
                    <SelectTrigger><SelectValue placeholder="Pick a pipeline" /></SelectTrigger>
                    <SelectContent>
                      {pipelines.map((p) => (
                        <SelectItem key={p.pipelineId} value={p.pipelineId}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Stage</Label>
                  <Select value={stageId} onValueChange={setStageId} disabled={busy || stages.length === 0}>
                    <SelectTrigger><SelectValue placeholder="Pick a stage" /></SelectTrigger>
                    <SelectContent>
                      {stages.map((s) => (
                        <SelectItem key={s.stageId} value={s.stageId}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Expected close</Label>
                  <Input
                    type="date"
                    value={expectedClose}
                    onChange={(e) => setExpectedClose(e.target.value)}
                    disabled={busy}
                  />
                </div>
              </div>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleConvert} disabled={busy || !dealReady}>
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
            Convert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
