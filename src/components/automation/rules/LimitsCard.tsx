// Limits: what the agents may spend, how many emails a lead gets, when emails go out, and web look-ups.
import React, { useId } from 'react';
import { Link } from 'react-router-dom';
import { hourLabel, timeZoneChoices, timeZoneLabel, type RulesForm, type RulesProblems } from '@/lib/automation/rules';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card, FIELD } from '@/components/signroom/billing/shared';
import { HINT, Problem, SUB_TITLE, SwitchRow } from './parts';

export interface RulesCardProps {
  form: RulesForm;
  set: <K extends keyof RulesForm>(key: K, value: RulesForm[K]) => void;
  /** What is wrong, shown once a save was tried. Empty before that. */
  problems: Partial<RulesProblems>;
  /** A member may look but not change, and nothing changes while a save is on its way. */
  locked: boolean;
}

const START_HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const END_HOURS = Array.from({ length: 24 }, (_, hour) => hour + 1);

/** Sending may start at 00:00–23:00 and end at 01:00–24:00; an hour saved outside that is still shown. */
const hoursWith = (hours: number[], saved: number): number[] => (hours.includes(saved) ? hours : [saved, ...hours]);

/** One of the two hours of the day between which emails are sent. */
const HourSelect: React.FC<{
  id: string;
  label: string;
  value: number;
  hours: number[];
  onChange: (hour: number) => void;
  invalid: boolean;
  disabled: boolean;
}> = ({ id, label, value, hours, onChange, invalid, disabled }) => (
  <div className={FIELD}>
    <Label htmlFor={id}>{label}</Label>
    <Select value={String(value)} onValueChange={(next) => onChange(Number(next))} disabled={disabled}>
      <SelectTrigger id={id} className="tabular-nums" aria-invalid={invalid ? true : undefined}><SelectValue /></SelectTrigger>
      <SelectContent>
        {hoursWith(hours, value).map((hour) => <SelectItem key={hour} value={String(hour)}>{hourLabel(hour)}</SelectItem>)}
      </SelectContent>
    </Select>
  </div>
);

export const LimitsCard: React.FC<RulesCardProps> = ({ form, set, problems, locked }) => {
  const id = useId();
  const describedBy = (hint: string, problem?: string) => (problem ? `${hint} ${hint}-problem` : hint);

  return (
    <Card title="Limits">
      <div className="flex flex-col gap-5 p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className={FIELD}>
            <Label htmlFor={`${id}-budget`}>AI spend per month</Label>
            <div className="relative">
              <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">$</span>
              <Input
                id={`${id}-budget`} inputMode="decimal" autoComplete="off" disabled={locked} className="pl-7 tabular-nums"
                value={form.budget} onChange={(event) => set('budget', event.target.value)}
                aria-invalid={problems.budget ? true : undefined}
                aria-describedby={describedBy(`${id}-budget-hint`, problems.budget)}
              />
            </div>
            <p id={`${id}-budget-hint`} className={HINT}>In US dollars. At the limit, agents pause and you are told.</p>
            <Problem id={`${id}-budget-hint-problem`}>{problems.budget}</Problem>
          </div>

          <div className={FIELD}>
            <Label htmlFor={`${id}-emails`}>Emails per lead</Label>
            <Input
              id={`${id}-emails`} inputMode="numeric" autoComplete="off" disabled={locked} className="tabular-nums"
              value={form.emailsPerLead} onChange={(event) => set('emailsPerLead', event.target.value)}
              aria-invalid={problems.emailsPerLead ? true : undefined}
              aria-describedby={describedBy(`${id}-emails-hint`, problems.emailsPerLead)}
            />
            <p id={`${id}-emails-hint`} className={HINT}>After that the lead is left to a person.</p>
            <Problem id={`${id}-emails-hint-problem`}>{problems.emailsPerLead}</Problem>
          </div>
        </div>

        <fieldset className="min-w-0" aria-describedby={describedBy(`${id}-window-hint`, problems.hours)}>
          <legend className={`${SUB_TITLE} mb-3`}>Sends only during</legend>
          <div className="flex min-w-0 flex-col gap-3">
            <SwitchRow
              label="Weekdays only" checked={form.weekdaysOnly} disabled={locked}
              onChange={(checked) => set('weekdaysOnly', checked)}
            />
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <HourSelect
                id={`${id}-from`} label="From" value={form.startHour} hours={START_HOURS}
                onChange={(hour) => set('startHour', hour)} invalid={Boolean(problems.hours)} disabled={locked}
              />
              <HourSelect
                id={`${id}-to`} label="To" value={form.endHour} hours={END_HOURS}
                onChange={(hour) => set('endHour', hour)} invalid={Boolean(problems.hours)} disabled={locked}
              />
              <div className={`${FIELD} col-span-2`}>
                <Label htmlFor={`${id}-zone`}>Time zone</Label>
                <Select value={form.timeZone} onValueChange={(value) => set('timeZone', value)} disabled={locked}>
                  <SelectTrigger id={`${id}-zone`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {timeZoneChoices(form.timeZone).map((zone) => <SelectItem key={zone} value={zone}>{timeZoneLabel(zone)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p id={`${id}-window-hint`} className={HINT}>Drafted any time, sent in these hours.</p>
            <Problem id={`${id}-window-hint-problem`}>{problems.hours}</Problem>
          </div>
        </fieldset>

        <div className="flex flex-col gap-1">
          <p className={SUB_TITLE}>Sends from</p>
          <p className="text-sm text-muted-foreground">
            Emails go from the mailbox connected in{' '}
            <Link to="/crm/document-settings" className="font-medium text-foreground underline underline-offset-4 hover:text-primary">
              Document settings
            </Link>
            , or from TaskCalendar when none is connected.
          </p>
        </div>

        <SwitchRow
          label="Let agents look companies up on the web"
          hint="Agents with that right search public web pages for the lead's company. Every look-up adds to the AI spend."
          checked={form.webResearch} disabled={locked}
          onChange={(checked) => set('webResearch', checked)}
        />
      </div>
    </Card>
  );
};

export default LimitsCard;
