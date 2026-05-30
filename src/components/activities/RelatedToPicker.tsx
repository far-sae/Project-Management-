import React, { useEffect, useMemo, useState } from 'react';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Search, Link2, X } from 'lucide-react';
import { getOrganizationDeals, type Deal } from '@/services/supabase/deals';
import { getOrganizationClients, type Client } from '@/services/supabase/clients';
import { getOrganizationContacts, type ContactWithAccount } from '@/services/supabase/contacts';
import type { RelatedToType } from '@/services/supabase/meetings';

export interface RelatedTo {
  type: RelatedToType;
  id: string;
  label: string;
  /** Convenience: when the picked thing maps to a client or deal row,
   *  surface its id too so the calling form can populate client_id /
   *  deal_id directly (saves the parent another lookup). */
  clientId?: string | null;
  dealId?: string | null;
}

interface RelatedToPickerProps {
  organizationId: string | null;
  value: RelatedTo | null;
  onChange: (next: RelatedTo | null) => void;
  /** Optional: limit the picker to a subset of types. Default = all. */
  types?: RelatedToType[];
}

const TYPE_LABEL: Record<RelatedToType, string> = {
  deal: 'Deal',
  client: 'Account',
  contact: 'Contact',
  lead: 'Lead',
  account: 'Account',
};

/**
 * Zoho-style "Related To" lookup. Picks one of {Deal | Account | Contact}
 * (Lead support reserved — Leads are stored in `clients` with type='prospect'
 * in this codebase, so the Lead surface is folded into the Contact list).
 *
 * Loads all three sources lazily on first open and caches in component
 * state — the underlying services don't pre-fetch, and the picker only
 * matters when the form is being filled.
 */
export const RelatedToPicker: React.FC<RelatedToPickerProps> = ({
  organizationId, value, onChange, types,
}) => {
  const allowedTypes = types ?? ['deal', 'client', 'contact'];
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<RelatedToType>(allowedTypes[0]);
  const [search, setSearch] = useState('');
  const [deals, setDeals] = useState<Deal[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [contacts, setContacts] = useState<ContactWithAccount[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open || !organizationId || loaded) return;
    Promise.all([
      allowedTypes.includes('deal')    ? getOrganizationDeals(organizationId)    : Promise.resolve([]),
      allowedTypes.includes('client')  ? getOrganizationClients(organizationId)  : Promise.resolve([]),
      allowedTypes.includes('contact') ? getOrganizationContacts(organizationId) : Promise.resolve([]),
    ]).then(([d, c, k]) => {
      setDeals(d); setClients(c); setContacts(k); setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [open, organizationId, loaded, allowedTypes]);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (type === 'deal') {
      return deals
        .filter((d) => !q || d.title.toLowerCase().includes(q) || (d.clientName ?? '').toLowerCase().includes(q))
        .slice(0, 50)
        .map((d) => ({ id: d.dealId, label: d.title, sub: d.clientName ?? '—', clientId: d.clientId, dealId: d.dealId }));
    }
    if (type === 'client' || type === 'account') {
      return clients
        .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q))
        .slice(0, 50)
        .map((c) => ({ id: c.clientId, label: c.name, sub: c.email ?? c.industry ?? '—', clientId: c.clientId, dealId: null }));
    }
    if (type === 'contact' || type === 'lead') {
      return contacts
        .filter((c) => {
          if (!q) return true;
          return [c.firstName, c.lastName, c.email, c.clientName].filter(Boolean).join(' ').toLowerCase().includes(q);
        })
        .slice(0, 50)
        .map((c) => ({
          id: c.contactId,
          label: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Contact',
          sub: c.clientName ?? c.email ?? '—',
          clientId: c.clientId ?? null,
          dealId: null,
        }));
    }
    return [];
  }, [type, search, deals, clients, contacts]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 justify-start gap-2 min-w-[180px]">
          <Link2 className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="truncate flex-1 text-left text-xs">
            {value ? `${TYPE_LABEL[value.type]}: ${value.label}` : 'Related to…'}
          </span>
          {value && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onChange(null); }}
              className="opacity-60 hover:opacity-100"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start">
        <div className="flex gap-2 mb-2">
          <Select value={type} onValueChange={(v) => setType(v as RelatedToType)}>
            <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {allowedTypes.map((t) => (
                <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <Input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…" className="h-8 pl-7 text-xs"
              autoFocus
            />
          </div>
        </div>
        <div className="max-h-60 overflow-y-auto">
          {!loaded && <p className="text-xs text-muted-foreground px-2 py-3">Loading…</p>}
          {loaded && results.length === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-3">No matches.</p>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => {
                onChange({
                  type, id: r.id, label: r.label,
                  clientId: r.clientId ?? null,
                  dealId: r.dealId ?? null,
                });
                setOpen(false);
              }}
              className="w-full text-left px-2 py-1.5 rounded hover:bg-muted text-xs"
            >
              <p className="font-medium truncate">{r.label}</p>
              <p className="text-muted-foreground truncate">{r.sub}</p>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
