// The status of a run, and of one step in it, as the app's one status badge.
import React from 'react';
import type { RunStatus, RunStepStatus } from '../../../api/_automation/shared/types';
import { RUN_STATUS, STEP_STATUS } from '@/lib/automation/format';
import { StatusPill } from '@/components/common/StatusPill';

/** Running, Waiting, Needs approval, Finished, Stopped or Failed. */
export const RunStatusPill: React.FC<{ status: RunStatus; className?: string }> = ({ status, className }) => {
  const known = RUN_STATUS[status] ?? { label: String(status), tone: 'neutral' as const };
  return <StatusPill tone={known.tone} pulse={status === 'running'} className={className}>{known.label}</StatusPill>;
};

/** Done, Needs approval, Not approved, Skipped or Failed. */
export const StepStatusPill: React.FC<{ status: RunStepStatus; className?: string }> = ({ status, className }) => {
  const known = STEP_STATUS[status] ?? { label: String(status), tone: 'neutral' as const };
  return <StatusPill tone={known.tone} className={className}>{known.label}</StatusPill>;
};

export default RunStatusPill;
