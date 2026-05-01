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
}

export const ClientFormDialog: React.FC<Props> = ({
  open, onOpenChange, client, onSubmit,
}) => {
  const [form, setForm] = useState<FormState>(blank);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(client ? fromClient(client) : blank);
      setError(null);
    }
  }, [open, client]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const name = form.name.trim();
    if (!name) {
      setError('Name is required');
      return;
    }
    if (form.email && !isValidEmail(form.email.trim())) {
      setError('Invalid email');
      return;
    }
    if (form.website && !isValidWebsite(form.website.trim())) {
      setError('Invalid website');
      return;
    }
    const revenue = form.annualRevenue ? Number(form.annualRevenue) : null;
    if (revenue != null && (!Number.isFinite(revenue) || revenue < 0)) {
      setError('Annual revenue must be a non-negative number');
      return;
    }
    const headcount = form.employeeCount.trim() === '' ? null : Number(form.employeeCount);
    if (headcount != null) {
      if (!Number.isFinite(headcount) || headcount < 0 || !Number.isInteger(headcount)) {
        setError('Employee count must be a non-negative integer');
        return;
      }
    }

    const tags = form.tags
      .split(/[,;|]/)
      .map((t) => t.trim())
      .filter(Boolean);

    const payload: CreateClientInput = {
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

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(payload);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save client');
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
              {client ? 'Save changes' : 'Create client'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
