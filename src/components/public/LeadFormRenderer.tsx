// src/components/public/LeadFormRenderer.tsx
import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface FieldDef {
  key: string;
  label: string;
  type: "text"|"email"|"tel"|"url"|"textarea"|"select"|"number";
  required: boolean;
  options?: string[];
  maxLength?: number;
}

interface FormConfig {
  title: string;
  description: string | null;
  fields: FieldDef[];
  thank_you_message: string;
  turnstile_site_key: string | null;
}

declare global {
  interface Window {
    turnstile?: { render: (selector: string, opts: { sitekey: string; callback: (token: string) => void }) => void };
  }
}

const FUNCTIONS_BASE = import.meta.env.VITE_SUPABASE_URL
  ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
  : "";

interface Props { slug: string; embed?: boolean }

export const LeadFormRenderer: React.FC<Props> = ({ slug, embed }) => {
  const [config, setConfig] = useState<FormConfig | null>(null);
  const [values, setValues] = useState<Record<string, string>>({ _hp: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ message: string; redirectUrl?: string } | null>(null);
  const [tsToken, setTsToken] = useState<string>("");

  useEffect(() => {
    fetch(`${FUNCTIONS_BASE}/forms-get?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then((c: FormConfig) => setConfig(c))
      .catch(() => setConfig({ title: "Not found", description: null, fields: [], thank_you_message: "", turnstile_site_key: null }));
  }, [slug]);

  useEffect(() => {
    if (!config?.turnstile_site_key) return;
    if (!document.getElementById("ts-script")) {
      const s = document.createElement("script");
      s.id = "ts-script";
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      s.async = true;
      document.head.appendChild(s);
    }
    const id = setInterval(() => {
      if (window.turnstile && document.getElementById("ts-widget")) {
        window.turnstile.render("#ts-widget", {
          sitekey: config.turnstile_site_key!,
          callback: setTsToken,
        });
        clearInterval(id);
      }
    }, 200);
    return () => clearInterval(id);
  }, [config?.turnstile_site_key]);

  // Embed mode: post height to parent so forms.js can resize.
  useEffect(() => {
    if (!embed) return;
    const post = () => window.parent.postMessage({ type: "tc-form-height", height: document.body.scrollHeight }, "*");
    const obs = new ResizeObserver(post);
    obs.observe(document.body);
    return () => obs.disconnect();
  });

  if (!config) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>;
  if (done) {
    if (done.redirectUrl) {
      window.location.href = done.redirectUrl;
      return null;
    }
    return <p className="p-6 text-center">{done.message}</p>;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrors({});
    try {
      const res = await fetch(`${FUNCTIONS_BASE}/forms-submit`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-form-slug": slug,
          ...(tsToken ? { "x-turnstile-token": tsToken } : {}),
        },
        body: JSON.stringify(values),
      });
      const body = await res.json();
      if (res.status === 422 && body.fields) {
        setErrors(body.fields);
        return;
      }
      if (res.status === 403) {
        setErrors({ _form: "Verification failed. Try again." });
        return;
      }
      if (res.status === 429) {
        setErrors({ _form: "Too many submissions. Try again later." });
        return;
      }
      if (!res.ok) {
        setErrors({ _form: "Something went wrong." });
        return;
      }
      setDone({ message: body.message, redirectUrl: body.redirect_url ?? undefined });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 p-6 max-w-md mx-auto">
      <div>
        <h2 className="text-xl font-semibold">{config.title}</h2>
        {config.description && <p className="text-sm text-muted-foreground mt-1">{config.description}</p>}
      </div>
      {config.fields.map((f) => (
        <div key={f.key}>
          <Label>{f.label}{f.required && " *"}</Label>
          {f.type === "textarea" ? (
            <Textarea value={values[f.key] ?? ""} maxLength={f.maxLength}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
          ) : f.type === "select" ? (
            <Select value={values[f.key] ?? ""} onValueChange={(v) => setValues((vs) => ({ ...vs, [f.key]: v }))}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{(f.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          ) : (
            <Input type={f.type} value={values[f.key] ?? ""} maxLength={f.maxLength}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
          )}
          {errors[f.key] && <p className="text-xs text-destructive">{errors[f.key]}</p>}
        </div>
      ))}
      <input type="text" name="_hp" tabIndex={-1} autoComplete="off"
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
        value={values._hp ?? ""}
        onChange={(e) => setValues((v) => ({ ...v, _hp: e.target.value }))} />
      {config.turnstile_site_key && <div id="ts-widget" />}
      {errors._form && <p className="text-sm text-destructive">{errors._form}</p>}
      <Button type="submit" disabled={submitting}>{submitting ? "Submitting…" : "Submit"}</Button>
    </form>
  );
};
