import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, User as UserIcon, Building2, Copy } from 'lucide-react';
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
  ContactWithAccount, CreateContactWithAccountInput,
  CONTACT_LEAD_SOURCE_OPTIONS, CONTACT_SALUTATIONS,
  contactDisplayName,
} from '@/services/supabase/contacts';
import type { Client } from '@/services/supabase/clients';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: ContactWithAccount | null;
  accounts: Client[];                       // workspace-scoped accounts to choose from
  /** Other contacts on the same account, used for the Reporting To picker. */
  contactsForReportingTo?: ContactWithAccount[];
  onSubmit: (input: CreateContactWithAccountInput) => Promise<void>;
  /** When the dialog opens from "Add contact" on a specific account drawer,
   *  pre-select that account and lock the picker. */
  lockedAccountId?: string | null;
}

const NONE = '__none__';

interface FormState {
  salutation: string;
  firstName: string;
  lastName: string;
  title: string;
  department: string;

  clientId: string;
  reportingTo: string;
  leadSource: string;

  email: string;
  secondaryEmail: string;
  phone: string;
  mobile: string;
  homePhone: string;
  otherPhone: string;
  asstPhone: string;
  fax: string;
  skypeId: string;
  twitter: string;
  linkedinUrl: string;

  dateOfBirth: string;
  emailOptOut: boolean;
  isPrimary: boolean;

  assistant: string;

  mailingStreet: string;
  mailingCity: string;
  mailingState: string;
  mailingZip: string;
  mailingCountry: string;
  otherStreet: string;
  otherCity: string;
  otherState: string;
  otherZip: string;
  otherCountry: string;

  description: string;
  tags: string;
}

const blank: FormState = {
  salutation: '', firstName: '', lastName: '', title: '', department: '',
  clientId: '', reportingTo: '', leadSource: '',
  email: '', secondaryEmail: '', phone: '', mobile: '',
  homePhone: '', otherPhone: '', asstPhone: '', fax: '',
  skypeId: '', twitter: '', linkedinUrl: '',
  dateOfBirth: '',
  emailOptOut: false,
  isPrimary: false,
  assistant: '',
  mailingStreet: '', mailingCity: '', mailingState: '', mailingZip: '', mailingCountry: '',
  otherStreet: '', otherCity: '', otherState: '', otherZip: '', otherCountry: '',
  description: '', tags: '',
};

const fromContact = (c: ContactWithAccount): FormState => ({
  salutation: c.salutation ?? '',
  firstName: c.firstName ?? '',
  lastName: c.lastName ?? '',
  title: c.title ?? '',
  department: c.department ?? '',
  clientId: c.clientId,
  reportingTo: c.reportingTo ?? '',
  leadSource: c.leadSource ?? '',
  email: c.email ?? '',
  secondaryEmail: c.secondaryEmail ?? '',
  phone: c.phone ?? '',
  mobile: c.mobile ?? '',
  homePhone: c.homePhone ?? '',
  otherPhone: c.otherPhone ?? '',
  asstPhone: c.asstPhone ?? '',
  fax: c.fax ?? '',
  skypeId: c.skypeId ?? '',
  twitter: c.twitter ?? '',
  linkedinUrl: c.linkedinUrl ?? '',
  dateOfBirth: c.dateOfBirth
    ? `${c.dateOfBirth.getFullYear()}-${String(c.dateOfBirth.getMonth() + 1).padStart(2, '0')}-${String(c.dateOfBirth.getDate()).padStart(2, '0')}`
    : '',
  emailOptOut: c.emailOptOut,
  isPrimary: c.isPrimary,
  assistant: c.assistant ?? '',
  mailingStreet: c.mailingStreet ?? '',
  mailingCity: c.mailingCity ?? '',
  mailingState: c.mailingState ?? '',
  mailingZip: c.mailingZip ?? '',
  mailingCountry: c.mailingCountry ?? '',
  otherStreet: c.otherStreet ?? '',
  otherCity: c.otherCity ?? '',
  otherState: c.otherState ?? '',
  otherZip: c.otherZip ?? '',
  otherCountry: c.otherCountry ?? '',
  description: c.description ?? '',
  tags: c.tags.join(', '),
});

