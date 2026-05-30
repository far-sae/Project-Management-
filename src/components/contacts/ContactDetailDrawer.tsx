import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  X, Edit, Trash2, Mail, MoreVertical, ChevronDown, ChevronUp,
  Copy, Printer, FileSearch, RefreshCw, Paperclip,
  Briefcase, User as UserIcon, Building2,
  ExternalLink, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ContactWithAccount, contactDisplayName,
  getReportingContacts,
} from '@/services/supabase/contacts';
import type { Client } from '@/services/supabase/clients';
import { EntityActivitiesSection } from '@/components/activities/EntityActivitiesSection';
import { AccountNotesSection } from '@/components/activities/AccountNotesSection';

interface Props {
  contact: ContactWithAccount | null;
  organizationId: string | null;
  canManage: boolean;
  parentAccount?: Client | null;
  /** Allow-list of client IDs in the current workspace. When provided, the
   *  Reporting Contacts list filters edges to contacts whose parent
   *  account is in this set, matching the workspace-scoping contract the
   *  rest of the contacts UI honours. Pass null for cross-workspace
   *  (All-workspaces) views. */
  visibleClientIds?: string[] | null;
  onClose: () => void;
  onEdit: (c: ContactWithAccount) => void;
  onDelete: (c: ContactWithAccount) => void;
  onClone: (c: ContactWithAccount) => void;
  onSendEmail: (c: ContactWithAccount) => void;
  onOpenAccount?: (clientId: string) => void;
}

