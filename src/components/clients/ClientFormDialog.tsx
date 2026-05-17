import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
  Client, ClientStatus, ClientType,
  CreateClientInput, isValidEmail, isValidWebsite,
} from '@/services/supabase/clients';
import { findDuplicates, DuplicateMatch } from '@/services/supabase/dupDetection';
import { DuplicateBanner } from './DuplicateBanner';

const TYPES: { value: ClientType; label: string }[] = [
  { value: 'customer', label: 'Customer' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'partner', label: 'Partner' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'other', label: 'Other' },
];

const STATUSES: { value: ClientStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'archived', label: 'Archived' },
];

const RATINGS = ['Hot', 'Warm', 'Cold'];

interface FormState {
  name: string;
  legalName: string;
  industry: string;
  type: ClientType;
  status: ClientStatus;
  website: string;
  email: string;
  phone: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  annualRevenue: string;
  employeeCount: string;
  rating: string;
  source: string;
  description: string;
  tags: string;
}

const blank: FormState = {
  name: '',
  legalName: '',
  industry: '',
  type: 'customer',
  status: 'active',
  website: '',
  email: '',
  phone: '',
  addressLine1: '',
  city: '',
  state: '',
  postalCode: '',
  country: '',
  annualRevenue: '',
  employeeCount: '',
  rating: '',
  source: '',
  description: '',
  tags: '',
};

const fromClient = (c: Client): FormState => ({
  name: c.name,
  legalName: c.legalName ?? '',
  industry: c.industry ?? '',
  type: c.type,
  status: c.status,
  website: c.website ?? '',
  email: c.email ?? '',
  phone: c.phone ?? '',
  addressLine1: c.addressLine1 ?? '',
  city: c.city ?? '',
  state: c.state ?? '',
  postalCode: c.postalCode ?? '',
  country: c.country ?? '',
  annualRevenue: c.annualRevenue != null ? String(c.annualRevenue) : '',
  employeeCount: c.employeeCount != null ? String(c.employeeCount) : '',
  rating: c.rating ?? '',
  source: c.source ?? '',
  description: c.description ?? '',
  tags: (c.tags ?? []).join(', '),
});

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided we're editing; otherwise we're creating. */
  client?: Client | null;
  onSubmit: (input: CreateClientInput) => Promise<void>;
  onUpdateExisting?: (clientId: string, input: CreateClientInput) => Promise<void>;
  /**
   * Organization scope used for live duplicate detection. Optional so the
   * dialog still renders if a parent forgets to pass it; the banner is a
   * defence-in-depth layer — server-side unique indexes still hard-block.
   */
  organizationId?: string | null;
}

