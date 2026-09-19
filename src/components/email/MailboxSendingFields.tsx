import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/** The four sending-limit fields shared by the create form
 *  (AccountFormDialog) and the reconfigure-an-existing-mailbox dialog
 *  (MailboxLimitsDialog, also in AccountFormDialog.tsx). */
export interface SendingFieldsValues {
  dailyLimit: string;
  warmupEnabled: boolean;
  warmupStartVolume: string;
  warmupIncrement: string;
}

export const MailboxSendingFields: React.FC<{
  idPrefix: string;
  values: SendingFieldsValues;
  onChange: (patch: Partial<SendingFieldsValues>) => void;
}> = ({ idPrefix, values, onChange }) => (
  <div className="space-y-4">
    <div className="space-y-2">
      <Label htmlFor={`${idPrefix}-daily-limit`}>Daily limit</Label>
      <Input
        id={`${idPrefix}-daily-limit`}
        type="number"
        min={1}
        value={values.dailyLimit}
        onChange={(e) => onChange({ dailyLimit: e.target.value })}
      />
    </div>

    <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
      <div>
        <Label htmlFor={`${idPrefix}-warmup`}>Warm up this mailbox</Label>
        <p className="text-xs text-muted-foreground">
          Ramps up from a small volume instead of sending the full limit from day one.
        </p>
      </div>
      <Switch
        id={`${idPrefix}-warmup`}
        checked={values.warmupEnabled}
        onCheckedChange={(v) => onChange({ warmupEnabled: v })}
      />
    </div>

    {values.warmupEnabled && (
      <>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-start-volume`}>Start volume</Label>
            <Input
              id={`${idPrefix}-start-volume`}
              type="number"
              min={0}
              value={values.warmupStartVolume}
              onChange={(e) => onChange({ warmupStartVolume: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-increment`}>Daily increment</Label>
            <Input
              id={`${idPrefix}-increment`}
              type="number"
              min={0}
              value={values.warmupIncrement}
              onChange={(e) => onChange({ warmupIncrement: e.target.value })}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          This mailbox starts at {values.warmupStartVolume || 0} a day and climbs by{' '}
          {values.warmupIncrement || 0} until it reaches {values.dailyLimit || 0}.
        </p>
      </>
    )}
  </div>
);

export default MailboxSendingFields;
