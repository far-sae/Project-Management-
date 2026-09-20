import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, Users, Clipboard, FileSpreadsheet, Check, AlertTriangle, Upload, Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { loadFailureMessage } from '@/lib/email/schemaErrors';
import { LoadFailure } from './LoadFailure';
import { recipientKey, type RecipientMode } from './RecipientPicker';
import {
  contactsForCampaign, parsePastedRecipients, parseRecipientsCsv,
} from '@/services/supabase/email';
import type { Recipient } from '@/services/supabase/email';
import { listGroups } from '@/services/supabase/emailAudience';
import { dedupeRecipients, filterSuppressed, normalizeEmail } from '@/lib/email/suppression';
import type { EmailGroup, EmailSuppression, SuppressionReason } from '@/lib/email/types';

export type { RecipientMode };

/**
 * What the picker hands back on every change.
 *
 * `recipients` is de-duplicated but still carries suppressed addresses,
 * because `queueRecipients` runs `filterSuppressed` server-side and records
 * the result as the campaign's `suppressed_count`. Filtering them out here as
 * well would leave that column at zero and lose the only record that anybody
 * was held back. The number a PERSON is shown is `sendableCount`, which is
 * what actually goes out.
 */
export interface AudienceSelection {
  mode: RecipientMode;
  recipients: Recipient[];
  sendableCount: number;
  /** A CSV's own columns, so the caller can offer them as merge fields. */
  csvColumns: string[];
}

interface AudiencePickerProps {
  orgId: string;
  workspaceId: string | null;
  /**
   * The organization's suppression list, loaded by the caller because it is
   * also what the send itself is judged against. Carried whole rather than as
   * addresses: the exclusion line below has to say WHY somebody is held back,
   * and "48 unsubscribed" and "48 bounced" call for very different reactions.
   */
  suppressions: EmailSuppression[];
  /**
   * Must be referentially stable — it is a dependency of the effect that
   * reports the selection. A `useState` setter or a `useCallback` is fine.
   */
  onChange: (selection: AudienceSelection) => void;
}

const MODES: { value: RecipientMode; label: string; icon: React.ReactNode }[] = [
  { value: 'contacts', label: 'Prospects', icon: <Users className="w-4 h-4 mr-1.5" /> },
  { value: 'paste', label: 'Paste', icon: <Clipboard className="w-4 h-4 mr-1.5" /> },
  { value: 'csv', label: 'CSV', icon: <FileSpreadsheet className="w-4 h-4 mr-1.5" /> },
];

/**
 * The chip for contacts in no group at all.
 *
 * It is first in the row, and that is the point: people nobody has segmented
 * are the ones a group-shaped audience quietly leaves behind, and an audience
 * that can only be described by group can never be told they exist.
 */
const NO_GROUP = '__no_group__';