export const ClientFormDialog: React.FC<Props> = ({
  open, onOpenChange, client, onSubmit, onUpdateExisting, organizationId,
}) => {
  const [form, setForm] = useState<FormState>(blank);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);
  const [override, setOverride] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(client ? fromClient(client) : blank);
      setError(null);
      setMatches([]);
      setOverride(false);
    }
  }, [open, client]);

  // Debounced live duplicate scan. 250ms is long enough that we don't fire on
  // every keystroke but short enough the banner appears before the user
  // tabs to submit. Skip when editing the same client to avoid the row
  // matching itself.
  useEffect(() => {
    if (!open || !organizationId || !form.name?.trim()) {
      setMatches([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const m = await findDuplicates(organizationId, {
          name: form.name,
          legalName: form.legalName,
          email: form.email,
          website: form.website,
          phone: form.phone,
          country: form.country,
          city: form.city,
          state: form.state,
        });
        // Exclude the row being edited from its own duplicate list.
        const filtered = client
          ? m.filter((x) => x.clientId !== client.clientId)
          : m;
        setMatches(filtered);
      } catch {
        // Silent — dup detection is advisory; server still enforces.
        setMatches([]);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [
    open,
    organizationId,
    form.name,
    form.legalName,
    form.email,
    form.website,
    form.phone,
    form.country,
    form.city,
    form.state,
    client,
  ]);

  // Clear override once the user fixes the conflict so a previously-set
  // override flag doesn't silently apply to a now-clean payload.
  useEffect(() => {
    if (matches.length === 0) setOverride(false);
  }, [matches]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const buildPayload = (
    opts?: { skipDuplicateCheck?: boolean; createDuplicate?: boolean },
  ): CreateClientInput | null => {
    const name = form.name.trim();
    if (!name) {
      setError('Name is required');
      return null;
    }
    if (form.email && !isValidEmail(form.email.trim())) {
      setError('Invalid email');
      return null;
    }
    if (form.website && !isValidWebsite(form.website.trim())) {
      setError('Invalid website');
      return null;
    }
    const revenue = form.annualRevenue ? Number(form.annualRevenue) : null;
    if (revenue != null && (!Number.isFinite(revenue) || revenue < 0)) {
      setError('Annual revenue must be a non-negative number');
      return null;
    }
    const headcount = form.employeeCount.trim() === '' ? null : Number(form.employeeCount);
    if (headcount != null) {
      if (!Number.isFinite(headcount) || headcount < 0 || !Number.isInteger(headcount)) {
        setError('Employee count must be a non-negative integer');
        return null;
      }
    }

    // Banner is showing and user hasn't explicitly overridden — block.
    // The server-side unique index is the real guard; this just spares
    // the round-trip and keeps the UX in sync with what the DB will do.
    if (!client && matches.length > 0 && !opts?.skipDuplicateCheck) {
      setError('Possible duplicate — update the existing client, create anyway, or skip.');
      return null;
    }

    const baseTags = form.tags
      .split(/[,;|]/)
      .map((t) => t.trim())
      .filter(Boolean);
    // When overriding, append the `dup_override` tag so the partial unique
    // index lets the row through. Dedupe via Set in case it was typed in
    // manually by an admin.
    const tags = opts?.createDuplicate
      ? Array.from(new Set([...baseTags, 'dup_override']))
      : baseTags;

    return {
      name,
      legalName: form.legalName.trim() || null,
      industry: form.industry.trim() || null,
      type: form.type,
      status: form.status,
      website: form.website.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      addressLine1: form.addressLine1.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      postalCode: form.postalCode.trim() || null,
      country: form.country.trim() || null,
      annualRevenue: revenue,
      employeeCount: headcount,
      rating: form.rating.trim() || null,
      source: form.source.trim() || null,
      description: form.description.trim() || null,
      tags,
    };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const payload = buildPayload({
      skipDuplicateCheck: override,
      createDuplicate: override,
    });
    if (!payload) return;

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(payload);
      // TODO: recordOverride should be called once we know the created
      // client's id. `onSubmit` returns void today; the audit row is a
      // nice-to-have on top of the server-enforced unique index, so we
      // skip it from the dialog. Wire this once the parent surfaces the
      // created Client back.
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save client');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateExisting = async (clientId: string) => {
    if (!onUpdateExisting || submitting) return;
    const payload = buildPayload({ skipDuplicateCheck: true });
    if (!payload) return;
    setSubmitting(true);
    setError(null);
    try {
      await onUpdateExisting(clientId, payload);
      onOpenChange(false);
      window.dispatchEvent(new CustomEvent('open-client', { detail: clientId }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update existing client');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{client ? 'Edit client' : 'New client'}</DialogTitle>
          <DialogDescription>
            {client
              ? 'Update the client account details.'
              : 'Add a new client (account) to your CRM.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2 space-y-1">
              <Label htmlFor="cf-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="cf-name" required maxLength={200}
                value={form.name} onChange={(e) => set('name', e.target.value)}
                placeholder="Acme Corp"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cf-legal">Legal name</Label>
              <Input
                id="cf-legal" maxLength={200}
                value={form.legalName}
                onChange={(e) => set('legalName', e.target.value)}
                placeholder="Acme Corporation, Inc."
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cf-industry">Industry</Label>
              <Input
                id="cf-industry" maxLength={100}
                value={form.industry}
                onChange={(e) => set('industry', e.target.value)}
                placeholder="Manufacturing"
              />
            </div>

            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => set('type', v as ClientType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set('status', v as ClientStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="cf-email">Email</Label>
              <Input
                id="cf-email" type="email" maxLength={250}
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="hello@acme.com"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cf-phone">Phone</Label>
              <Input
                id="cf-phone" maxLength={50}
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="+1 555 0100"
              />
            </div>
            <div className="md:col-span-2 space-y-1">
              <Label htmlFor="cf-website">Website</Label>
              <Input
                id="cf-website" maxLength={250}
                value={form.website}
                onChange={(e) => set('website', e.target.value)}
                placeholder="https://acme.com"
              />
            </div>

            <div className="md:col-span-2 space-y-1">
              <Label htmlFor="cf-addr">Address</Label>
              <Input
                id="cf-addr" maxLength={200}
                value={form.addressLine1}
                onChange={(e) => set('addressLine1', e.target.value)}
                placeholder="1 Market St"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cf-city">City</Label>
              <Input
                id="cf-city" maxLength={100}
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cf-state">State / region</Label>
              <Input
                id="cf-state" maxLength={100}
                value={form.state}
                onChange={(e) => set('state', e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cf-zip">Postal code</Label>
              <Input
                id="cf-zip" maxLength={30}
                value={form.postalCode}
                onChange={(e) => set('postalCode', e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cf-country">Country</Label>
              <Input
                id="cf-country" maxLength={100}
                value={form.country}
                onChange={(e) => set('country', e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="cf-rev">Annual revenue (USD)</Label>
              <Input
                id="cf-rev" type="number" min="0" step="1000"
                value={form.annualRevenue}
                onChange={(e) => set('annualRevenue', e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cf-head">Employees</Label>
              <Input
                id="cf-head" type="number" min="0" step="1"
                value={form.employeeCount}
                onChange={(e) => set('employeeCount', e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label>Rating</Label>
              <Select value={form.rating || 'none'} onValueChange={(v) => set('rating', v === 'none' ? '' : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {RATINGS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cf-source">Source</Label>
              <Input
                id="cf-source" maxLength={100}
                value={form.source}
                onChange={(e) => set('source', e.target.value)}
                placeholder="Referral, web, event…"
              />
            </div>

            <div className="md:col-span-2 space-y-1">
              <Label htmlFor="cf-tags">Tags (comma-separated)</Label>
              <Input
                id="cf-tags" maxLength={500}
                value={form.tags}
                onChange={(e) => set('tags', e.target.value)}
                placeholder="enterprise, priority, q4"
              />
            </div>
            <div className="md:col-span-2 space-y-1">
              <Label htmlFor="cf-desc">Description</Label>
              <Textarea
                id="cf-desc" rows={3} maxLength={2000}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Brief background, deal context, anything useful for the next person opening this account…"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <DuplicateBanner
            matches={matches}
            onOpenExisting={(id) => {
              // Close this dialog and let the parent (Clients page) open the
              // existing client via the custom event. Decoupling via event
              // keeps the dialog ignorant of routing/state shape.
              onOpenChange(false);
              window.dispatchEvent(new CustomEvent('open-client', { detail: id }));
            }}
            onUpdateExisting={onUpdateExisting ? handleUpdateExisting : undefined}
            onOverride={() => {
              setOverride(true);
              setError(null);
            }}
            onSkip={() => onOpenChange(false)}
            overrideActive={override}
          />

          <DialogFooter className="gap-2">
            <Button
              type="button" variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {client ? 'Save changes' : override ? 'Add as new client' : 'Create client'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
