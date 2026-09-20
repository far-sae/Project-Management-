import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, Send, SendHorizonal, Info } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import {
  listAccounts, listMailboxStatus, listSuppressions, contactsForCampaign, createCampaign,
  queueRecipients, setCampaignStatus, parsePastedRecipients, parseRecipientsCsv,
} from '@/services/supabase/email';
import type { Recipient } from '@/services/supabase/email';
import type { EmailAccount, EmailTemplate, MailboxHealth } from '@/lib/email/types';
import { isUsable } from '@/lib/email/mailboxPool';
import { filterSuppressed } from '@/lib/email/suppression';
import { verifyAccount } from './verifyAccount';
import { RecipientPicker, recipientKey, type RecipientMode } from './RecipientPicker';
import { RichTextEditor } from './RichTextEditor';

interface ComposeTabProps {
  orgId: string;
  workspaceId: string | null;
  isAdmin: boolean;
  onSent: () => void;
  /**
   * A template whose wording should be loaded into the form, or null.
   *
   * Cleared by `onTemplateLoaded` the moment it is applied, so that picking
   * the same template a second time is a change this component can see — and
   * so that coming back to this tab later never silently overwrites what the
   * person has since typed.
   */
  pendingTemplate: EmailTemplate | null;
  onTemplateLoaded: () => void;
}

/**
 * The sending-account select's value for "use the whole pool", i.e. a
 * campaign whose `account_id` is null. A sentinel rather than the empty
 * string because Radix's Select reserves `''` for "nothing chosen" and
 * refuses it as an item value.
 *
 * This is the default: migration 156 made `email_campaigns.account_id`
 * nullable precisely so a campaign could rotate across the pool, and nothing
 * else in the product ever produces a null, so without this option the pool,
 * the rotation and the per-mailbox warmup ramp would never apply to a real
 * campaign at all.
 */
const WHOLE_POOL = '__whole_pool__';

/**
 * `templateId` is where the wording was copied FROM, and nothing more: the
 * subject and body beside it are what actually gets sent, so a template edited
 * after this campaign is created cannot rewrite it.
 */
const EMPTY_FORM = {
  name: '', accountId: WHOLE_POOL, subject: '', bodyHtml: '',
  templateId: null as string | null,
};

