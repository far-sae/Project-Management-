import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Phone, Mail, Star, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  DealContactRole,
  CreateDealContactRoleInput,
  UpdateDealContactRoleInput,
} from '@/services/supabase/dealRelations';
import type { ClientContact } from '@/services/supabase/clients';

const ROLE_OPTIONS = [
  'Decision Maker',
  'Influencer',
  'Champion',
  'Technical Buyer',
  'Economic Buyer',
  'User',
  'Other',
];

interface DealContactRolesCardProps {
  contactRoles: DealContactRole[];
  /** Pool of contacts the rep can pick from (typically the deal's account's
   *  contacts). */
  candidateContacts: ClientContact[];
  canManage: boolean;
  dealId: string;
  onAdd: (input: CreateDealContactRoleInput) => Promise<DealContactRole>;
  onPatch: (roleId: string, input: UpdateDealContactRoleInput) => Promise<DealContactRole>;
  onRemove: (roleId: string) => Promise<void>;
}

/**
 * Multi-contact roster on a deal (Decision Maker / Influencer / Champion /
 * etc.). One row per linked contact; same contact can't be added twice
 * (uniqueness enforced server-side too).
 */
export const DealContactRolesCard: React.FC<DealContactRolesCardProps> = ({
  contactRoles, candidateContacts, canManage, dealId,
  onAdd, onPatch, onRemove,
}) => {
  const [pickedContact, setPickedContact] = useState('none');
  const [pickedRole, setPickedRole] = useState('Decision Maker');
  const [busy, setBusy] = useState(false);
  const [busyRoleId, setBusyRoleId] = useState<string | null>(null);

  const contactsById = useMemo(() => {
    const map = new Map<string, ClientContact>();
    for (const c of candidateContacts) map.set(c.contactId, c);
    return map;
  }, [candidateContacts]);

  // Hide contacts already linked from the add dropdown.
  const linkedIds = useMemo(
    () => new Set(contactRoles.map((r) => r.contactId)),
    [contactRoles],
  );
  const eligible = useMemo(
    () => candidateContacts.filter((c) => !linkedIds.has(c.contactId)),
    [candidateContacts, linkedIds],
  );

  const handleAdd = async () => {
    if (pickedContact === 'none') return;
    setBusy(true);
    try {
      await onAdd({
        dealId,
        contactId: pickedContact,
        role: pickedRole,
        isPrimary: contactRoles.length === 0, // first contact is primary
      });
      setPickedContact('none');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add contact');
    } finally {
      setBusy(false);
    }
  };

  const handleSetPrimary = async (roleId: string) => {
    setBusyRoleId(roleId);
    try {
      // Clear primary on all others first; on the small set this is fine.
      for (const r of contactRoles) {
        if (r.isPrimary && r.roleId !== roleId) {
          await onPatch(r.roleId, { isPrimary: false });
        }
      }
      await onPatch(roleId, { isPrimary: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update primary');
    } finally {
      setBusyRoleId(null);
    }
  };

  const handleChangeRole = async (roleId: string, role: string) => {
    setBusyRoleId(roleId);
    try {
      await onPatch(roleId, { role });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update role');
    } finally {
      setBusyRoleId(null);
    }
  };

  const handleRemove = async (roleId: string, label: string) => {
    setBusyRoleId(roleId);
    try {
      await onRemove(roleId);
      toast.success(`Removed "${label}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove');
    } finally {
      setBusyRoleId(null);
    }
  };

  const labelFor = (c: ClientContact) =>
    [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || '(unnamed)';

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Contact Roles</h3>
        <span className="text-xs text-muted-foreground">{contactRoles.length}</span>
      </div>

      {canManage && (
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={pickedContact} onValueChange={setPickedContact}>
            <SelectTrigger className="flex-1 min-w-[180px]">
              <SelectValue placeholder={eligible.length === 0 ? 'No more contacts available' : 'Pick a contact'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Pick a contact —</SelectItem>
              {eligible.map((c) => (
                <SelectItem key={c.contactId} value={c.contactId}>{labelFor(c)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={pickedRole} onValueChange={setPickedRole}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={handleAdd} disabled={busy || pickedContact === 'none'} size="sm">
            {busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
            Add
          </Button>
        </div>
      )}

      {contactRoles.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No contact roles yet — link a contact to track who's involved.</p>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Contact Name</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Phone</th>
                <th className="px-3 py-2 font-medium">Email</th>
                {canManage && <th className="px-3 py-2"></th>}
              </tr>
            </thead>
            <tbody>
              {contactRoles.map((r) => {
                const c = contactsById.get(r.contactId);
                const name = c ? labelFor(c) : '(deleted contact)';
                return (
                  <tr key={r.roleId} className="border-t">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {r.isPrimary && <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />}
                        <span className="font-medium">{name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {canManage ? (
                        <Select value={r.role ?? ''} onValueChange={(v) => handleChangeRole(r.roleId, v)}>
                          <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline">{r.role ?? '—'}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {c?.phone ? (
                        <span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone}</span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {c?.email ? (
                        <a href={`mailto:${c.email}`} className="text-primary hover:underline inline-flex items-center gap-1">
                          <Mail className="w-3 h-3" />{c.email}
                        </a>
                      ) : '—'}
                    </td>
                    {canManage && (
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1 justify-end">
                          {!r.isPrimary && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyRoleId === r.roleId}
                              onClick={() => handleSetPrimary(r.roleId)}
                              title="Mark primary"
                            >
                              <Star className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            disabled={busyRoleId === r.roleId}
                            onClick={() => handleRemove(r.roleId, name)}
                          >
                            {busyRoleId === r.roleId ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
