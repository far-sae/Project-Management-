import React, { useEffect, useState } from 'react';
import { Loader2, User as UserIcon } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Lead, CreateLeadInput, LeadStatus,
  LEAD_STATUS_OPTIONS, LEAD_SOURCE_OPTIONS,
  LEAD_INDUSTRY_OPTIONS, LEAD_RATING_OPTIONS, LEAD_SALUTATIONS,
} from '@/services/supabase/leads';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead?: Lead | null;
  onSubmit: (input: CreateLeadInput) => Promise<void>;
  /** When set (create mode only), stamp the new lead into this account +
   *  category + workspace. Used when adding a lead from inside an account. */
  defaultAccountId?: string | null;
  defaultCategory?: string | null;
  defaultWorkspaceId?: string | null;
  /** When provided, a "Business / Account" picker is shown so the rep can set
   *  (or change) which business this lead belongs to — both create and edit.
   *  This is the lead-side half of the two-way business↔lead link. */
  accounts?: Array<{ clientId: string; name: string }>;
  /** When provided, a "Workspace" picker is shown so the rep can move the lead
   *  to another workspace (CRM is workspace-scoped). */
  workspaces?: Array<{ workspaceId: string; name: string }>;
}

const NONE = '__none__';

interface FormState {
  salutation: string;
  firstName: string;
  lastName: string;
  title: string;
  email: string;
  phone: string;
  mobile: string;
  fax: string;
  website: string;
  skypeId: string;
  twitter: string;
  linkedinUrl: string;
  company: string;
  industry: string;
  annualRevenue: string;
  noOfEmployees: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  leadSource: string;
  leadStatus: LeadStatus;
  rating: string;
  emailOptOut: boolean;
  description: string;
  tags: string;
  accountId: string;
  workspaceId: string;
}

const blank: FormState = {
  salutation: '',
  firstName: '',
  lastName: '',
  title: '',
  email: '',
  phone: '',
  mobile: '',
  fax: '',
  website: '',
  skypeId: '',
  twitter: '',
  linkedinUrl: '',
  company: '',
  industry: '',
  annualRevenue: '',
  noOfEmployees: '',
  street: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
  leadSource: '',
  leadStatus: 'new',
  rating: '',
  emailOptOut: false,
  description: '',
  tags: '',
  accountId: '',
  workspaceId: '',
};

const fromLead = (l: Lead): FormState => ({
  salutation: l.salutation ?? '',
  firstName: l.firstName ?? '',
  lastName: l.lastName,
  title: l.title ?? '',
  email: l.email ?? '',
  phone: l.phone ?? '',
  mobile: l.mobile ?? '',
  fax: l.fax ?? '',
  website: l.website ?? '',
  skypeId: l.skypeId ?? '',
  twitter: l.twitter ?? '',
  linkedinUrl: l.linkedinUrl ?? '',
  company: l.company,
  industry: l.industry ?? '',
  annualRevenue: l.annualRevenue != null ? String(l.annualRevenue) : '',
  noOfEmployees: l.noOfEmployees != null ? String(l.noOfEmployees) : '',
  street: l.street ?? '',
  city: l.city ?? '',
  state: l.state ?? '',
  postalCode: l.postalCode ?? '',
  country: l.country ?? '',
  leadSource: l.leadSource ?? '',
  leadStatus: l.leadStatus,
  rating: l.rating ?? '',
  emailOptOut: l.emailOptOut,
  description: l.description ?? '',
  tags: l.tags.join(', '),
  accountId: l.accountId ?? '',
  workspaceId: l.workspaceId ?? '',
});

