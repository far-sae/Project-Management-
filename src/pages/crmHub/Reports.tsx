import React, { useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { useOrganization } from '@/context/OrganizationContext';
import { useCrmCurrency } from '@/context/CrmCurrencyContext';
import {
  useCrmActivities, useCrmContacts, useCrmDeals, useCrmDealStages,
} from '@/hooks/useCrmHub';
import { useDealMoney } from '@/hooks/useDealMoney';
import {
  PERIODS, periodRange, reportCsv, salesReport, type PeriodKey,
} from '@/lib/crmReports';
import { PageHeader } from '@/components/common/PageHeader';
import { StatStrip } from '@/components/common/StatStrip';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

/**
 * The CRM's reports: how a period went, for everyone or for one person. Where
 * the leads came from, how many became deals, what was won and lost and why,
 * and what each person did. Every figure is worked out from the workspace's
 * own leads, deals and timeline (src/lib/crmReports.ts says what each means).
 */

const EVERYONE = '__everyone__';
/** Timeline entries read for the "what each person logged" columns. */
const ACTIVITY_ROWS = 2000;

const BOX = 'overflow-hidden rounded-lg border border-border bg-card';
const TH = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground';
const TH_NUM = 'px-3 py-2 text-right text-xs font-medium text-muted-foreground';
const TD = 'px-3 py-2 text-sm';
const TD_NUM = 'px-3 py-2 text-right text-sm tabular-nums';

const Table: React.FC<{ title: string; empty: string; hasRows: boolean; children: React.ReactNode }> = ({ title, empty, hasRows, children }) => (
  <section className={BOX} aria-label={title}>
    <div className="flex min-h-11 items-center border-b border-border px-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
    </div>
    {hasRows ? <div className="overflow-x-auto"><table className="w-full">{children}</table></div> : <p className="px-4 py-8 text-center text-sm text-muted-foreground">{empty}</p>}
  </section>
);

export const CrmReportsPage: React.FC = () => {
  const { organization } = useOrganization();
  const { format: money } = useCrmCurrency();
  const { inCompany } = useDealMoney();
  const { items: leads, loading: leadsLoading } = useCrmContacts();
  const { items: deals, loading: dealsLoading } = useCrmDeals();
  const { items: stages } = useCrmDealStages();
  const { items: activities } = useCrmActivities(ACTIVITY_ROWS);

  const [periodKey, setPeriodKey] = useState<PeriodKey>('this_month');
  const [who, setWho] = useState(EVERYONE);

  const people = useMemo(
    () => (organization?.members ?? [])
      .filter((m) => !m.status || m.status === 'active')
      .map((m) => ({ userId: m.userId, name: m.displayName || m.email || 'Teammate' })),
    [organization],
  );

  const report = useMemo(() => salesReport(
    {
      leads,
      // Deals can be in different currencies; a report adds them up in the company's own.
      deals: deals.map((d) => ({ ...d, value: inCompany(d) })),
      activities,
      stages,
      people,
    },
    periodRange(periodKey, new Date()),
    who === EVERYONE ? null : who,
  ), [leads, deals, activities, stages, people, periodKey, who, inCompany]);

  const periodLabel = PERIODS.find((p) => p.key === periodKey)?.label ?? '';
  const whoLabel = who === EVERYONE ? 'Everyone' : people.find((p) => p.userId === who)?.name ?? 'One person';

  const download = () => {
    const blob = new Blob([reportCsv(report, periodLabel, whoLabel)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `crm-report-${periodKey.replace(/_/g, '-')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const loading = (leadsLoading || dealsLoading) && leads.length === 0 && deals.length === 0;
  const pct = (value: number | null) => (value === null ? '—' : `${value}%`);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
        <PageHeader
          title="Reports"
          description="How the period went: where leads came from, what became a deal, what was won and lost, and what each person did."
          actions={
            <>
              <Select value={periodKey} onValueChange={(v) => setPeriodKey(v as PeriodKey)}>
                <SelectTrigger className="w-40" aria-label="Period"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={who} onValueChange={setWho}>
                <SelectTrigger className="w-44" aria-label="Person"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={EVERYONE}>Everyone</SelectItem>
                  {people.map((p) => <SelectItem key={p.userId} value={p.userId}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={download}><Download aria-hidden />Export</Button>
            </>
          }
        />

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading the report…
          </div>
        ) : (
          <>
            <StatStrip
              items={[
                { label: 'Leads added', value: report.leadsAdded, note: `${report.becameDeal} became a deal (${pct(report.leadToDealPercent)})` },
                { label: 'Deals won', value: report.dealsWon, note: money(report.wonValue), tone: report.dealsWon > 0 ? 'success' : 'default' },
                { label: 'Win rate', value: pct(report.winRatePercent), note: `${report.dealsWon} won, ${report.dealsLost} lost` },
                { label: 'Days to win', value: report.daysToWin ?? '—', note: 'From a deal being opened to won' },
                { label: 'Open pipeline', value: money(report.openValue), note: `${report.openDeals} open deal${report.openDeals === 1 ? '' : 's'} today` },
              ]}
            />

            <Table title="By person" empty="Nobody did anything in this period." hasRows={report.byPerson.length > 0}>
              <thead>
                <tr className="border-b border-border">
                  <th className={TH}>Person</th>
                  <th className={TH_NUM}>Leads added</th>
                  <th className={TH_NUM}>Deals won</th>
                  <th className={TH_NUM}>Won value</th>
                  <th className={TH_NUM}>Deals lost</th>
                  <th className={TH_NUM}>Calls</th>
                  <th className={TH_NUM}>Emails</th>
                  <th className={TH_NUM}>Meetings</th>
                  <th className={TH_NUM}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {report.byPerson.map((p) => (
                  <tr key={p.userId ?? 'nobody'} className="border-b border-border/60 last:border-0">
                    <td className={`${TD} font-medium`}>{p.name}</td>
                    <td className={TD_NUM}>{p.leadsAdded}</td>
                    <td className={TD_NUM}>{p.dealsWon}</td>
                    <td className={TD_NUM}>{money(p.wonValue)}</td>
                    <td className={TD_NUM}>{p.dealsLost}</td>
                    <td className={TD_NUM}>{p.calls}</td>
                    <td className={TD_NUM}>{p.emails}</td>
                    <td className={TD_NUM}>{p.meetings}</td>
                    <td className={TD_NUM}>{p.notes}</td>
                  </tr>
                ))}
              </tbody>
            </Table>

            <div className="grid items-start gap-6 lg:grid-cols-2">
              <Table title="Where leads came from" empty="No lead was added in this period." hasRows={report.bySource.length > 0}>
                <thead>
                  <tr className="border-b border-border">
                    <th className={TH}>Source</th>
                    <th className={TH_NUM}>Leads</th>
                    <th className={TH_NUM}>Became a deal</th>
                    <th className={TH_NUM}>Won</th>
                  </tr>
                </thead>
                <tbody>
                  {report.bySource.map((s) => (
                    <tr key={s.source} className="border-b border-border/60 last:border-0">
                      <td className={`${TD} font-medium`}>{s.source}</td>
                      <td className={TD_NUM}>{s.leads}</td>
                      <td className={TD_NUM}>{s.becameDeal}</td>
                      <td className={TD_NUM}>{s.won}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>

              <Table title="Why deals were lost" empty="No deal was lost in this period." hasRows={report.lostReasons.length > 0}>
                <thead>
                  <tr className="border-b border-border">
                    <th className={TH}>Reason</th>
                    <th className={TH_NUM}>Deals</th>
                  </tr>
                </thead>
                <tbody>
                  {report.lostReasons.map((r) => (
                    <tr key={r.reason} className="border-b border-border/60 last:border-0">
                      <td className={`${TD} font-medium`}>{r.reason}</td>
                      <td className={TD_NUM}>{r.deals}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>

            <Table title="Open pipeline today, by stage" empty="This workspace has no open stages yet." hasRows={report.byStage.length > 0}>
              <thead>
                <tr className="border-b border-border">
                  <th className={TH}>Stage</th>
                  <th className={TH_NUM}>Deals</th>
                  <th className={TH_NUM}>Value</th>
                </tr>
              </thead>
              <tbody>
                {report.byStage.map((s) => (
                  <tr key={s.stageId} className="border-b border-border/60 last:border-0">
                    <td className={`${TD} font-medium`}>{s.name}</td>
                    <td className={TD_NUM}>{s.deals}</td>
                    <td className={TD_NUM}>{money(s.value)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </div>
    </main>
  );
};

export default CrmReportsPage;
