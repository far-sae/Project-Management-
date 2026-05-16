// src/components/settings/LeadFormEditor.tsx
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LeadForm, FormField, FieldType, updateForm } from "@/services/supabase/leadForms";
import { Trash2, Plus, Copy } from "lucide-react";
import { toast } from "sonner";

interface Props {
  form: LeadForm;
  onChanged: () => void;
}

const FIELD_TYPES: FieldType[] = ["text", "email", "tel", "url", "textarea", "select", "number"];

export const LeadFormEditor: React.FC<Props> = ({ form, onChanged }) => {
  const [fields, setFields] = useState<FormField[]>(form.fields);
  const [thankYou, setThankYou] = useState(form.thankYouMessage);
  const [redirectUrl, setRedirectUrl] = useState(form.redirectUrl ?? "");
  const [turnstileEnabled, setTurnstileEnabled] = useState(form.turnstileEnabled);
  const [perMin, setPerMin] = useState(form.rateLimitPerMinute);
  const [perHour, setPerHour] = useState(form.rateLimitPerHour);
  const [saving, setSaving] = useState(false);

  const setField = (idx: number, patch: Partial<FormField>) =>
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));

  const save = async () => {
    setSaving(true);
    try {
      await updateForm(form.formId, {
        fields,
        thankYouMessage: redirectUrl ? "" : thankYou,
        redirectUrl: redirectUrl || null,
        turnstileEnabled,
        rateLimitPerMinute: perMin,
        rateLimitPerHour: perHour,
      });
      toast.success("Form saved");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const embedIframe =
    `<iframe src="${window.location.origin}/forms/${form.slug}/embed" ` +
    `width="100%" height="640" frameborder="0" ` +
    `style="border:0;background:transparent;"></iframe>`;

  const embedScript =
    `<script async src="${window.location.origin}/forms.js" ` +
    `data-slug="${form.slug}"></script>`;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Public URL: <a className="underline" href={`/forms/${form.slug}`} target="_blank" rel="noopener noreferrer">
          {window.location.origin}/forms/{form.slug}
        </a>
      </p>

      <div className="space-y-2">
        <Label>Fields</Label>
        {fields.map((f, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-end border rounded-md p-2">
            <Input className="col-span-2" placeholder="key" value={f.key} onChange={(e) => setField(i, { key: e.target.value })} />
            <Input className="col-span-3" placeholder="label" value={f.label} onChange={(e) => setField(i, { label: e.target.value })} />
            <Select value={f.type} onValueChange={(v) => setField(i, { type: v as FieldType })}>
              <SelectTrigger className="col-span-2"><SelectValue /></SelectTrigger>
              <SelectContent>{FIELD_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
            <div className="col-span-1 flex items-center gap-1">
              <Switch checked={f.required} onCheckedChange={(v) => setField(i, { required: v })} />
              <Label className="text-xs">req</Label>
            </div>
            <Input className="col-span-3" placeholder="options (comma-separated)" defaultValue={(f.options ?? []).join(",")}
              onBlur={(e) => setField(i, { options: e.target.value ? e.target.value.split(",").map((s) => s.trim()) : undefined })}
              disabled={f.type !== "select"} />
            <Button variant="ghost" size="icon" className="col-span-1"
              onClick={() => setFields((p) => p.filter((_, x) => x !== i))}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setFields((p) => [
          ...p, { key: `f${p.length}`, label: "New field", type: "text", required: false },
        ])}>
          <Plus className="w-4 h-4 mr-1" /> Add field
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Redirect URL (optional)</Label>
          <Input value={redirectUrl} onChange={(e) => setRedirectUrl(e.target.value)} placeholder="https://…" />
        </div>
        <div>
          <Label>Thank-you message</Label>
          <Input value={thankYou} onChange={(e) => setThankYou(e.target.value)} disabled={!!redirectUrl} />
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={turnstileEnabled} onCheckedChange={setTurnstileEnabled} />
          <Label>Cloudflare Turnstile</Label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>Rate / min</Label>
            <Input type="number" value={perMin} onChange={(e) => setPerMin(Number(e.target.value) || 1)} />
          </div>
          <div>
            <Label>Rate / hour</Label>
            <Input type="number" value={perHour} onChange={(e) => setPerHour(Number(e.target.value) || 1)} />
          </div>
        </div>
      </div>

      <div>
        <Label>Embed</Label>
        <div className="space-y-2">
          <div className="flex gap-2">
            <Textarea readOnly value={embedIframe} rows={3} />
            <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(embedIframe); toast.success("Copied"); }}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex gap-2">
            <Textarea readOnly value={embedScript} rows={2} />
            <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(embedScript); toast.success("Copied"); }}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save form"}</Button>
    </div>
  );
};