export const LeadFormDialog: React.FC<Props> = ({
  open, onOpenChange, lead, onSubmit,
  defaultAccountId = null, defaultCategory = null, defaultWorkspaceId = null,
  accounts = [], workspaces = [],
}) => {
  // Create mode seeds account + workspace from the defaults; edit from the lead.
  const initial = (): FormState =>
    lead
      ? fromLead(lead)
      : { ...blank, accountId: defaultAccountId ?? '', workspaceId: defaultWorkspaceId ?? '' };
  const [form, setForm] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initial());
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  // Reject negatives, NaN, Infinity, double-dash, scientific notation overflow,
  // etc. Trim only — don't strip exponent letters or sign chars (the old
  // [^\d.\-]/g regex turned '1e6' into 16 and let '--5' through to Number()).
  const parseNumber = (v: string): number | null => {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  };

  const handleSave = async () => {
    setError(null);
    if (!form.lastName.trim()) {
      setError('Last name is required');
      return;
    }
    if (!form.company.trim()) {
      setError('Company is required');
      return;
    }
    setBusy(true);
    try {
      const input: CreateLeadInput = {
        salutation: form.salutation || null,
        firstName: form.firstName || null,
        lastName: form.lastName.trim(),
        title: form.title || null,
        email: form.email || null,
        phone: form.phone || null,
        mobile: form.mobile || null,
        fax: form.fax || null,
        website: form.website || null,
        skypeId: form.skypeId || null,
        twitter: form.twitter || null,
        linkedinUrl: form.linkedinUrl || null,
        company: form.company.trim(),
        industry: form.industry || null,
        // Compute once and explicitly null-check so a deliberate `0` doesn't
        // round-trip through the form as "unknown".
        annualRevenue: parseNumber(form.annualRevenue),
        noOfEmployees: (() => {
          const n = parseNumber(form.noOfEmployees);
          return n == null ? null : Math.round(n);
        })(),
        street: form.street || null,
        city: form.city || null,
        state: form.state || null,
        postalCode: form.postalCode || null,
        country: form.country || null,
        leadSource: form.leadSource || null,
        leadStatus: form.leadStatus,
        rating: form.rating || null,
        emailOptOut: form.emailOptOut,
        description: form.description || null,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      };
      // Business/account link is editable in both create and edit via the
      // selector, so always carry the chosen value (empty = no business).
      input.accountId = form.accountId || null;
      // Workspace is editable in both create and edit (move a lead between
      // workspaces). Only carry an explicit pick; empty leaves it to the create
      // hook's active-workspace default (and is a no-op on edit).
      if (form.workspaceId) input.workspaceId = form.workspaceId;
      // Category is only stamped on create (from the account the lead was added
      // inside). Edit leaves the lead's existing category untouched.
      if (!lead && defaultCategory) input.category = defaultCategory;
      await onSubmit(input);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save lead');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="w-[95vw] max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserIcon className="w-5 h-5 text-orange-500" />
            {lead ? `Edit Lead — ${lead.leadNumber}` : 'Create Lead'}
          </DialogTitle>
          <DialogDescription>
            Lead Information. Company and Last Name are required.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-4">
          <Section title="Identity">
            <Row>
              <div>
                <Label className="text-xs">Salutation</Label>
                <Select
                  value={form.salutation || NONE}
                  onValueChange={(v) => set('salutation', v === NONE ? '' : v)}
                >
                  <SelectTrigger><SelectValue placeholder="-None-" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>-None-</SelectItem>
                    {LEAD_SALUTATIONS.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">First Name</Label>
                <Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} maxLength={80} />
              </div>
            </Row>
            <Row>
              <div className="md:col-span-3">
                <Label className="text-xs">Last Name <span className="text-destructive">*</span></Label>
                <Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} required maxLength={80} />
              </div>
            </Row>
            <Row>
              <div className="md:col-span-3">
                <Label className="text-xs">Title</Label>
                <Input value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={120} />
              </div>
            </Row>
          </Section>

          <Section title="Company">
            <Row>
              <div className="md:col-span-3">
                <Label className="text-xs">Company <span className="text-destructive">*</span></Label>
                <Input value={form.company} onChange={(e) => set('company', e.target.value)} required maxLength={160} />
              </div>
            </Row>
            {accounts.length > 0 && (
              <Row>
                <div className="md:col-span-3">
                  <Label className="text-xs">Business / Account</Label>
                  <Select
                    value={form.accountId || NONE}
                    onValueChange={(v) => set('accountId', v === NONE ? '' : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="-None-" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>-None-</SelectItem>
                      {accounts.map((a) => (
                        <SelectItem key={a.clientId} value={a.clientId}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Which business this lead belongs to. The business page lists all its leads.
                  </p>
                </div>
              </Row>
            )}
            {workspaces.length > 0 && (
              <Row>
                <div className="md:col-span-3">
                  <Label className="text-xs">Workspace</Label>
                  <Select
                    value={form.workspaceId || NONE}
                    onValueChange={(v) => set('workspaceId', v === NONE ? '' : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="-None-" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>-Unassigned-</SelectItem>
                      {workspaces.map((w) => (
                        <SelectItem key={w.workspaceId} value={w.workspaceId}>{w.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Which workspace this lead lives in. Move it here if it's not showing under the right workspace.
                  </p>
                </div>
              </Row>
            )}
            <Row>
              <div>
                <Label className="text-xs">Industry</Label>
                <Select
                  value={form.industry || NONE}
                  onValueChange={(v) => set('industry', v === NONE ? '' : v)}
                >
                  <SelectTrigger><SelectValue placeholder="-None-" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>-None-</SelectItem>
                    {LEAD_INDUSTRY_OPTIONS.map((i) => (
                      <SelectItem key={i} value={i}>{i}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Annual Revenue</Label>
                <Input
                  type="number" min={0} step="0.01"
                  placeholder="$"
                  value={form.annualRevenue}
                  onChange={(e) => set('annualRevenue', e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">No. of Employees</Label>
                <Input
                  type="number" min={0} step="1"
                  value={form.noOfEmployees}
                  onChange={(e) => set('noOfEmployees', e.target.value)}
                />
              </div>
            </Row>
          </Section>

          <Section title="Contact channels">
            <Row>
              <div>
                <Label className="text-xs">Email</Label>
                <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} maxLength={320} />
              </div>
              <div>
                <Label className="text-xs">Phone</Label>
                <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} maxLength={40} />
              </div>
              <div>
                <Label className="text-xs">Mobile</Label>
                <Input value={form.mobile} onChange={(e) => set('mobile', e.target.value)} maxLength={40} />
              </div>
            </Row>
            <Row>
              <div>
                <Label className="text-xs">Fax</Label>
                <Input value={form.fax} onChange={(e) => set('fax', e.target.value)} maxLength={40} />
              </div>
              <div>
                <Label className="text-xs">Website</Label>
                <Input value={form.website} onChange={(e) => set('website', e.target.value)} maxLength={320} />
              </div>
              <div>
                <Label className="text-xs">Skype ID</Label>
                <Input value={form.skypeId} onChange={(e) => set('skypeId', e.target.value)} maxLength={80} />
              </div>
            </Row>
            <Row>
              <div>
                <Label className="text-xs">Twitter</Label>
                <Input value={form.twitter} onChange={(e) => set('twitter', e.target.value)} maxLength={80} placeholder="@handle" />
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">LinkedIn URL</Label>
                <Input value={form.linkedinUrl} onChange={(e) => set('linkedinUrl', e.target.value)} maxLength={320} />
              </div>
            </Row>
          </Section>

          <Section title="Lifecycle">
            <Row>
              <div>
                <Label className="text-xs">Lead Source</Label>
                <Select
                  value={form.leadSource || NONE}
                  onValueChange={(v) => set('leadSource', v === NONE ? '' : v)}
                >
                  <SelectTrigger><SelectValue placeholder="-None-" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>-None-</SelectItem>
                    {LEAD_SOURCE_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Lead Status</Label>
                <Select
                  value={form.leadStatus}
                  onValueChange={(v) => set('leadStatus', v as LeadStatus)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LEAD_STATUS_OPTIONS
                      .filter((o) => o.value !== 'converted')
                      .map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Rating</Label>
                <Select
                  value={form.rating || NONE}
                  onValueChange={(v) => set('rating', v === NONE ? '' : v)}
                >
                  <SelectTrigger><SelectValue placeholder="-None-" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>-None-</SelectItem>
                    {LEAD_RATING_OPTIONS.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </Row>
            <Row>
              <div className="md:col-span-3 flex items-center gap-2">
                <input
                  id="opt-out"
                  type="checkbox"
                  className="w-4 h-4 rounded border-border"
                  checked={form.emailOptOut}
                  onChange={(e) => set('emailOptOut', e.target.checked)}
                />
                <Label htmlFor="opt-out" className="text-xs cursor-pointer">
                  Email Opt Out — exclude from email campaigns
                </Label>
              </div>
            </Row>
          </Section>

          <Section title="Address">
            <Row>
              <div className="md:col-span-3">
                <Label className="text-xs">Street</Label>
                <Input value={form.street} onChange={(e) => set('street', e.target.value)} maxLength={200} />
              </div>
            </Row>
            <Row>
              <div>
                <Label className="text-xs">City</Label>
                <Input value={form.city} onChange={(e) => set('city', e.target.value)} maxLength={120} />
              </div>
              <div>
                <Label className="text-xs">State/Province</Label>
                <Input value={form.state} onChange={(e) => set('state', e.target.value)} maxLength={120} />
              </div>
              <div>
                <Label className="text-xs">Postal Code</Label>
                <Input value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} maxLength={40} />
              </div>
            </Row>
            <Row>
              <div className="md:col-span-3">
                <Label className="text-xs">Country</Label>
                <Input value={form.country} onChange={(e) => set('country', e.target.value)} maxLength={120} />
              </div>
            </Row>
          </Section>

          <Section title="Notes">
            <Row>
              <div className="md:col-span-3">
                <Label className="text-xs">Description</Label>
                <Textarea
                  rows={3}
                  maxLength={4000}
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                />
              </div>
            </Row>
            <Row>
              <div className="md:col-span-3">
                <Label className="text-xs">Tags (comma-separated)</Label>
                <Input
                  value={form.tags}
                  onChange={(e) => set('tags', e.target.value)}
                  placeholder="vip, q2-target"
                  maxLength={500}
                />
              </div>
            </Row>
          </Section>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {lead ? 'Save changes' : 'Create Lead'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-2">
    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b pb-1">
      {title}
    </h4>
    <div className="space-y-3">
      {children}
    </div>
  </section>
);

const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="grid gap-3 md:grid-cols-3">{children}</div>
);