export const ContactDetailDrawer: React.FC<Props> = ({
  contact, organizationId, canManage, parentAccount, visibleClientIds,
  onClose, onEdit, onDelete, onClone, onSendEmail, onOpenAccount,
}) => {
  const [showAllDetails, setShowAllDetails] = useState(false);
  const [reportingContacts, setReportingContacts] = useState<ContactWithAccount[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);

  useEffect(() => {
    if (!contact || !organizationId) {
      setReportingContacts([]);
      return;
    }
    let cancelled = false;
    setLoadingReports(true);
    getReportingContacts(organizationId, contact.contactId, {
      allowedClientIds: visibleClientIds,
    })
      .then((rows) => { if (!cancelled) setReportingContacts(rows); })
      .finally(() => { if (!cancelled) setLoadingReports(false); });
    return () => { cancelled = true; };
  }, [contact?.contactId, organizationId, visibleClientIds]);

  if (!contact || !organizationId) return null;

  const displayName = contactDisplayName(contact);
  const mailingAddress = [
    contact.mailingStreet,
    [contact.mailingCity, contact.mailingState].filter(Boolean).join(', '),
    [contact.mailingZip, contact.mailingCountry].filter(Boolean).join(' '),
  ].filter((s) => !!(s && s.trim())).join(', ');

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />

      <aside className="relative ml-auto h-full w-full sm:w-[92vw] sm:max-w-[1200px] bg-background border-l border-border shadow-xl flex flex-col animate-in slide-in-from-right-2 duration-200">
        {/* Top bar */}
        <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-card">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            <X className="w-4 h-4" /> Close
          </button>
          <div className="h-5 w-px bg-border" />
          <div className="flex items-center gap-2 min-w-0">
            <UserIcon className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Contacts</span>
            <span className="text-sm text-muted-foreground">/</span>
            <span className="text-sm font-semibold text-foreground truncate">
              {displayName}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {canManage && (
              <>
                <Button variant="outline" size="sm" onClick={() => onSendEmail(contact)}>
                  <Mail className="w-3.5 h-3.5 mr-1" /> Send Email
                </Button>
                <Button variant="outline" size="sm" onClick={() => onEdit(contact)}>
                  <Edit className="w-3.5 h-3.5 mr-1" /> Edit
                </Button>
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <MoreVertical className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => onClone(contact)} disabled={!canManage}>
                  <Copy className="w-4 h-4 mr-2" /> Clone
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDelete(contact)}
                  disabled={!canManage}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="w-4 h-4 mr-2" /> Delete
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => window.print()}>
                  <Printer className="w-4 h-4 mr-2" /> Print Preview
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <FileSearch className="w-4 h-4 mr-2" /> Find and Merge Duplicates
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <RefreshCw className="w-4 h-4 mr-2" /> Review History
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Body — 2 columns: nav, content */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)]">
          {/* LEFT nav */}
          <aside className="border-r border-border bg-card/40 overflow-y-auto p-3 space-y-3 text-sm">
            <p className="font-semibold text-foreground">Info</p>
            <p className="text-muted-foreground opacity-50 cursor-not-allowed" title="Coming soon">
              Timeline
            </p>
            <div className="border-t border-border pt-2 space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Related list
              </p>
              {[
                { label: 'Notes',              anchor: 'contact-notes-section' },
                { label: 'Attachments',        anchor: 'contact-attachments-section' },
                { label: 'Deals',              anchor: 'contact-deals-section' },
                { label: 'Open Activities',    anchor: 'contact-open-activities-section' },
                { label: 'Reporting Contacts', anchor: 'contact-reporting-section', count: reportingContacts.length },
                { label: 'Closed Activities',  anchor: 'contact-closed-activities-section' },
                { label: 'Invited Meetings',   anchor: null as string | null },
                { label: 'Emails',             anchor: 'contact-emails-section' },
                { label: 'Campaigns',          anchor: null as string | null },
                { label: 'Social',             anchor: null as string | null },
              ].map((row) => {
                const wired = row.anchor != null;
                const cls = wired
                  ? 'flex items-center justify-between text-muted-foreground hover:text-foreground cursor-pointer'
                  : 'flex items-center justify-between text-muted-foreground opacity-50 cursor-not-allowed';
                return (
                  <div
                    key={row.label}
                    className={cls}
                    onClick={() => {
                      if (!wired) return;
                      document.getElementById(row.anchor!)?.scrollIntoView({
                        behavior: 'smooth', block: 'start',
                      });
                    }}
                    title={wired ? undefined : 'Coming soon'}
                  >
                    <span>{row.label}</span>
                    {row.count != null && (
                      <Badge variant="outline" className="text-[9px]">{row.count}</Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>

          {/* RIGHT content */}
          <section className="overflow-y-auto p-5 space-y-6">
            {/* Identity card */}
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-orange-400 to-pink-400 text-white grid place-items-center text-xl font-bold shrink-0">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-xl md:text-2xl font-bold truncate">
                  {displayName}
                </h2>
                {contact.title && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {contact.title}
                    {contact.department && <span> · {contact.department}</span>}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {contact.clientName && onOpenAccount && (
                    <Badge
                      variant="outline"
                      className="text-[10px] cursor-pointer hover:bg-muted/40"
                      onClick={() => onOpenAccount(contact.clientId)}
                    >
                      <Building2 className="w-3 h-3 mr-1" />
                      {contact.clientName}
                      <ExternalLink className="w-2.5 h-2.5 ml-1 opacity-60" />
                    </Badge>
                  )}
                  {contact.isPrimary && (
                    <Badge variant="outline" className="text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30">
                      Primary contact
                    </Badge>
                  )}
                  {contact.leadSource && (
                    <Badge variant="outline" className="text-[10px]">
                      Source: {contact.leadSource}
                    </Badge>
                  )}
                  {contact.emailOptOut && (
                    <Badge variant="outline" className="text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30">
                      Email opt-out
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Quick info */}
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Field label="Contact Owner" value={contact.ownerName} />
              <Field label="Email" value={contact.email ? (
                <a href={`mailto:${contact.email}`} className="text-primary hover:underline">
                  {contact.email}
                </a>
              ) : null} />
              <Field label="Phone" value={contact.phone ? (
                <a href={`tel:${contact.phone}`} className="hover:underline">{contact.phone}</a>
              ) : null} />
              <Field label="Mobile" value={contact.mobile ? (
                <a href={`tel:${contact.mobile}`} className="hover:underline">{contact.mobile}</a>
              ) : null} />
              <Field label="Department" value={contact.department} />
              <Field label="Reporting To" value={contact.reportingToName} />
            </div>

            <button
              type="button"
              onClick={() => setShowAllDetails((v) => !v)}
              className="text-xs font-semibold uppercase tracking-wide text-primary hover:underline inline-flex items-center gap-1"
            >
              {showAllDetails ? 'Hide details' : 'Show details'}
              {showAllDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>

            {showAllDetails && (
              <div className="grid md:grid-cols-2 gap-x-6 gap-y-3 text-sm border-t pt-4">
                <Field label="Secondary Email" value={contact.secondaryEmail} />
                <Field label="Home Phone" value={contact.homePhone} />
                <Field label="Other Phone" value={contact.otherPhone} />
                <Field label="Fax" value={contact.fax} />
                <Field label="Assistant" value={contact.assistant} />
                <Field label="Asst Phone" value={contact.asstPhone} />
                <Field label="Skype" value={contact.skypeId} />
                <Field label="Twitter" value={contact.twitter} />
                <Field label="LinkedIn" value={contact.linkedinUrl ? (
                  <a href={contact.linkedinUrl} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
                    {contact.linkedinUrl}
                  </a>
                ) : null} />
                <Field
                  label="Date of Birth"
                  value={contact.dateOfBirth ? format(contact.dateOfBirth, 'PP') : null}
                />
                <Field label="Mailing Address" value={mailingAddress || null} />
                {parentAccount && (
                  <Field
                    label="Account Industry"
                    value={parentAccount.industry ?? null}
                  />
                )}
                <Field label="Created" value={format(contact.createdAt, 'PPp')} />
                <Field label="Updated" value={format(contact.updatedAt, 'PPp')} />
                {contact.description && (
                  <div className="md:col-span-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Description</p>
                    <p className="whitespace-pre-wrap">{contact.description}</p>
                  </div>
                )}
                {contact.tags.length > 0 && (
                  <div className="md:col-span-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Tags</p>
                    <div className="flex flex-wrap gap-1">
                      {contact.tags.map((t) => (
                        <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Related lists (Zoho's vertical sections) — wired to
                real data wherever the underlying tables exist. */}
            <div id="contact-notes-section">
              <AccountNotesSection
                organizationId={organizationId}
                clientId={contact.clientId ?? null}
                canCompose={canManage}
                entityLabel="this contact"
              />
            </div>
            <div id="contact-attachments-section">
              <RelatedPlaceholder
                icon={Paperclip}
                title="Attachments"
                empty="File attachments aren't enabled on contact records yet."
              />
            </div>
            <div id="contact-deals-section">
              <RelatedPlaceholder
                icon={Briefcase}
                title="Deals"
                empty="Deals on the parent account will be linked here in a future build. Open the account to see its pipeline."
              />
            </div>
            <div id="contact-open-activities-section">
              <EntityActivitiesSection
                entityKind="contact"
                entityName={contactDisplayName(contact)}
                entityId={contact.contactId}
                clientId={contact.clientId ?? null}
                mode="open"
                readOnly={!canManage}
              />
            </div>
            <div id="contact-reporting-section">
              <ReportingSection
                rows={reportingContacts}
                loading={loadingReports}
              />
            </div>
            <div id="contact-closed-activities-section">
              <EntityActivitiesSection
                entityKind="contact"
                entityName={contactDisplayName(contact)}
                entityId={contact.contactId}
                clientId={contact.clientId ?? null}
                mode="closed"
                readOnly
              />
            </div>
            <div id="contact-emails-section">
              <RelatedPlaceholder
                icon={Mail}
                title="Emails"
                empty="Use Send Email above to email this contact. A per-contact email log will appear here in a future build."
              />
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
};

const Field: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="grid grid-cols-[140px_1fr] items-baseline gap-2">
    <span className="text-[11px] uppercase tracking-wide text-muted-foreground text-right">{label}</span>
    <span className="text-foreground truncate">
      {value == null || value === '' ? <span className="text-muted-foreground">—</span> : value}
    </span>
  </div>
);

// Strictly informational empty-state for related-list slots whose
// feature isn't wired yet. No fake CTAs — the user's complaint was
// "no fake buttons", so anything live goes through a real section
// component (AccountNotesSection / EntityActivitiesSection).
const RelatedPlaceholder: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  empty: string;
}> = ({ icon: Icon, title, empty }) => (
  <div>
    <h3 className="text-sm font-semibold flex items-center gap-2 border-b pb-1.5 mb-2">
      <Icon className="w-4 h-4 text-muted-foreground" /> {title}
    </h3>
    <p className="text-xs text-muted-foreground">{empty}</p>
  </div>
);

const ReportingSection: React.FC<{
  rows: ContactWithAccount[];
  loading: boolean;
}> = ({ rows, loading }) => (
  <div>
    <h3 className="text-sm font-semibold flex items-center gap-2 border-b pb-1.5 mb-2">
      <UserIcon className="w-4 h-4 text-muted-foreground" />
      Reporting Contacts
      {rows.length > 0 && (
        <Badge variant="outline" className="text-[10px]">{rows.length}</Badge>
      )}
    </h3>
    {loading ? (
      <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
        <Loader2 className="w-3 h-3 animate-spin" /> Loading…
      </p>
    ) : rows.length === 0 ? (
      <p className="text-xs text-muted-foreground">
        No one reports to this contact yet. Add a teammate and set their
        "Reporting To" to this contact to build a reporting tree.
      </p>
    ) : (
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.contactId} className="rounded-md border p-2 bg-card flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-gradient-to-br from-orange-400 to-pink-400 text-white grid place-items-center shrink-0 text-[10px] font-bold">
              {contactDisplayName(r).charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{contactDisplayName(r)}</p>
              {r.title && (
                <p className="text-[11px] text-muted-foreground truncate">{r.title}</p>
              )}
            </div>
            {r.email && (
              <a
                href={`mailto:${r.email}`}
                className="text-[11px] text-primary hover:underline truncate max-w-[160px]"
              >
                {r.email}
              </a>
            )}
          </li>
        ))}
      </ul>
    )}
  </div>
);
