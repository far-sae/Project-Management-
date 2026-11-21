import { publicMessage } from '@/lib/publicError';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganization } from '@/context/OrganizationContext';
import { useCrmDealStages } from '@/hooks/useCrmHub';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  ACTION_LABEL, EVENT_LABEL, NEW_RULE, RULE_ACTIONS, RULE_EVENTS, RULE_TEXT_MAX, canAssign, ruleProblem, ruleSentence,
  type CrmRule, type RuleAction, type RuleDraft, type RuleEvent, type RuleNames,
} from '@/lib/crmRules';
import { createRule, deleteRule, listRules, setRuleEnabled } from '@/services/supabase/crmHub/rules';

/**
 * The simple rules of the workspace on screen: "when this happens, do that".
 * Each rule is shown as one sentence. The owner and admins make them; they
 * then run by themselves for every lead and deal of the workspace.
 */

/** Select value for "the owner of the lead or deal" (Radix has no empty value). */
const OWNER = '__owner__';

export const CrmRulesSettings: React.FC = () => {
  const { organization, isAdmin } = useOrganization();
  const { selected } = useSelectedWorkspace();
  const { items: stages } = useCrmDealStages();
  const organizationId = organization?.organizationId ?? '';
  const workspaceId = selected?.workspaceId ?? '';
  const team = useMemo(
    () => (organization?.members ?? []).filter((m) => (!m.status || m.status === 'active') && m.role !== 'viewer'),
    [organization],
  );
  const names = useMemo<RuleNames>(() => ({
    people: new Map((organization?.members ?? []).map((m) => [m.userId, m.displayName || m.email || 'A teammate'])),
    stages: new Map(stages.map((s) => [s.id, s.name])),
  }), [organization, stages]);

  const [rules, setRules] = useState<CrmRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [draft, setDraft] = useState<RuleDraft>(NEW_RULE);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setProblem('');
    try {
      setRules(await listRules(workspaceId));
    } catch (err) {
      setProblem(publicMessage(err, 'The rules could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { void load(); }, [load]);

  const set = <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const pickEvent = (event: RuleEvent) => setDraft((d) => ({
    ...d,
    event,
    stageId: event === 'deal_stage' ? d.stageId : null,
    // "Give it to a person" is only for the moment a record is made.
    action: d.action === 'assign' && !canAssign(event) ? 'follow_up' : d.action,
  }));

  const add = async () => {
    const wrong = ruleProblem(draft, rules.length);
    setProblem(wrong ?? '');
    if (wrong || !organizationId || !workspaceId) return;
    setBusy(true);
    try {
      const made = await createRule(organizationId, workspaceId, draft);
      setRules((list) => [...list, made]);
      setDraft(NEW_RULE);
      toast.success('Rule added. It runs from now on.');
    } catch (err) {
      setProblem(publicMessage(err, 'The rule could not be saved.'));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (rule: CrmRule, enabled: boolean) => {
    setRules((list) => list.map((r) => (r.id === rule.id ? { ...r, enabled } : r)));
    try {
      await setRuleEnabled(rule.id, enabled);
    } catch (err) {
      setRules((list) => list.map((r) => (r.id === rule.id ? { ...r, enabled: !enabled } : r)));
      toast.error(publicMessage(err, 'The rule could not be changed.'));
    }
  };

  const remove = async (rule: CrmRule) => {
    setBusy(true);
    try {
      await deleteRule(rule.id);
      setRules((list) => list.filter((r) => r.id !== rule.id));
      toast.success('Rule removed');
    } catch (err) {
      toast.error(publicMessage(err, 'The rule could not be removed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="max-w-3xl overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex min-h-11 flex-col justify-center border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">Rules</h2>
        <p className="mt-1 text-pretty text-xs text-muted-foreground">
          When something happens to a lead or a deal, do one thing by itself. Rules run for leads typed in, imported and
          sent through a web form alike.
        </p>
      </div>

      {loading ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">Loading…</p>
      ) : rules.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">No rules yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rules.map((rule) => {
            const sentence = ruleSentence(rule, names);
            return (
              <li key={rule.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <p className={rule.enabled ? 'min-w-0 text-sm text-foreground' : 'min-w-0 text-sm text-muted-foreground line-through'}>{sentence}</p>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch checked={rule.enabled} onCheckedChange={(next) => void toggle(rule, next)} disabled={!isAdmin || busy} aria-label={`Rule is on: ${sentence}`} />
                  <Button size="sm" variant="ghost" className="w-8 px-0 text-muted-foreground" onClick={() => void remove(rule)} disabled={!isAdmin || busy} aria-label={`Remove the rule: ${sentence}`}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!isAdmin ? (
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">Only the owner and admins can add or change rules.</p>
      ) : (
        <form className="flex flex-col gap-3 border-t border-border p-4" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <p className="text-sm font-medium text-foreground">New rule</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rule-event">When</Label>
              <Select value={draft.event} onValueChange={(v) => pickEvent(v as RuleEvent)} disabled={busy}>
                <SelectTrigger id="rule-event"><SelectValue /></SelectTrigger>
                <SelectContent>{RULE_EVENTS.map((e) => <SelectItem key={e} value={e}>{EVENT_LABEL[e]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {draft.event === 'deal_stage' && (
              <div className="space-y-1.5">
                <Label htmlFor="rule-stage">Which stage</Label>
                <Select value={draft.stageId ?? ''} onValueChange={(v) => set('stageId', v)} disabled={busy}>
                  <SelectTrigger id="rule-stage"><SelectValue placeholder="Choose a stage" /></SelectTrigger>
                  <SelectContent>{stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {draft.event === 'lead_created' && (
              <div className="space-y-1.5">
                <Label htmlFor="rule-source">Only when the source holds (optional)</Label>
                <Input id="rule-source" value={draft.sourceContains} maxLength={80} onChange={(e) => set('sourceContains', e.target.value)} placeholder="For example: Website form" disabled={busy} />
              </div>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rule-action">Do</Label>
              <Select value={draft.action} onValueChange={(v) => set('action', v as RuleAction)} disabled={busy}>
                <SelectTrigger id="rule-action"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RULE_ACTIONS.filter((a) => a !== 'assign' || canAssign(draft.event)).map((a) => <SelectItem key={a} value={a}>{ACTION_LABEL[a]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rule-person">{draft.action === 'assign' ? 'To whom' : 'For whom'}</Label>
              <Select value={draft.personId ?? (draft.action === 'assign' ? '' : OWNER)} onValueChange={(v) => set('personId', v === OWNER ? null : v)} disabled={busy}>
                <SelectTrigger id="rule-person"><SelectValue placeholder="Choose a person" /></SelectTrigger>
                <SelectContent>
                  {draft.action !== 'assign' && <SelectItem value={OWNER}>Its owner</SelectItem>}
                  {team.map((m) => <SelectItem key={m.userId} value={m.userId}>{m.displayName || m.email}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {draft.action !== 'assign' && (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
              <div className="space-y-1.5">
                <Label htmlFor="rule-body">{draft.action === 'follow_up' ? 'The follow-up is called' : 'The notice says'}</Label>
                <Input id="rule-body" value={draft.body} maxLength={RULE_TEXT_MAX} onChange={(e) => set('body', e.target.value)} disabled={busy} />
                <p className="text-xs text-muted-foreground">Write {'{name}'} where the lead’s or the deal’s name should go.</p>
              </div>
              {draft.action === 'follow_up' && (
                <div className="space-y-1.5">
                  <Label htmlFor="rule-due">Due in days</Label>
                  <Input id="rule-due" type="number" min={0} max={365} value={draft.dueDays} onChange={(e) => set('dueDays', Number(e.target.value))} disabled={busy} />
                </div>
              )}
            </div>
          )}
          {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
          <div>
            <Button type="submit" variant="outline" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
              Add rule
            </Button>
          </div>
        </form>
      )}
      {!isAdmin && problem && <p role="alert" className="px-4 pb-3 text-sm text-destructive">{problem}</p>}
    </section>
  );
};
