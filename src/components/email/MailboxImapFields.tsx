import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/**
 * Host/port/TLS/Sent-folder fields shared by the create form
 * (AccountFormDialog) and the reconfigure-an-existing-mailbox dialog
 * (MailboxLimitsDialog, also in AccountFormDialog.tsx) — pulled into its own
 * file so neither of those grows past a screenful of markup for a section
 * both need identically.
 */
export interface ImapFieldsValues {
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
  sentFolderEnabled: boolean;
}

/**
 * A suggested IMAP host from the SMTP host already typed — for example
 * `smtp.acme.com` becomes `imap.acme.com`. Returned for use as an input
 * PLACEHOLDER only, never written into form state: it is a suggestion the
 * admin can accept by typing it in or ignore, not a silent value that ends
 * up saved unless they happen to notice and clear it. A host with no leading
 * "smtp" is suggested unchanged, since plenty of providers use the same
 * hostname for both protocols on different ports.
 */
export const suggestImapHost = (smtpHost: string): string => {
  const trimmed = smtpHost.trim();
  if (!trimmed) return '';
  return /^smtp/i.test(trimmed) ? trimmed.replace(/^smtp/i, 'imap') : trimmed;
};

interface MailboxImapFieldsProps {
  idPrefix: string;
  /** Used only to derive the host field's placeholder suggestion above. */
  smtpHost: string;
  values: ImapFieldsValues;
  onChange: (patch: Partial<ImapFieldsValues>) => void;
}

/**
 * The mailbox form's "Inbox" section: optional IMAP settings that let the
 * worker notice replies and bounces for this mailbox (migration 157).
 *
 * Leaving the host blank is a complete, supported configuration, not a step
 * left undone — every phase 1 sending feature already works without it, and
 * this section says so rather than implying the mailbox is broken or
 * half set up.
 */
export const MailboxImapFields: React.FC<MailboxImapFieldsProps> = ({
  idPrefix, smtpHost, values, onChange,
}) => {
  // The same test the send path uses to decide whether to append at all: a
  // Google-hosted mailbox files its own copy, so a second one is a duplicate
  // in the customer's own Sent folder.
  const googleHosted = /(gmail|google)/i.test(values.imapHost);

  const setPort = (value: string) => {
    onChange({
      imapPort: value,
      imapSecure: value === '993' ? true : value === '143' ? false : values.imapSecure,
    });
  };

  return (
    <div className="border-t border-border pt-4 space-y-4">
      <div>
        <p className="text-sm font-medium text-foreground">Inbox (optional)</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Lets this app notice when someone replies or a message bounces. Leave the host blank
          and nothing changes — replies and bounces just won't be detected for this mailbox,
          and sending works exactly the same either way.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-imap-host`}>IMAP host</Label>
          <Input
            id={`${idPrefix}-imap-host`}
            value={values.imapHost}
            placeholder={suggestImapHost(smtpHost) || 'imap.acme.com'}
            onChange={(e) => onChange({ imapHost: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-imap-port`}>IMAP port</Label>
          <Input
            id={`${idPrefix}-imap-port`}
            type="number"
            value={values.imapPort}
            onChange={(e) => setPort(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <div>
          <Label htmlFor={`${idPrefix}-imap-secure`}>Use TLS on connect</Label>
          <p className="text-xs text-muted-foreground">Usually on for port 993, off for 143.</p>
        </div>
        <Switch
          id={`${idPrefix}-imap-secure`}
          checked={values.imapSecure}
          onCheckedChange={(v) => onChange({ imapSecure: v })}
        />
      </div>

      {/* Only meaningful once a host is set — nothing to file a copy into
          otherwise — so it stays out of the way until then, the same way the
          warmup ramp fields only appear once warmup itself is on. */}
      {values.imapHost.trim() !== '' && (
        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
          <div>
            <Label htmlFor={`${idPrefix}-sent-folder`}>File a copy in Sent</Label>
            {/*
              The switch used to sit ON while the text beside it said Google
              was handled automatically, which is two contradictory statements
              about the same mailbox. The engine really does skip the append
              for a Google host — Gmail files its own copy and a second one
              shows up twice — so for those mailboxes the switch is not merely
              ignored, it is misleading, and it now says so and disables
              itself rather than pretending to be a choice.
            */}
            <p className="text-xs text-muted-foreground">
              {googleHosted
                ? 'Google files its own copy of everything sent through Gmail, so this is ' +
                  'skipped for this mailbox whatever the switch says. Nothing to set here.'
                : 'Saves a copy of each delivered message to this mailbox’s own Sent folder, ' +
                  'so your own record matches what the recipient received.'}
            </p>
          </div>
          <Switch
            id={`${idPrefix}-sent-folder`}
            checked={googleHosted ? false : values.sentFolderEnabled}
            disabled={googleHosted}
            onCheckedChange={(v) => onChange({ sentFolderEnabled: v })}
          />
        </div>
      )}
    </div>
  );
};

export default MailboxImapFields;
