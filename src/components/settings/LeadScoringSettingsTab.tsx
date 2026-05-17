// src/components/settings/LeadScoringSettingsTab.tsx
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useLeadScoringRules } from "@/hooks/useLeadScoringRules";
import {
  createRule, updateRule, deleteRule, saveThresholds,
  ScoringField, ScoringOperator,
} from "@/services/supabase/leadScoring";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

const FIELDS: ScoringField[] = [
  "industry","annual_revenue","employee_count","source","status","type",
  "rating","country","recent_activity_days","open_deals_count","tag_present",
];
const OPS: ScoringOperator[] = ["eq","neq","gte","lte","gt","lt","in","contains","exists"];

export const LeadScoringSettingsTab: React.FC = () => {
  const { organizationId, rules, thresholds, canManage } = useLeadScoringRules();
  const [draftThresholds, setDraftThresholds] = useState(thresholds);
  const [adding, setAdding] = useState(false);
  const [newRule, setNewRule] = useState({
    label: "", field: "annual_revenue" as ScoringField, operator: "gte" as ScoringOperator,
    value: "1000000", points: 10,
  });

  React.useEffect(() => setDraftThresholds(thresholds), [thresholds]);

  if (!canManage) return <p className="text-sm text-muted-foreground">Only admins can manage scoring.</p>;
  if (!organizationId) return null;

  const parseValue = (v: string): unknown => {
    if (v.startsWith("[") || v.startsWith("{") || v === "true" || v === "false" || /^-?\d+(\.\d+)?$/.test(v)) {
      try { return JSON.parse(v); } catch { /* fallthrough */ }
    }
    return v;
  };

  const saveRulePatch = async (ruleId: string, patch: Parameters<typeof updateRule>[1]) => {
    try {
      await updateRule(ruleId, patch);
      toast.success("Rule saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    }
  };

  const removeRule = async (ruleId: string) => {
    try {
      await deleteRule(ruleId);
      toast.success("Rule deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end">
        <div>
          <Label>Hot ≥</Label>
          <Input type="number" value={draftThresholds.hot}
            onChange={(e) => setDraftThresholds({ ...draftThresholds, hot: Number(e.target.value) })} />
        </div>
        <div>
          <Label>Warm ≥</Label>
          <Input type="number" value={draftThresholds.warm}
            onChange={(e) => setDraftThresholds({ ...draftThresholds, warm: Number(e.target.value) })} />
        </div>
        <Button onClick={async () => {
          try { await saveThresholds(organizationId, draftThresholds); toast.success("Thresholds saved"); }
          catch (e) { toast.error(e instanceof Error ? e.message : "Save failed"); }
        }}>Save thresholds</Button>
      </div>

      <div className="space-y-2">
        {rules.map((r) => (
          <div key={r.ruleId} className="border rounded-md p-3 grid grid-cols-12 gap-2 items-end">
            <Input className="col-span-3" defaultValue={r.label} onBlur={(e) => saveRulePatch(r.ruleId, { label: e.target.value })} />
            <Select value={r.field} onValueChange={(v) => saveRulePatch(r.ruleId, { field: v as ScoringField })}>
              <SelectTrigger className="col-span-2"><SelectValue /></SelectTrigger>
              <SelectContent>{FIELDS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={r.operator} onValueChange={(v) => saveRulePatch(r.ruleId, { operator: v as ScoringOperator })}>
              <SelectTrigger className="col-span-1"><SelectValue /></SelectTrigger>
              <SelectContent>{OPS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
            <Input className="col-span-3" defaultValue={JSON.stringify(r.value)} onBlur={(e) => saveRulePatch(r.ruleId, { value: parseValue(e.target.value) })} />
            <Input className="col-span-1" type="number" defaultValue={r.points} onBlur={(e) => saveRulePatch(r.ruleId, { points: Number(e.target.value) })} />
            <div className="col-span-1 flex items-center gap-2">
              <Switch checked={r.enabled} onCheckedChange={(v) => saveRulePatch(r.ruleId, { enabled: v })} />
            </div>
            <Button variant="ghost" size="icon" className="col-span-1" onClick={() => removeRule(r.ruleId)}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>

      {adding ? (
        <div className="border rounded-md p-3 grid grid-cols-12 gap-2 items-end">
          <Input className="col-span-3" placeholder="Label"
            value={newRule.label} onChange={(e) => setNewRule({ ...newRule, label: e.target.value })} />
          <Select value={newRule.field} onValueChange={(v) => setNewRule({ ...newRule, field: v as ScoringField })}>
            <SelectTrigger className="col-span-2"><SelectValue /></SelectTrigger>
            <SelectContent>{FIELDS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={newRule.operator} onValueChange={(v) => setNewRule({ ...newRule, operator: v as ScoringOperator })}>
            <SelectTrigger className="col-span-1"><SelectValue /></SelectTrigger>
            <SelectContent>{OPS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="col-span-3" placeholder='Value (JSON or string)'
            value={newRule.value} onChange={(e) => setNewRule({ ...newRule, value: e.target.value })} />
          <Input className="col-span-1" type="number"
            value={newRule.points} onChange={(e) => setNewRule({ ...newRule, points: Number(e.target.value) })} />
          <Button className="col-span-2" onClick={async () => {
            try {
              await createRule(organizationId, {
                label: newRule.label, field: newRule.field, operator: newRule.operator,
                value: parseValue(newRule.value), points: newRule.points, position: rules.length + 1,
              });
              setAdding(false);
              setNewRule({ label: "", field: "annual_revenue", operator: "gte", value: "1000000", points: 10 });
              toast.success("Rule added");
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Add failed");
            }
          }}>Add</Button>
        </div>
      ) : (
        <Button variant="outline" onClick={() => setAdding(true)}>
          <Plus className="w-4 h-4 mr-1" /> Add rule
        </Button>
      )}
    </div>
  );
};
