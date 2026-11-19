// How long a completed agreement is kept before it is deleted.
import React, { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Workspace } from '../../../../api/_signroom/shared/types';
import { useSignroom } from '@/hooks/useSignroom';
import { retentionBody } from '@/lib/signroom/branding';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, FIELD } from '@/components/signroom/billing/shared';
import type { SettingsCardProps } from './SenderCard';

export const RetentionCard: React.FC<SettingsCardProps> = ({ workspace, readOnly, onSaved, onRefused }) => {
  const id = useId();
  const { client } = useSignroom();
  const [days, setDays] = useState(String(workspace.retentionDays));
  const [busy, setBusy] = useState(false);
  const locked = readOnly || busy;

  const save = async () => {
    setBusy(true);
    onRefused();
    try {
      onSaved(await client.call<Workspace>('workspaces/settings', retentionBody(workspace, Number(days))));
      toast.success('Retention period saved.');
    } catch (err) {
      onRefused(err, 'Could not save the retention period');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Keeping records">
      <form className="flex flex-col gap-3 p-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className={FIELD}>
          <Label htmlFor={`${id}-retention`}>Days to keep a completed agreement</Label>
          <Input
            id={`${id}-retention`} type="number" required min={1} max={3650} disabled={locked}
            className="w-32 tabular-nums" value={days} onChange={(e) => setDays(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            From 1 to 3650 days. An agreement is only deleted after this period, and never while it is on legal hold.
          </p>
        </div>
        <div>
          <Button type="submit" variant="outline" disabled={locked}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            Save retention period
          </Button>
        </div>
      </form>
    </Card>
  );
};

export default RetentionCard;
