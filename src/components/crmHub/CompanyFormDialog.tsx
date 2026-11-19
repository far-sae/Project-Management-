import React, { useEffect, useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useCrmCurrency } from '@/context/CrmCurrencyContext';
import { useWorkspaceForCreate } from '@/hooks/useCrmHub';
import { createCompany, updateCompany } from '@/services/supabase/crmHub/companies';
import { COMPANY_TYPES } from '@/lib/crmCompany';
import type { CrmCompany } from '@/types/crmHub';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const NONE = '__none__';

/** Suggestions only: any industry can be typed. */
const INDUSTRIES = [
  'Accounting', 'Agriculture', 'Architecture', 'Automotive', 'Banking', 'Construction', 'Consulting',
  'Education', 'Energy', 'Engineering', 'Financial services', 'Food and drink', 'Government', 'Healthcare',
  'Hospitality', 'Insurance', 'Legal', 'Logistics', 'Manufacturing', 'Marketing and advertising', 'Media',
  'Non-profit', 'Property', 'Recruitment', 'Retail', 'Software', 'Telecommunications', 'Travel',
];

/** Suggestions only: an exact head count can be typed. */
const SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1,000', '1,001-5,000', '5,001+'];

interface Form {
  name: string; website: string; industry: string; type: string; ownerId: string;
  phone: string; email: string; linkedinUrl: string;
  address: string; city: string; state: string; postalCode: string; country: string;
  companySize: string; annualRevenue: string; notes: string;
}

const formFor = (company: CrmCompany | null | undefined, meId: string | null): Form => ({
  name: company?.name ?? '',
  website: company?.website ?? '',
  industry: company?.industry ?? '',
  type: company?.type ?? '',
  ownerId: company ? company.ownerId ?? '' : meId ?? '',
  phone: company?.phone ?? '',
  email: company?.email ?? '',
  linkedinUrl: company?.linkedinUrl ?? '',
  address: company?.address ?? '',
  city: company?.city ?? '',
  state: company?.state ?? '',
  postalCode: company?.postalCode ?? '',
  country: company?.country ?? '',
  companySize: company?.companySize ?? '',
  annualRevenue: company?.annualRevenue != null ? String(company.annualRevenue) : '',
  notes: company?.notes ?? '',
});

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The company being edited. Leave out to add a new one. */
  company?: CrmCompany | null;
  onSaved: (company: CrmCompany) => void | Promise<void>;
}