/** The same square the prospect list uses, so a checked row looks the same in both places. */
const RowCheckbox: React.FC<{ checked: boolean }> = ({ checked }) => (
  <div className={cn(
    'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
    checked ? 'bg-primary border-primary' : 'border-input',
  )}>
    {checked && <Check className="h-3 w-3 text-primary-foreground" />}
  </div>
);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const AudiencePicker: React.FC<AudiencePickerProps> = ({
  orgId, workspaceId, suppressions, onChange,
}) => {
  const [mode, setMode] = useState<RecipientMode>('contacts');

  const [contacts, setContacts] = useState<Recipient[]>([]);
  const [groups, setGroups] = useState<EmailGroup[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [loading, setLoading] = useState(false);
  /**
   * The load failure, kept in state rather than only shown as a toast — the
   * same contract the Prospects and Groups screens keep. The empty state
   * below is only reachable when this is null, so "no prospects yet" is never
   * shown for a read that failed.
   */
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);

  const [pasteText, setPasteText] = useState('');
  const [csvFileName, setCsvFileName] = useState('');
  const [csvText, setCsvText] = useState('');

  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    // Cleared on the way IN, so a retry that succeeds takes the error box away
    // rather than leaving a stale failure above fresh data.
    setLoadError(null);
    try {
      const [people, segments] = await Promise.all([
        contactsForCampaign(orgId, workspaceId),
        listGroups(orgId, workspaceId),
      ]);
      setContacts(people);
      setGroups(segments);
      // NOTHING is selected on load, deliberately.
      //
      // This used to select every contact the organisation has. A person
      // opening Compose to write one email was one click from sending it to
      // their entire list, and the only thing standing between them and that
      // was noticing a count they had not asked to be told. A send is not
      // undoable: the mail is gone.
      //
      // Choosing an audience is a decision, and a decision with no default is
      // the honest shape for it.
      setSelectedKeys(new Set());
    } catch (err) {
      // Not a toast as well: this box persists, and a toast for the same fact
      // would be gone by the time somebody looked for the cause.
      setLoadError(loadFailureMessage(err, 'Failed to load prospects'));
    } finally {
      setLoading(false);
    }
  }, [orgId, workspaceId]);

  // A different organisation or workspace is a different audience, so the read
  // is owed again — `load` changes identity with exactly those two and nothing
  // else.
  useEffect(() => { setAttempted(false); }, [load]);

  // Lazily, and once: somebody who pastes a list never pays for a read of the
  // whole contact table. `attempted` is set BEFORE the read rather than after
  // a successful one, because a failed read that left it false would have this
  // effect retry it forever.
  useEffect(() => {
    if (mode !== 'contacts' || attempted || loading) return;
    setAttempted(true);
    void load();
  }, [mode, attempted, loading, load]);

  /* ------------------------------------------------------------- grouping */

  /**
   * Contacts bucketed by their group's ID.
   *
   * By id and not by name, which is what an earlier version did: two groups
   * can be called the same thing, and a group renamed while somebody is
   * choosing an audience would silently stop matching the people it still
   * contains — the chip would empty and the selection with it, with nothing
   * on screen explaining why.
   *
   * `Recipient.groupId` is read from `select("*")`, so it is simply absent on
   * a database that has not run migration 162 and everybody lands in "No
   * group" rather than the whole list failing to load.
   */
  const buckets = useMemo(() => {
    const byId = new Map<string, Recipient[]>();
    const ungrouped: Recipient[] = [];
    for (const c of contacts) {
      const id = c.groupId;
      if (!id) { ungrouped.push(c); continue; }
      const existing = byId.get(id);
      if (existing) existing.push(c); else byId.set(id, [c]);
    }
    return { byId, ungrouped };
  }, [contacts]);

  const chips = useMemo(() => {
    const rows: { key: string; label: string; members: Recipient[] }[] = [
      { key: NO_GROUP, label: 'No group', members: buckets.ungrouped },
    ];
    for (const g of groups) {
      rows.push({ key: g.id, label: g.name, members: buckets.byId.get(g.id) ?? [] });
    }
    return rows;
  }, [groups, buckets]);

  /**
   * A chip is on when every one of its members is selected, rather than from
   * a flag of its own. Unchecking one person then turns the chip off by
   * itself, so the chip can never claim a whole segment is going out when it
   * is not — which is the exact lie this screen exists to stop telling.
   */
  const isGroupOn = useCallback(
    (members: Recipient[]) => members.length > 0 && members.every((m) => selectedKeys.has(recipientKey(m))),
    [selectedKeys],
  );

  const toggleGroup = (members: Recipient[]) => {
    const on = isGroupOn(members);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const m of members) {
        if (on) next.delete(recipientKey(m)); else next.add(recipientKey(m));
      }
      return next;
    });
  };

  const toggleContact = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  /* -------------------------------------------------------------- listing */

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (selectedOnly && !selectedKeys.has(recipientKey(c))) return false;
      if (!term) return true;
      return (c.name ?? '').toLowerCase().includes(term) || c.email.toLowerCase().includes(term);
    });
  }, [contacts, search, selectedOnly, selectedKeys]);

  // "All" and "None" act on what is on screen, never on what is hidden behind
  // a search — selecting somebody the person cannot see is how an audience
  // grows without anybody deciding it should.
  const selectAllVisible = () => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const c of visible) next.add(recipientKey(c));
      return next;
    });
  };

  const selectNoneVisible = () => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const c of visible) next.delete(recipientKey(c));
      return next;
    });
  };

  /* ------------------------------------------------------- the three modes */

  const pastedParsed = useMemo(() => parsePastedRecipients(pasteText), [pasteText]);
  const csvParsed = useMemo(
    () => (csvText ? parseRecipientsCsv(csvText) : { recipients: [] as Recipient[], errors: [] as string[] }),
    [csvText],
  );
  const csvColumns = useMemo(() => {
    const cols = new Set<string>();
    csvParsed.recipients.forEach((r) => Object.keys(r.mergeData).forEach((k) => cols.add(k)));
    return Array.from(cols);
  }, [csvParsed.recipients]);

  const chosen = useMemo<Recipient[]>(() => {
    if (mode === 'contacts') return contacts.filter((c) => selectedKeys.has(recipientKey(c)));
    if (mode === 'paste') return pastedParsed.recipients;
    return csvParsed.recipients;
  }, [mode, contacts, selectedKeys, pastedParsed, csvParsed]);

  /* ----------------------------------------------------------- the numbers */

  const deduped = useMemo(() => dedupeRecipients(chosen), [chosen]);
  const duplicates = chosen.length - deduped.length;

  const suppressionEmails = useMemo(() => suppressions.map((s) => s.email), [suppressions]);
  const { sendable, suppressed } = useMemo(
    () => filterSuppressed(deduped, suppressionEmails),
    [deduped, suppressionEmails],
  );

  const reasonByEmail = useMemo(() => {
    const map = new Map<string, SuppressionReason>();
    for (const s of suppressions) map.set(normalizeEmail(s.email), s.reason);
    return map;
  }, [suppressions]);

  /**
   * Every exclusion, counted and named.
   *
   * A silent exclusion is how somebody believes they mailed two hundred
   * people and mailed a hundred and forty. The number alone would not be
   * enough either: "sixty excluded" reads as a glitch, while "forty-eight
   * unsubscribed" reads as the list working — and the two call for opposite
   * reactions from the person about to press send.
   */
  const exclusions = useMemo(() => {
    const counts: Record<SuppressionReason, number> = {
      unsubscribed: 0, bounced: 0, complaint: 0, manual: 0,
    };
    for (const r of suppressed) {
      const reason = reasonByEmail.get(normalizeEmail(r.email));
      // An address held back with no reason we can name is still held back,
      // and it is counted somewhere rather than quietly dropped from the sum.
      counts[reason ?? 'manual'] += 1;
    }
    const parts: string[] = [];
    if (counts.unsubscribed) parts.push(`${counts.unsubscribed} unsubscribed`);
    if (counts.bounced) parts.push(`${counts.bounced} bounced`);
    if (counts.complaint) parts.push(`${counts.complaint} marked it as spam`);
    if (counts.manual) parts.push(`${counts.manual} suppressed by hand`);
    if (duplicates) parts.push(plural(duplicates, 'duplicate address', 'duplicate addresses'));
    return parts;
  }, [suppressed, reasonByEmail, duplicates]);

  const excludedTotal = suppressed.length + duplicates;

  useEffect(() => {
    onChange({ mode, recipients: deduped, sendableCount: sendable.length, csvColumns });
  }, [mode, deduped, sendable.length, csvColumns, onChange]);

  /* --------------------------------------------------------------- render */

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recipients</CardTitle>
        <p className="text-sm text-muted-foreground">
          Choose by group, or bring a list of your own. Nobody is selected until you say so.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          {MODES.map((m) => (
            <Button
              key={m.value}
              type="button"
              size="sm"
              variant={mode === m.value ? 'default' : 'outline'}
              onClick={() => setMode(m.value)}
            >
              {m.icon}{m.label}
            </Button>
          ))}
        </div>

        {mode === 'contacts' && (
          <div className="space-y-3">
            {/* The groups, as the thing you pick an audience WITH rather than
                a screen somewhere else. Before this, Compose offered the whole
                contact table and the segments people had actually built were
                unreachable from the one place they were for. */}
            {!loading && !loadError && chips.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Groups</p>
                <div className="flex flex-wrap gap-2">
                  {chips.map((chip) => {
                    const on = isGroupOn(chip.members);
                    return (
                      <Button
                        key={chip.key}
                        type="button"
                        size="sm"
                        variant={on ? 'default' : 'outline'}
                        // An empty segment has nothing to add to the audience,
                        // and a chip that does nothing when pressed is worse
                        // than one that says why it cannot.
                        disabled={chip.members.length === 0}
                        onClick={() => toggleGroup(chip.members)}
                      >
                        {on && <Check className="w-3.5 h-3.5 mr-1.5" />}
                        {chip.label}
                        <span className="ml-1.5 text-xs opacity-70">{chip.members.length}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative w-full sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name or email"
                  className="pl-9"
                />
              </div>
              <Button
                type="button"
                variant={selectedOnly ? 'default' : 'outline'}
                onClick={() => setSelectedOnly((v) => !v)}
              >
                <Users className="w-4 h-4 mr-2" />
                Selected only
              </Button>
            </div>

            <div className="rounded-lg border border-border">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40">
                <span className="text-sm font-medium">
                  {loading
                    ? 'Loading prospects…'
                    : `${visible.length} of ${plural(contacts.length, 'prospect', 'prospects')} shown`}
                </span>
                {!loading && !loadError && visible.length > 0 && (
                  <div className="flex gap-1">
                    <Button type="button" size="sm" variant="ghost" onClick={selectAllVisible}>Select all</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={selectNoneVisible}>Select none</Button>
                  </div>
                )}
              </div>
              {loading ? (
                <div className="text-center py-16 text-muted-foreground">
                  <Loader2 className="w-10 h-10 mx-auto mb-4 animate-spin text-muted-foreground/60" />
                  <p>Loading prospects...</p>
                </div>
              ) : loadError ? (
                /* Before every empty state, never after one: an empty state is
                   a statement that the request succeeded and found nothing. */
                <div className="p-3">
                  <LoadFailure message={loadError} onRetry={() => void load()} retrying={loading} />
                </div>
              ) : visible.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <Users className="w-14 h-14 mx-auto mb-4 text-muted-foreground/60" />
                  <p className="text-lg font-medium text-foreground">
                    {contacts.length === 0 ? 'No prospects yet' : 'No matches'}
                  </p>
                  <p className="text-sm">
                    {contacts.length === 0
                      ? 'Add someone on the Prospects tab to start building an audience.'
                      : 'Try a different search, or turn off "Selected only".'}
                  </p>
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto divide-y divide-border">
                  {visible.map((c) => {
                    const key = recipientKey(c);
                    const checked = selectedKeys.has(key);
                    const group = String(c.mergeData.group_name ?? '').trim();
                    return (
                      <div
                        key={key}
                        role="checkbox"
                        aria-checked={checked}
                        aria-label={`Select ${c.name || c.email}`}
                        tabIndex={0}
                        onClick={() => toggleContact(key)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleContact(key); } }}
                        className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-accent/50"
                      >
                        <RowCheckbox checked={checked} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm truncate">{c.name || c.email}</p>
                          {c.name && <p className="text-xs text-muted-foreground truncate">{c.email}</p>}
                        </div>
                        {group
                          ? <Badge variant="outline" className="max-w-[10rem] truncate shrink-0">{group}</Badge>
                          : <span className="text-xs text-muted-foreground shrink-0">No group</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {mode === 'paste' && (
          <div className="space-y-2">
            <Textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'jane@acme.com\nJohn Doe <john@acme.com>, sam@acme.com'}
              className="min-h-[120px] font-mono text-xs"
            />
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary">{pastedParsed.recipients.length} parsed</Badge>
              {pastedParsed.errors.length > 0 && (
                <Badge className="bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30">
                  <AlertTriangle className="w-3 h-3 mr-1" />{pastedParsed.errors.length} invalid
                </Badge>
              )}
            </div>
            {pastedParsed.errors.length > 0 && (
              <ul className="text-xs text-red-600 dark:text-red-400 list-disc pl-4 max-h-24 overflow-y-auto">
                {pastedParsed.errors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            )}
          </div>
        )}

        {mode === 'csv' && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 p-6 text-center transition-colors hover:border-primary hover:bg-muted"
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">{csvFileName || 'Click to choose a CSV file'}</p>
              <p className="text-xs text-muted-foreground">Needs an "email" column; other columns become merge fields.</p>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void f.text().then((t) => { setCsvFileName(f.name); setCsvText(t); });
                e.currentTarget.value = '';
              }}
            />
            {csvFileName && (
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary">{csvParsed.recipients.length} rows</Badge>
                {csvParsed.errors.length > 0 && (
                  <Badge className="bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30">
                    <AlertTriangle className="w-3 h-3 mr-1" />{csvParsed.errors.join(', ')}
                  </Badge>
                )}
                {csvColumns.length > 0 && (
                  <span className="text-xs text-muted-foreground">Columns: {csvColumns.join(', ')}</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Said once, and said last, because it is the only number that
            decides anything: what the chosen list becomes after the
            suppression list and the duplicates have taken their cut. */}
        <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-1">
          <p className="text-base font-semibold text-foreground">
            {plural(sendable.length, 'person', 'people')} will be emailed
          </p>
          {excludedTotal > 0 ? (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-orange-600 dark:text-orange-400" />
              <span>
                {excludedTotal} of the {chosen.length} you chose {excludedTotal === 1 ? 'is' : 'are'} excluded
                {' '}— {exclusions.join(', ')}. Suppressions are lifted on the Suppression tab.
              </span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Nobody is excluded: no duplicates, and nobody you chose is on the suppression list.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default AudiencePicker;
