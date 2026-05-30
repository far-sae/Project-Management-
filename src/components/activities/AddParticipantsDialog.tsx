import React, { useEffect, useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Search, X, Users, Mail } from 'lucide-react';
import { useOrganization } from '@/context/OrganizationContext';
import { getOrganizationContacts, type ContactWithAccount } from '@/services/supabase/contacts';
import type { MeetingParticipant } from '@/services/supabase/meetings';

interface AddParticipantsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string | null;
  value: MeetingParticipant[];
  onChange: (next: MeetingParticipant[]) => void;
}

type Source = 'contacts' | 'members';

/**
 * Zoho-style "Add Participants" sheet. Lets the user check a mix of
 * CRM Contacts and org Members, plus paste raw emails for external
 * invitees who aren't in the CRM yet. Returns the merged list as
 * MeetingParticipant[].
 */
export const AddParticipantsDialog: React.FC<AddParticipantsDialogProps> = ({
  open, onOpenChange, organizationId, value, onChange,
}) => {
  const { organization } = useOrganization();
  const [source, setSource] = useState<Source>('contacts');
  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState<ContactWithAccount[]>([]);
  const [includeNoEmail, setIncludeNoEmail] = useState(false);
  const [rawEmails, setRawEmails] = useState('');
  // Local copy so the parent only sees the new list when the user
  // clicks Done — matches Zoho's commit-on-close UX and avoids
  // unnecessary form re-renders mid-pick.
  const [draft, setDraft] = useState<MeetingParticipant[]>(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  useEffect(() => {
    if (!open || !organizationId) return;
    void getOrganizationContacts(organizationId).then(setContacts).catch(() => setContacts([]));
  }, [open, organizationId]);

  // Build the two picker lists. Filter by search + email-presence rule.
  const contactsList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts
      .filter((c) => includeNoEmail || c.email)
      .filter((c) => {
        if (!q) return true;
        const hay = [c.firstName, c.lastName, c.email, c.clientName].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
  }, [contacts, search, includeNoEmail]);

  const membersList = useMemo(() => {
    const q = search.trim().toLowerCase();
    const members = organization?.members ?? [];
    return members
      .filter((m) => m.status === 'active')
      .filter((m) => {
        if (!q) return true;
        return [m.displayName, m.email].filter(Boolean).join(' ').toLowerCase().includes(q);
      });
  }, [organization, search]);

  const has = (kind: MeetingParticipant['kind'], identifier: string) =>
    draft.some((p) => p.kind === kind && (
      (kind === 'contact' && p.id === identifier) ||
      (kind === 'user' && p.id === identifier) ||
      (kind === 'email' && (p.email ?? '').toLowerCase() === identifier.toLowerCase())
    ));

  const toggleContact = (c: ContactWithAccount) => {
    const id = c.contactId;
    if (has('contact', id)) {
      setDraft(draft.filter((p) => !(p.kind === 'contact' && p.id === id)));
    } else {
      setDraft([...draft, {
        kind: 'contact',
        id,
        name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Contact',
        email: c.email ?? null,
      }]);
    }
  };

  const toggleMember = (m: { userId: string; displayName: string; email: string }) => {
    if (has('user', m.userId)) {
      setDraft(draft.filter((p) => !(p.kind === 'user' && p.id === m.userId)));
    } else {
      setDraft([...draft, {
        kind: 'user', id: m.userId, name: m.displayName, email: m.email,
      }]);
    }
  };

  const handleDone = () => {
    // Merge the raw email box into the draft, dedup by email.
    const extras: MeetingParticipant[] = rawEmails
      .split(/[,\s;]+/)
      .map((s) => s.trim())
      .filter((s) => s.includes('@'))
      .filter((email) => !has('email', email))
      .map((email) => ({ kind: 'email' as const, name: email, email }));
    onChange([...draft, ...extras]);
    setRawEmails('');
    onOpenChange(false);
  };

  const removeFromDraft = (p: MeetingParticipant) => {
    setDraft(draft.filter((x) => x !== p));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" />
            Add Participants
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Select value={source} onValueChange={(v) => setSource(v as Source)}>
            <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="contacts">Contacts</SelectItem>
              <SelectItem value="members">Team members</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search" className="pl-7 h-9"
            />
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            Selected ({draft.length})
          </span>
        </div>

        <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
          {source === 'contacts' && contactsList.length === 0 && (
            <p className="px-3 py-6 text-sm text-muted-foreground text-center">
              No contacts match.
            </p>
          )}
          {source === 'contacts' && contactsList.map((c) => {
            const id = c.contactId;
            const checked = has('contact', id);
            return (
              <label key={id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/30">
                <input type="checkbox" checked={checked} onChange={() => toggleContact(c)} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {[c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Contact'}
                  </p>
                  {c.email && <p className="text-xs text-muted-foreground truncate">{c.email}</p>}
                </div>
              </label>
            );
          })}
          {source === 'members' && membersList.length === 0 && (
            <p className="px-3 py-6 text-sm text-muted-foreground text-center">
              No team members match.
            </p>
          )}
          {source === 'members' && membersList.map((m) => {
            const checked = has('user', m.userId);
            return (
              <label key={m.userId} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/30">
                <input type="checkbox" checked={checked} onChange={() => toggleMember(m)} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{m.displayName}</p>
                  {m.email && <p className="text-xs text-muted-foreground truncate">{m.email}</p>}
                </div>
              </label>
            );
          })}
        </div>

        {source === 'contacts' && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox" checked={includeNoEmail}
              onChange={(e) => setIncludeNoEmail(e.target.checked)}
            />
            Show contacts without email addresses
          </label>
        )}

        <div>
          <p className="text-xs font-medium mb-1 inline-flex items-center gap-1">
            <Mail className="w-3 h-3" /> Invite by email address
            <span className="text-muted-foreground font-normal">
              — use commas to separate
            </span>
          </p>
          <Input
            value={rawEmails} onChange={(e) => setRawEmails(e.target.value)}
            placeholder="jack@example.com, jane@example.com"
            className="h-9"
          />
        </div>

        {draft.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {draft.map((p, i) => (
              <Badge key={`${p.kind}:${p.id ?? p.email}:${i}`} variant="secondary" className="gap-1 pl-2 pr-1">
                {p.name}
                <button
                  type="button"
                  onClick={() => removeFromDraft(p)}
                  className="opacity-60 hover:opacity-100"
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleDone}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