/** Add or edit a company. The same form does both, so a company always has the same fields. */
export const CompanyFormDialog: React.FC<Props> = ({ open, onOpenChange, company, onSaved }) => {
  const id = useId();
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { def: currency } = useCrmCurrency();
  const workspaceId = useWorkspaceForCreate();
  const meId = user?.userId ?? null;
  const [form, setForm] = useState<Form>(() => formFor(company, meId));
  const [busy, setBusy] = useState(false);
  const editing = Boolean(company);

  useEffect(() => {
    if (open) setForm(formFor(company, meId));
  }, [open, company, meId]);

  const set = (key: keyof Form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const text = (key: keyof Form, extra: React.ComponentProps<typeof Input> = {}) => (
    <Input
      id={`${id}-${key}`}
      value={form[key]}
      onChange={(e) => set(key)(e.target.value)}
      disabled={busy}
      {...extra}
    />
  );

  const owners = (organization?.members ?? []).filter((m) => m.status === 'active' && m.role !== 'viewer');
  const revenue = form.annualRevenue.trim() ? Number(form.annualRevenue.replace(/[^\d.-]/g, '')) : null;
  const revenueInvalid = revenue !== null && !Number.isFinite(revenue);

  const handleSave = async () => {
    if (!organization) return;
    const name = form.name.trim();
    if (!name) { toast.error('Give the company a name'); return; }
    if (revenueInvalid) { toast.error('Annual revenue has to be a number'); return; }
    const orNull = (value: string) => value.trim() || null;
    const fields = {
      name,
      website: orNull(form.website),
      industry: orNull(form.industry),
      type: orNull(form.type),
      phone: orNull(form.phone),
      email: orNull(form.email),
      linkedinUrl: orNull(form.linkedinUrl),
      address: orNull(form.address),
      city: orNull(form.city),
      state: orNull(form.state),
      postalCode: orNull(form.postalCode),
      country: orNull(form.country),
      companySize: orNull(form.companySize),
      annualRevenue: revenue,
      notes: orNull(form.notes),
    };
    setBusy(true);
    try {
      const saved = company
        ? await updateCompany(company.id, { ...fields, ownerId: form.ownerId || null })
        : await createCompany(
          { organizationId: organization.organizationId, workspaceId, ...fields },
          form.ownerId || null,
        );
      toast.success(company ? 'Company updated' : 'Company added');
      onOpenChange(false);
      await onSaved(saved);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the company');
    } finally {
      setBusy(false);
    }
  };

  const group = 'flex flex-col gap-3';
  const groupTitle = 'text-xs font-medium text-muted-foreground';
  const row = 'grid grid-cols-1 gap-3 sm:grid-cols-2';
  const field = 'flex min-w-0 flex-col gap-1.5';

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${company?.name}` : 'New company'}</DialogTitle>
          <DialogDescription>
            Only the name is needed. Fill in the rest as you learn it.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex max-h-[62vh] flex-col gap-6 overflow-y-auto px-1 py-1">
          <section className={group} aria-labelledby={`${id}-g-company`}>
            <h3 id={`${id}-g-company`} className={groupTitle}>Company</h3>
            <div className={row}>
              <div className={field}>
                <Label htmlFor={`${id}-name`}>Company name</Label>
                {text('name', { autoFocus: !editing, required: true })}
              </div>
              <div className={field}>
                <Label htmlFor={`${id}-website`}>Website</Label>
                {text('website', { placeholder: 'northwind.example', inputMode: 'url' })}
              </div>
            </div>
            <div className={row}>
              <div className={field}>
                <Label htmlFor={`${id}-industry`}>Industry</Label>
                {text('industry', { list: `${id}-industries`, placeholder: 'Type or pick' })}
                <datalist id={`${id}-industries`}>
                  {INDUSTRIES.map((industry) => <option key={industry} value={industry} />)}
                </datalist>
              </div>
              <div className={field}>
                <Label htmlFor={`${id}-type`}>Type</Label>
                <Select value={form.type || NONE} onValueChange={(v) => set('type')(v === NONE ? '' : v)} disabled={busy}>
                  <SelectTrigger id={`${id}-type`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Work it out from the deals</SelectItem>
                    {COMPANY_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                    {form.type && !(COMPANY_TYPES as readonly string[]).includes(form.type) && (
                      <SelectItem value={form.type}>{form.type}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className={row}>
              <div className={field}>
                <Label htmlFor={`${id}-owner`}>Company owner</Label>
                <Select value={form.ownerId || NONE} onValueChange={(v) => set('ownerId')(v === NONE ? '' : v)} disabled={busy}>
                  <SelectTrigger id={`${id}-owner`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Nobody yet</SelectItem>
                    {owners.map((m) => (
                      <SelectItem key={m.userId} value={m.userId}>
                        {m.userId === meId ? `${m.displayName || m.email} (you)` : m.displayName || m.email}
                      </SelectItem>
                    ))}
                    {form.ownerId && !owners.some((m) => m.userId === form.ownerId) && (
                      <SelectItem value={form.ownerId}>{form.ownerId === meId ? 'You' : 'Former teammate'}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <section className={group} aria-labelledby={`${id}-g-contact`}>
            <h3 id={`${id}-g-contact`} className={groupTitle}>Contact</h3>
            <div className={row}>
              <div className={field}>
                <Label htmlFor={`${id}-phone`}>Phone</Label>
                {text('phone', { type: 'tel' })}
              </div>
              <div className={field}>
                <Label htmlFor={`${id}-email`}>Email</Label>
                {text('email', { type: 'email' })}
              </div>
            </div>
            <div className={field}>
              <Label htmlFor={`${id}-linkedinUrl`}>LinkedIn page</Label>
              {text('linkedinUrl', { placeholder: 'linkedin.com/company/…', inputMode: 'url' })}
            </div>
          </section>

          <section className={group} aria-labelledby={`${id}-g-address`}>
            <h3 id={`${id}-g-address`} className={groupTitle}>Address</h3>
            <div className={field}>
              <Label htmlFor={`${id}-address`}>Street</Label>
              {text('address', { autoComplete: 'off' })}
            </div>
            <div className={row}>
              <div className={field}>
                <Label htmlFor={`${id}-city`}>City</Label>
                {text('city')}
              </div>
              <div className={field}>
                <Label htmlFor={`${id}-state`}>County or state</Label>
                {text('state')}
              </div>
            </div>
            <div className={row}>
              <div className={field}>
                <Label htmlFor={`${id}-postalCode`}>Postcode</Label>
                {text('postalCode')}
              </div>
              <div className={field}>
                <Label htmlFor={`${id}-country`}>Country</Label>
                {text('country')}
              </div>
            </div>
          </section>

          <section className={group} aria-labelledby={`${id}-g-size`}>
            <h3 id={`${id}-g-size`} className={groupTitle}>Size</h3>
            <div className={row}>
              <div className={field}>
                <Label htmlFor={`${id}-companySize`}>Employees</Label>
                {text('companySize', { list: `${id}-sizes`, placeholder: 'A number or a range' })}
                <datalist id={`${id}-sizes`}>
                  {SIZES.map((size) => <option key={size} value={size} />)}
                </datalist>
              </div>
              <div className={field}>
                <Label htmlFor={`${id}-annualRevenue`}>Annual revenue ({currency.code})</Label>
                {text('annualRevenue', { inputMode: 'decimal', 'aria-invalid': revenueInvalid })}
                {revenueInvalid && <p className="text-xs text-destructive">This has to be a number.</p>}
              </div>
            </div>
          </section>

          <section className={group} aria-labelledby={`${id}-g-about`}>
            <h3 id={`${id}-g-about`} className={groupTitle}>About</h3>
            <div className={field}>
              <Label htmlFor={`${id}-notes`}>What they do, and anything worth knowing</Label>
              <Textarea
                id={`${id}-notes`}
                rows={3}
                value={form.notes}
                onChange={(e) => set('notes')(e.target.value)}
                disabled={busy}
              />
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleSave} disabled={busy || !form.name.trim()}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {editing ? 'Save changes' : 'Add company'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CompanyFormDialog;