export const ComposeTab: React.FC<ComposeTabProps> = ({
  orgId, workspaceId, isAdmin, onSent, pendingTemplate, onTemplateLoaded,
}) => {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  // Pool health, which is a different question from "did the credentials ever
  // verify": a mailbox struck out of rotation still has status 'active'.
  const [mailboxes, setMailboxes] = useState<MailboxHealth[]>([]);
  const [suppressionEmails, setSuppressionEmails] = useState<string[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);

  const [mode, setMode] = useState<RecipientMode>('contacts');
  const [contacts, setContacts] = useState<Recipient[]>([]);
  const [contactsLoaded, setContactsLoaded] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [selectedContactKeys, setSelectedContactKeys] = useState<Set<string>>(new Set());
  const [pasteText, setPasteText] = useState('');
  const [csvFileName, setCsvFileName] = useState('');
  const [csvText, setCsvText] = useState('');

  const [scheduleMode, setScheduleMode] = useState<'now' | 'schedule'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [sending, setSending] = useState(false);
  const [testSending, setTestSending] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    listAccounts(orgId)
      .then(setAccounts)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load sending accounts'));
    listMailboxStatus(orgId)
      .then(setMailboxes)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load mailbox health'));
    listSuppressions(orgId)
      .then((rows) => setSuppressionEmails(rows.map((r) => r.email)))
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load suppression list'));
  }, [orgId]);

  // Copies the template's wording in and records which template it came from.
  // A copy, not a link: from here on the campaign carries this text, so the
  // person is free to rewrite any of it and editing the template later changes
  // nothing that has already been composed or sent. The campaign name is only
  // filled in when it is still blank, because it is the one field somebody may
  // already have typed before reaching for a template.
  useEffect(() => {
    if (!pendingTemplate) return;
    setForm((f) => ({
      ...f,
      name: f.name.trim() ? f.name : pendingTemplate.name,
      subject: pendingTemplate.subject,
      bodyHtml: pendingTemplate.bodyHtml,
      templateId: pendingTemplate.id,
    }));
    onTemplateLoaded();
    toast.success(`Loaded "${pendingTemplate.name}" — edit it freely, the template is untouched`);
  }, [pendingTemplate, onTemplateLoaded]);

  useEffect(() => {
    if (mode !== 'contacts' || contactsLoaded || !orgId) return;
    setContactsLoading(true);
    contactsForCampaign(orgId, workspaceId)
      .then((list) => {
        setContacts(list);
        // NOTHING is selected on load, deliberately.
        //
        // This used to select every contact the organisation has. A person
        // opening Compose to write one email was one click from sending it to
        // their entire list, and the only thing standing between them and that
        // was noticing a count they had not asked to be told. A send is not
        // undoable: the mail is gone.
        //
        // Choosing an audience is a decision, and a decision with no default
        // is the honest shape for it.
        setSelectedContactKeys(new Set());
        setContactsLoaded(true);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load contacts'))
      .finally(() => setContactsLoading(false));
  }, [mode, contactsLoaded, orgId, workspaceId]);

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

  const activeRecipients = useMemo<Recipient[]>(() => {
    if (mode === 'contacts') return contacts.filter((c) => selectedContactKeys.has(recipientKey(c)));
    if (mode === 'paste') return pastedParsed.recipients;
    return csvParsed.recipients;
  }, [mode, contacts, selectedContactKeys, pastedParsed, csvParsed]);

  const { sendable, suppressed } = useMemo(
    () => filterSuppressed(activeRecipients, suppressionEmails),
    [activeRecipients, suppressionEmails],
  );

  const mergeFields = useMemo(() => {
    // What contactsForCampaign actually puts in each recipient's merge data.
    // `pain_point` and the group's `angle` are why phase 5 exists: a cold
    // email that names the problem and leads with the angle for that segment
    // is the difference between outreach and a mailshot. They are offered only
    // for contact-sourced recipients, because a pasted list or a CSV has
    // neither — and offering a placeholder that resolves to nothing is how a
    // message goes out with a gap where a sentence should be.
    const contactFields = [
      'first_name', 'last_name', 'full_name', 'email',
      'job_title', 'pain_point', 'angle', 'group_name',
    ];
    if (mode === 'csv') {
      const base = ['first_name', 'last_name', 'full_name', 'email'];
      return [...base, ...csvColumns.filter((c) => !base.includes(c))];
    }
    if (mode === 'paste') return ['email'];
    return contactFields;
  }, [mode, csvColumns]);

  const activeAccounts = accounts.filter((a) => a.status === 'active');
  const usesPool = form.accountId === WHOLE_POOL;
  // Null whenever the pool is chosen: there is no one mailbox to name, and
  // everything that needs a specific one (the test send) must see that.
  const selectedAccount = usesPool
    ? null
    : (accounts.find((a) => a.id === form.accountId) ?? null);

  // Credential status alone is not usability. A mailbox struck out of rotation
  // by three consecutive failures keeps status 'active' while `is_active` goes
  // false and `paused_reason` fills in — so a pool with every mailbox paused
  // still counted as having active accounts, and the campaign was created to
  // sit queued behind nothing that could ever claim it. `isUsable` asks the
  // question that matters: is anything in rotation? Today's allowance is
  // deliberately not part of it — a pool that has sent its quota resumes at
  // midnight, and queueing for that is exactly right.
  const usableIds = useMemo(
    () => new Set(mailboxes.filter(isUsable).map((m) => m.id)),
    [mailboxes],
  );

  const canSendFrom = usesPool
    ? usableIds.size > 0
    : !!selectedAccount && usableIds.has(selectedAccount.id);

  const noneUsable = activeAccounts.length === 0
    ? 'No verified mailbox to send from — add one on the Accounts tab first.'
    : 'Every mailbox is paused or needs re-verifying, so nothing would go out. '
      + 'Fix one on the Accounts tab first.';

  const sendsFrom = usesPool
    ? (usableIds.size > 0
      ? `Sends from the whole pool — ${usableIds.size} mailbox${usableIds.size === 1 ? '' : 'es'} in rotation, least recently used first.`
      : noneUsable)
    : (!selectedAccount
      ? 'That mailbox is no longer available — choose another.'
      : usableIds.has(selectedAccount.id)
        ? `Sends from ${selectedAccount.label} (${selectedAccount.fromEmail}) only.`
        : `${selectedAccount.label} is paused or needs re-verifying, so nothing would go out from it.`);

  const scheduledDate = scheduleMode === 'schedule' && scheduledAt ? new Date(scheduledAt) : null;
  const scheduleInPast = scheduleMode === 'schedule' && !!scheduledDate && scheduledDate.getTime() <= Date.now();

  const canSubmit = canSendFrom
    && form.subject.trim().length > 0 && form.bodyHtml.trim().length > 0
    && sendable.length > 0 && !sending
    && (scheduleMode === 'now' || (scheduledAt.length > 0 && !scheduleInPast));

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setPasteText('');
    setCsvFileName('');
    setCsvText('');
    setScheduleMode('now');
    setScheduledAt('');
  };

  const toggleContact = (key: string) => {
    setSelectedContactKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleTestSend = async () => {
    if (!isAdmin || !selectedAccount) return;
    setTestSending(true);
    const result = await verifyAccount(selectedAccount.id);
    if (result.ok) toast.success(`Test email sent to ${user?.email ?? 'your inbox'}`);
    else toast.error(result.error ?? 'Test send failed');
    setTestSending(false);
  };

  const handleSubmit = async () => {
    if (!canSubmit || !orgId) return;
    if (scheduleMode === 'schedule' && scheduleInPast) {
      toast.error('Pick a schedule time in the future.');
      return;
    }
    setSending(true);
    try {
      const campaign = await createCampaign({
        organizationId: orgId,
        workspaceId,
        createdBy: user?.userId ?? null,
        // Null is the whole pool: claim_email_batch() then hands this
        // campaign's rows to whichever mailbox is next in rotation, instead of
        // pinning every message to one address.
        accountId: usesPool ? null : (selectedAccount?.id ?? null),
        kind: activeRecipients.length === 1 ? 'single' : 'bulk',
        name: form.name.trim() || form.subject.trim(),
        subject: form.subject.trim(),
        bodyHtml: form.bodyHtml,
        scheduledAt: scheduledDate,
        // Provenance, so the Templates tab can total this campaign's sends
        // against the wording it started from. The subject and body above are
        // the campaign's own and stay that way.
        templateId: form.templateId,
      });

      // Recipients are queued first, then the campaign is flipped out of
      // draft — the worker must never see a claimable campaign with no rows
      // yet. `scheduledDate` becomes every row's `send_after`, so a
      // scheduled campaign's messages aren't claimable until that time
      // (claim_email_batch only gates on send_after <= now() and status).
      const { queued, suppressed: suppressedCount } = await queueRecipients(
        campaign.id, orgId, activeRecipients, scheduledDate,
      );

      // createCampaign inserts with the table's default status ('draft').
      // claim_email_batch only claims messages whose campaign status is
      // 'sending' or 'scheduled', so the campaign has to be flipped out of
      // draft now that its outbox rows exist.
      await setCampaignStatus(campaign.id, scheduleMode === 'schedule' ? 'scheduled' : 'sending');

      toast.success(
        `Queued ${queued} message${queued === 1 ? '' : 's'}${suppressedCount ? `, ${suppressedCount} suppressed` : ''}`,
      );
      resetForm();
      onSent();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create campaign');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>Message</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cmp-name">Campaign name</Label>
              <Input id="cmp-name" value={form.name} placeholder="September newsletter"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Sending account</Label>
              <Select value={form.accountId} onValueChange={(v) => setForm((f) => ({ ...f, accountId: v }))}>
                <SelectTrigger><SelectValue placeholder="Choose an active account" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={WHOLE_POOL}>Whole pool (rotate across every mailbox)</SelectItem>
                  {activeAccounts.length === 0
                    ? <div className="px-3 py-2 text-sm text-muted-foreground">No active accounts — verify one first</div>
                    : activeAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.label} ({a.fromEmail})</SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{sendsFrom}</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cmp-subject">Subject</Label>
            <Input id="cmp-subject" value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label>Body</Label>
            {/* The merge fields offered here are the ones this campaign's
                recipients actually carry — a CSV's own columns included — so
                the menu never offers a field that would substitute to nothing. */}
            <RichTextEditor
              value={form.bodyHtml} mergeFields={mergeFields}
              placeholder="Write the message. Source shows the raw HTML."
              onChange={(html) => setForm((f) => ({ ...f, bodyHtml: html }))}
            />
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Personalize with {mergeFields.map((f) => `{{${f}}}`).join(', ')} in the subject or body.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recipients</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <RecipientPicker
            mode={mode} onModeChange={setMode}
            contacts={contacts} contactsLoading={contactsLoading}
            selectedContactKeys={selectedContactKeys} onToggleContact={toggleContact}
            onSelectAllContacts={() => setSelectedContactKeys(new Set(contacts.map(recipientKey)))}
            onSelectNoneContacts={() => setSelectedContactKeys(new Set())}
            pasteText={pasteText} onPasteTextChange={setPasteText}
            pastedRecipients={pastedParsed.recipients} pastedErrors={pastedParsed.errors}
            csvFileName={csvFileName}
            onCsvFile={(file) => { file.text().then((t) => { setCsvFileName(file.name); setCsvText(t); }); }}
            csvRecipients={csvParsed.recipients} csvErrors={csvParsed.errors} csvColumns={csvColumns}
          />
          <p className="text-sm font-medium text-foreground">
            {sendable.length} recipient{sendable.length === 1 ? '' : 's'}
            {suppressed.length > 0 && `, ${suppressed.length} suppressed and will be skipped`}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Send</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label>When</Label>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={scheduleMode === 'now' ? 'default' : 'outline'}
                  onClick={() => setScheduleMode('now')}>Send now</Button>
                <Button type="button" size="sm" variant={scheduleMode === 'schedule' ? 'default' : 'outline'}
                  onClick={() => setScheduleMode('schedule')}>Schedule</Button>
              </div>
            </div>
            {scheduleMode === 'schedule' && (
              <div className="space-y-2">
                <Label htmlFor="cmp-schedule">Date &amp; time</Label>
                <Input id="cmp-schedule" type="datetime-local" value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)} />
                {scheduleInPast && (
                  <p className="text-xs text-red-600 dark:text-red-400">Pick a time in the future.</p>
                )}
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            How fast this goes out is set for the whole organization on the Settings tab: the
            send window, the random pause between messages, and each mailbox&rsquo;s daily limit.
          </p>

          <div className="flex items-center justify-between border-t border-border pt-4">
            {isAdmin ? (
              <div className="space-y-1">
                <Button type="button" variant="outline" disabled={!selectedAccount || testSending} onClick={handleTestSend}>
                  {testSending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <SendHorizonal className="w-4 h-4 mr-2" />}
                  Send test to me
                </Button>
                {usesPool && (
                  <p className="text-xs text-muted-foreground">
                    A test send goes from one named mailbox, so pick one above instead of the whole pool.
                  </p>
                )}
              </div>
            ) : <span />}
            <Button type="button" disabled={!canSubmit} onClick={handleSubmit}>
              {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
              {scheduleMode === 'schedule' ? 'Schedule campaign' : 'Send now'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ComposeTab;
