import React from 'react';
import { X, Edit, Trash2, Building2, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InlineField } from '@/components/leads/InlineField';
import { ScoreBadge } from '@/components/clients/ScoreBadge';
import { AccountNotesSection } from '@/components/clients/AccountNotesSection';
import { Client, formatRevenue } from '@/services/supabase/clients';
import { cn } from '@/lib/utils';

interface Props {
  client: Client | null;
  organizationId: string | null;
  canManage: boolean;
  userId?: string;
  userName?: string;
  onClose: () => void;
  onEdit: (client: Client) => void;
  onDelete: (client: Client) => void;
  /** Persist a partial update + return the saved client (keeps the page live). */
  onUpdate?: (clientId: string, patch: Partial<Client>) => Promise<Client>;
}

const STATUS_CLASS = (status: Client['status']): string =>
  status === 'active'
    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
    : status === 'archived'
      ? 'bg-muted text-muted-foreground border-border'
      : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30';

/**
 * Business account record = a clean Business-details FORM and nothing else.
 * No activity/notes/pipeline/emails tabs, no leads — leads live on the
 * Accounts (category) side; you reach this page FROM a lead. Full-screen page
 * (opened at /clients/:clientId). Type/Status edit via the Edit dialog; the
 * rest are inline-editable here.
 */
export const BusinessAccountPage: React.FC<Props> = ({
  client, organizationId, canManage, userId, userName, onClose, onEdit, onDelete, onUpdate,
}) => {
  if (!client) return null;
  const canEdit = canManage && !!onUpdate;
  const save = async (patch: Partial<Client>): Promise<void> => {
    if (onUpdate) await onUpdate(client.clientId, patch);
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background" role="region" aria-label="Business account">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-card shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <X className="w-4 h-4" /> Close
        </button>
        <div className="h-5 w-px bg-border" />
        <Building2 className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground truncate">Business accounts</span>
        <span className="text-sm text-muted-foreground">/</span>
        <span className="text-sm font-semibold text-foreground truncate">{client.name}</span>
        <div className="ml-auto flex items-center gap-1">
          {canManage && (
            <>
              <Button variant="outline" size="sm" onClick={() => onEdit(client)}>
                <Edit className="w-3.5 h-3.5 mr-1" /> Edit
              </Button>
              <Button
                variant="ghost" size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => onDelete(client)}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Body — a single business-details form, centred */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-6 space-y-6">
          {/* Identity */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-primary-soft text-primary-soft-foreground flex items-center justify-center text-xl font-bold shrink-0">
              {client.name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold truncate">{client.name}</h1>
              <div className="flex items-center gap-1 flex-wrap mt-1">
                <Badge variant="outline" className="capitalize text-[10px]">{client.type}</Badge>
                <Badge className={cn('text-[10px]', STATUS_CLASS(client.status))}>{client.status}</Badge>
                {client.category && <Badge variant="secondary" className="text-[10px]">{client.category}</Badge>}
                {client.rating && (
                  <Badge variant="outline" className="text-[10px]"><Star className="w-3 h-3 mr-0.5" /> {client.rating}</Badge>
                )}
                <ScoreBadge score={client.score} band={client.scoreBand} />
              </div>
            </div>
          </div>

          {/* Business details */}
          <section className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Business details</h2>
            <InlineField label="Company name" value={client.name} editable={canEdit}
              onSave={(v) => save({ name: (typeof v === 'string' && v.trim()) ? v.trim() : client.name })} />
            <InlineField label="Legal name" value={client.legalName} editable={canEdit}
              onSave={(v) => save({ legalName: (v as string) || null })} />
            <InlineField label="Category" value={client.category} editable={canEdit}
              onSave={(v) => save({ category: (v as string) || null })} />
            <InlineField label="Industry" value={client.industry} editable={canEdit}
              onSave={(v) => save({ industry: (v as string) || null })} />
            <InlineField label="Email" value={client.email} editable={canEdit}
              onSave={(v) => save({ email: (v as string) || null })}
              render={(v) => v ? <a href={`mailto:${v}`} onClick={(e) => e.stopPropagation()} className="text-primary hover:underline break-all">{String(v)}</a> : null} />
            <InlineField label="Phone" value={client.phone} editable={canEdit}
              onSave={(v) => save({ phone: (v as string) || null })}
              render={(v) => v ? <a href={`tel:${v}`} onClick={(e) => e.stopPropagation()} className="hover:underline">{String(v)}</a> : null} />
            <InlineField label="Website" value={client.website} editable={canEdit}
              onSave={(v) => save({ website: (v as string) || null })} />
            <InlineField label="Annual revenue" type="number" value={client.annualRevenue} editable={canEdit}
              onSave={(v) => save({ annualRevenue: (v == null || v === '') ? null : Number(v) })}
              render={(v) => v == null || v === '' ? null : formatRevenue(Number(v))} />
            <InlineField label="Employees" type="number" value={client.employeeCount} editable={canEdit}
              onSave={(v) => save({ employeeCount: (v == null || v === '') ? null : Number(v) })} />
            <InlineField label="Source" value={client.source} editable={canEdit}
              onSave={(v) => save({ source: (v as string) || null })} />
            <InlineField label="Owner" value={client.accountOwnerName} editable={false} onSave={() => {}} />
          </section>

          {/* Address */}
          <section className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Address</h2>
            <InlineField label="Address" value={client.addressLine1} editable={canEdit}
              onSave={(v) => save({ addressLine1: (v as string) || null })} />
            <InlineField label="City" value={client.city} editable={canEdit}
              onSave={(v) => save({ city: (v as string) || null })} />
            <InlineField label="State" value={client.state} editable={canEdit}
              onSave={(v) => save({ state: (v as string) || null })} />
            <InlineField label="Postal code" value={client.postalCode} editable={canEdit}
              onSave={(v) => save({ postalCode: (v as string) || null })} />
            <InlineField label="Country" value={client.country} editable={canEdit}
              onSave={(v) => save({ country: (v as string) || null })} />
          </section>

          {/* Description */}
          <section className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</h2>
            <InlineField label="Description" type="textarea" value={client.description} editable={canEdit}
              onSave={(v) => save({ description: (v as string) || null })} />
          </section>

          {/* Notes — keep context on the business (separate from lead notes). */}
          <section className="rounded-lg border border-border bg-card p-4 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</h2>
            <AccountNotesSection
              clientId={client.clientId}
              organizationId={organizationId}
              userId={userId}
              userName={userName}
              canManage={canManage}
            />
          </section>
        </div>
      </div>
    </div>
  );
};
