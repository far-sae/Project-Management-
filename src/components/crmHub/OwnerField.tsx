import React from 'react';
import { useOrganization } from '@/context/OrganizationContext';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

/** Select value standing in for "nobody" (Radix has no empty value). */
const NOBODY = '__nobody__';

/** The name shown for a person who owns a lead or a deal; "Former teammate" for someone who has left. */
export function ownerName(
  members: Array<{ userId: string; displayName?: string | null; email?: string | null }>,
  ownerId: string | null,
): string | null {
  if (!ownerId) return null;
  const person = members.find((m) => m.userId === ownerId);
  return person ? person.displayName || person.email || 'Teammate' : 'Former teammate';
}

/**
 * "Owner" in an edit dialog: who looks after this lead or deal. The choices
 * are the organisation's active members; a current owner who has since left
 * stays listed so saving something else does not quietly take the record away
 * from them.
 */
export const OwnerField: React.FC<{
  id: string;
  /** The owner's user id, or '' for nobody. */
  value: string;
  onChange: (ownerId: string) => void;
  disabled?: boolean;
}> = ({ id, value, onChange, disabled }) => {
  const { organization } = useOrganization();
  const active = (organization?.members ?? []).filter((m) => !m.status || m.status === 'active');
  const gone = value && !active.some((m) => m.userId === value);

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Owner</Label>
      <Select value={value || NOBODY} onValueChange={(v) => onChange(v === NOBODY ? '' : v)} disabled={disabled}>
        <SelectTrigger id={id}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NOBODY}>Nobody</SelectItem>
          {gone && <SelectItem value={value}>Former teammate</SelectItem>}
          {active.map((m) => (
            <SelectItem key={m.userId} value={m.userId}>{m.displayName || m.email}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
