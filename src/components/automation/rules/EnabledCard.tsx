// "Automation on or off" for one workspace.
import React from 'react';
import { Card } from '@/components/signroom/billing/shared';
import { SwitchRow } from './parts';

export const EnabledCard: React.FC<{
  /** The workspace's name, for the sentences. */
  place: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
}> = ({ place, enabled, onChange, disabled }) => (
  <Card title="Automation on or off">
    <div className="p-4">
      <SwitchRow
        label={`Run automation in ${place}`}
        hint={`Off means nothing runs in ${place} and new leads start no run. Runs already waiting stay where they are.`}
        checked={enabled}
        onChange={onChange}
        disabled={disabled}
      />
    </div>
  </Card>
);

export default EnabledCard;