export const ContactFormDialog: React.FC<Props> = ({
  open, onOpenChange, contact, accounts, contactsForReportingTo = [],
  onSubmit, lockedAccountId,
}) => {
  const [form, setForm] = useState<FormState>(contact ? fromContact(contact) : blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (contact) {
      setForm(fromContact(contact));
    } else {
      setForm({
        ...blank,
        clientId: lockedAccountId ?? '',
      });
    }
  }, [open, contact, lockedAccountId]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => a.name.localeCompare(b.name)),
    [accounts],
  );

  const reportingChoices = useMemo(
    () => contactsForReportingTo
      .filter((c) => c.clientId === form.clientId && c.contactId !== contact?.contactId)
      .sort((a, b) => contactDisplayName(a).localeCompare(contactDisplayName(b))),
    [contactsForReportingTo, form.clientId, contact?.contactId],
  );

  const copyMailingToOther = () => {
    setForm((prev) => ({
      ...prev,
      otherStreet: prev.mailingStreet,
      otherCity: prev.mailingCity,
      otherState: prev.mailingState,
      otherZip: prev.mailingZip,
      otherCountry: prev.mailingCountry,
    }));
  };

  const handleSave = async () => {
    setError(null);
    if (!form.lastName.trim()) {
      setError('Last name is required');
      return;
    }
    if (!form.clientId) {
      setError('Pick an account to attach this contact to');
      return;
    }
    setBusy(true);
    // Defensive: if the reportingTo no longer matches a contact on the
    // currently-selected account, drop it before save. Protects against
    // any state path that bypasses the onValueChange reset (e.g. someone
    // editing initialState).
    const reportingToOk = !form.reportingTo
      || contactsForReportingTo.some(
        (c) => c.contactId === form.reportingTo && c.clientId === form.clientId,
      );
    try {
      const input: CreateContactWithAccountInput = {
        clientId: form.clientId,
        salutation: form.salutation || null,
        firstName: form.firstName || null,
        lastName: form.lastName.trim(),
        title: form.title || null,
        department: form.department || null,
        reportingTo: reportingToOk ? (form.reportingTo || null) : null,
        leadSource: form.leadSource || null,
        email: form.email || null,
        secondaryEmail: form.secondaryEmail || null,
        phone: form.phone || null,
        mobile: form.mobile || null,
        homePhone: form.homePhone || null,
        otherPhone: form.otherPhone || null,
        asstPhone: form.asstPhone || null,
        fax: form.fax || null,
        skypeId: form.skypeId || null,
        twitter: form.twitter || null,
        linkedinUrl: form.linkedinUrl || null,
        // Build at local midnight to avoid the UTC-shift round-trip bug.
        dateOfBirth: form.dateOfBirth
          ? (() => {
              const [y, m, d] = form.dateOfBirth.split('-').map(Number);
              return new Date(y, m - 1, d);
            })()
          : null,
        emailOptOut: form.emailOptOut,
        isPrimary: form.isPrimary,
        assistant: form.assistant || null,
        mailingStreet: form.mailingStreet || null,
        mailingCity: form.mailingCity || null,
        mailingState: form.mailingState || null,
        mailingZip: form.mailingZip || null,
        mailingCountry: form.mailingCountry || null,
        otherStreet: form.otherStreet || null,
        otherCity: form.otherCity || null,
        otherState: form.otherState || null,
        otherZip: form.otherZip || null,
        otherCountry: form.otherCountry || null,
        description: form.description || null,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      };
      await onSubmit(input);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save contact');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="w-[95vw] max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserIcon className="w-5 h-5 text-primary" />
            {contact ? `Edit Contact — ${contactDisplayName(contact)}` : 'Create Contact'}
          </DialogTitle>
          <DialogDescription>
            Account and Last Name are required.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-4">
          <Section title="Contact Information">
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
                    {CONTACT_SALUTATIONS.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">First Name</Label>
                <Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} maxLength={80} />
              </div>
              <div>
                <Label className="text-xs">Last Name <span className="text-destructive">*</span></Label>
                <Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} required maxLength={80} />
              </div>
            </Row>
            <Row>
              <div className="md:col-span-2">
                <Label className="text-xs flex items-center gap-1">
                  <Building2 className="w-3 h-3" /> Account <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={form.clientId}
                  onValueChange={(v) => {
                    // Reset reportingTo whenever the account changes —
                    // otherwise we'd persist a contactId from a different
                    // account, since the FK only enforces row existence
                    // and not same-client membership.
                    setForm((prev) => ({ ...prev, clientId: v, reportingTo: '' }));
                  }}
                  disabled={!!lockedAccountId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={accounts.length === 0
                      ? 'No accounts yet — create one first'
                      : 'Pick an account'} />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedAccounts.map((a) => (
                      <SelectItem key={a.clientId} value={a.clientId}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Title</Label>
                <Input value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={120} />
              </div>
            </Row>
            <Row>
              <div>
                <Label className="text-xs">Department</Label>
                <Input value={form.department} onChange={(e) => set('department', e.target.value)} maxLength={120} />
              </div>
              <div>
                <Label className="text-xs">Reporting To</Label>
                <Select
                  value={form.reportingTo || NONE}
                  onValueChange={(v) => set('reportingTo', v === NONE ? '' : v)}
                  disabled={!form.clientId || reportingChoices.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={form.clientId
                      ? (reportingChoices.length === 0
                          ? 'No other contacts on this account'
                          : '-None-')
                      : 'Pick an account first'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>-None-</SelectItem>
                    {reportingChoices.map((c) => (
                      <SelectItem key={c.contactId} value={c.contactId}>
                        {contactDisplayName(c)}{c.title ? ` (${c.title})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Lead Source</Label>
                <Select
                  value={form.leadSource || NONE}
                  onValueChange={(v) => set('leadSource', v === NONE ? '' : v)}
                >
                  <SelectTrigger><SelectValue placeholder="-None-" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>-None-</SelectItem>
                    {CONTACT_LEAD_SOURCE_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </Row>
          </Section>

          <Section title="Channels">
            <Row>
              <div>
                <Label className="text-xs">Email</Label>
                <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} maxLength={320} />
              </div>
              <div>
                <Label className="text-xs">Secondary Email</Label>
                <Input type="email" value={form.secondaryEmail} onChange={(e) => set('secondaryEmail', e.target.value)} maxLength={320} />
              </div>
              <div>
                <Label className="text-xs">Phone</Label>
                <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} maxLength={40} />
              </div>
            </Row>
            <Row>
              <div>
                <Label className="text-xs">Mobile</Label>
                <Input value={form.mobile} onChange={(e) => set('mobile', e.target.value)} maxLength={40} />
              </div>
              <div>
                <Label className="text-xs">Home Phone</Label>
                <Input value={form.homePhone} onChange={(e) => set('homePhone', e.target.value)} maxLength={40} />
              </div>
              <div>
                <Label className="text-xs">Other Phone</Label>
                <Input value={form.otherPhone} onChange={(e) => set('otherPhone', e.target.value)} maxLength={40} />
              </div>
            </Row>
            <Row>
              <div>
                <Label className="text-xs">Assistant</Label>
                <Input value={form.assistant} onChange={(e) => set('assistant', e.target.value)} maxLength={120} />
              </div>
              <div>
                <Label className="text-xs">Asst Phone</Label>
                <Input value={form.asstPhone} onChange={(e) => set('asstPhone', e.target.value)} maxLength={40} />
              </div>
              <div>
                <Label className="text-xs">Fax</Label>
                <Input value={form.fax} onChange={(e) => set('fax', e.target.value)} maxLength={40} />
              </div>
            </Row>
            <Row>
              <div>
                <Label className="text-xs">Skype ID</Label>
                <Input value={form.skypeId} onChange={(e) => set('skypeId', e.target.value)} maxLength={120} />
              </div>
              <div>
                <Label className="text-xs">Twitter</Label>
                <Input value={form.twitter} onChange={(e) => set('twitter', e.target.value)} placeholder="@handle" maxLength={80} />
              </div>
              <div>
                <Label className="text-xs">LinkedIn URL</Label>
                <Input value={form.linkedinUrl} onChange={(e) => set('linkedinUrl', e.target.value)} maxLength={320} />
              </div>
            </Row>
          </Section>

          <Section title="Personal">
            <Row>
              <div>
                <Label className="text-xs">Date of Birth</Label>
                <Input type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
              </div>
              <div className="flex items-end gap-3">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-border"
                    checked={form.emailOptOut}
                    onChange={(e) => set('emailOptOut', e.target.checked)}
                  />
                  Email Opt Out
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-border"
                    checked={form.isPrimary}
                    onChange={(e) => set('isPrimary', e.target.checked)}
                  />
                  Primary contact for this account
                </label>
              </div>
            </Row>
          </Section>

          <Section title="Address">
            <div className="flex items-center justify-end -mb-1">
              <button
                type="button"
                onClick={copyMailingToOther}
                className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
              >
                <Copy className="w-3 h-3" /> Copy Mailing → Other
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <AddressBlock
                label="Mailing"
                street={form.mailingStreet} city={form.mailingCity}
                state={form.mailingState} zip={form.mailingZip}
                country={form.mailingCountry}
                onChange={(field, value) => set((`mailing${field}` as keyof FormState), value)}
              />
              <AddressBlock
                label="Other"
                street={form.otherStreet} city={form.otherCity}
                state={form.otherState} zip={form.otherZip}
                country={form.otherCountry}
                onChange={(field, value) => set((`other${field}` as keyof FormState), value)}
              />
            </div>
          </Section>

          <Section title="Description">
            <Row>
              <div className="md:col-span-3">
                <Label className="text-xs">Description</Label>
                <Textarea
                  rows={3} maxLength={4000}
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
                  placeholder="vip, decision-maker"
                  maxLength={500}
                />
              </div>
            </Row>
          </Section>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {contact ? 'Save changes' : 'Create Contact'}
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
    <div className="space-y-3">{children}</div>
  </section>
);

const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="grid gap-3 md:grid-cols-3">{children}</div>
);

const AddressBlock: React.FC<{
  label: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  onChange: (field: 'Street' | 'City' | 'State' | 'Zip' | 'Country', value: string) => void;
}> = ({ label, street, city, state, zip, country, onChange }) => (
  <div className="rounded-md border p-3 space-y-2">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
    <div>
      <Label className="text-xs">{label} Street</Label>
      <Input value={street} onChange={(e) => onChange('Street', e.target.value)} maxLength={200} />
    </div>
    <div className="grid grid-cols-2 gap-2">
      <div>
        <Label className="text-xs">{label} City</Label>
        <Input value={city} onChange={(e) => onChange('City', e.target.value)} maxLength={120} />
      </div>
      <div>
        <Label className="text-xs">{label} State</Label>
        <Input value={state} onChange={(e) => onChange('State', e.target.value)} maxLength={120} />
      </div>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <div>
        <Label className="text-xs">{label} Zip</Label>
        <Input value={zip} onChange={(e) => onChange('Zip', e.target.value)} maxLength={40} />
      </div>
      <div>
        <Label className="text-xs">{label} Country</Label>
        <Input value={country} onChange={(e) => onChange('Country', e.target.value)} maxLength={120} />
      </div>
    </div>
  </div>
);
