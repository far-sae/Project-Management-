// One company's account: what it owes, how old the debt is, the statement, and its billing defaults.
import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type {
  AccountSummary, Client, ClientAccount, ClientAccountSettings,
} from '../../../../api/_signroom/shared/types';
import { useSignroom } from '@/hooks/useSignroom';
import { INVOICE_CURRENCIES, errorSentence, formatMinor, shortDate } from '@/lib/signroom/billing';
import { saveTextFile, statementCsv } from '@/lib/signroom/billingCsv';
import { clientForCompany } from '@/services/signroom/clients';
import { StatStrip } from '@/components/common/StatStrip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card, FIELD, HEAD_ROW, PickWorkspace, ROW, TD, TD_DATE, TD_MONEY, TH, TH_RIGHT } from './shared';
import { useBillingClients } from './useBilling';

export interface CompanyAccountPanelProps {
  /** CRM company id. */
  companyId: string;
}

const ALL = 'All';

const SUMMARY: Array<[string, keyof Pick<AccountSummary, 'invoicedMinor' | 'receivedMinor' | 'outstandingMinor' | 'overdueMinor'>]> = [
  ['Invoiced', 'invoicedMinor'],
  ['Received', 'receivedMinor'],
  ['Outstanding', 'outstandingMinor'],
  ['Overdue', 'overdueMinor'],
];

const dash = <span className="text-muted-foreground">—</span>;

export const CompanyAccountPanel: React.FC<CompanyAccountPanelProps> = ({ companyId }) => {
  const { client, workspaceId } = useSignroom();
  const { clients, loading: loadingClients, error: clientsError } = useBillingClients();
  const [made, setMade] = useState<Client | null>(null);
  const [settingUp, setSettingUp] = useState(false);
  const customer = clients.find((c) => c.crmCompanyId === companyId) ?? (made?.crmCompanyId === companyId ? made : null);

  const setUp = async () => {
    setSettingUp(true);
    try {
      setMade(await clientForCompany(client, companyId));
    } catch (error) {
      toast.error(errorSentence(error, 'Could not open the account'));
    } finally {
      setSettingUp(false);
    }
  };

  if (!workspaceId) {
    return <Card title="Account"><PickWorkspace compact what="this company's account" /></Card>;
  }
  if (clientsError) {
    return <Card title="Account"><p role="alert" className="px-4 py-6 text-center text-sm text-destructive">{clientsError}</p></Card>;
  }
  if (!customer) {
    return (
      <Card title="Account">
        {loadingClients ? (
          <p role="status" className="px-4 py-6 text-center text-sm text-muted-foreground">Loading the account</p>
        ) : (
          <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
            <p className="max-w-md text-sm text-muted-foreground">
              Nothing has been invoiced to this company yet. Its statement appears here after the first invoice.
            </p>
            <Button variant="outline" size="sm" onClick={() => void setUp()} disabled={settingUp}>
              {settingUp && <Loader2 className="animate-spin" aria-hidden />}
              Set currency and payment terms
            </Button>
          </div>
        )}
      </Card>
    );
  }
  return <Account key={customer.id} customer={customer} />;
};

const Account: React.FC<{ customer: Client }> = ({ customer }) => {
  const id = useId();
  const { client } = useSignroom();
  const [data, setData] = useState<ClientAccount | null>(null);
  const [settings, setSettings] = useState<ClientAccountSettings | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [currency, setCurrency] = useState(ALL);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [edited, setEdited] = useState(false);
  const latest = useRef(0);
  const editedRef = useRef(false);

  useEffect(() => {
    const mine = ++latest.current;
    client.call<ClientAccount>(`client-accounts/${customer.id}?from=${from}&to=${to}`)
      .then((account) => {
        if (mine !== latest.current) return;
        setData(account);
        if (!editedRef.current) setSettings(account.settings);
        setError('');
      })
      .catch((err) => {
        if (mine === latest.current) setError(errorSentence(err));
      });
    return () => { latest.current += 1; };
  }, [client, customer.id, from, to]);

  const edit = (patch: Partial<ClientAccountSettings>) => {
    editedRef.current = true;
    setEdited(true);
    setSettings((old) => (old ? { ...old, ...patch } : old));
  };

  const save = async () => {
    if (!settings) return;
    setBusy(true);
    try {
      const saved = await client.call<ClientAccountSettings>(`client-accounts/${customer.id}`, settings, 'PATCH');
      // A statement still on its way carries the old settings: let it go.
      latest.current += 1;
      editedRef.current = false;
      setEdited(false);
      setSettings(saved);
      setData((old) => (old ? { ...old, settings: saved } : old));
      toast.success('Account settings saved. New invoices will use these payment terms and currency.');
    } catch (err) {
      toast.error(errorSentence(err, 'Could not save the account settings'));
    } finally {
      setBusy(false);
    }
  };

  const wanted = (code: string) => currency === ALL || currency === code;
  const rows = data?.entries.filter((e) => wanted(e.currency)) ?? [];
  const opening = Object.entries(data?.opening ?? {}).filter(([code]) => wanted(code));
  const closing = Object.entries(data?.closing ?? {}).filter(([code]) => wanted(code));
  const currencies = data
    ? Array.from(new Set([...data.summaries.map((s) => s.currency), ...data.entries.map((e) => e.currency)]))
    : [];
  const filtering = Boolean(from || to || currency !== ALL);
  const locked = !data?.canManage || busy;

  const exportStatement = () => {
    if (!data) return;
    saveTextFile('account-statement.csv', statementCsv({
      companyName: customer.name, from, to, asOf: data.asOf, currency, opening: data.opening, rows,
    }));
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card
        title="Account statement"
        action={
          <Button variant="outline" size="sm" onClick={exportStatement} disabled={!data || Boolean(error)}>
            <Download aria-hidden /> Export CSV
          </Button>
        }
      >
        {error && <p role="alert" className="px-4 py-3 text-sm text-destructive">{error}</p>}
        {!data && !error && <p role="status" className="px-4 py-6 text-center text-sm text-muted-foreground">Loading the account</p>}
        {data && (
          <div className="flex flex-col gap-5 p-4">
            <p className="text-sm text-muted-foreground">
              What has been invoiced and what has been paid. Each currency keeps its own balance.
            </p>
            <StatStrip
              items={SUMMARY.map(([label, key]) => ({
                label,
                value: data.summaries.map((s) => formatMinor(s[key], s.currency)).join(' · ') || '—',
                tone: key === 'overdueMinor' && data.summaries.some((s) => s.overdueMinor > 0) ? 'danger' : 'default',
              }))}
            />

            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-foreground">How old the unpaid balance is</h3>
              <p className="text-xs text-muted-foreground">
                As of <span className="tabular-nums">{shortDate(data.asOf)}</span>. Unpaid balances only. Drafts and voided
                invoices are left out, and the dates below do not change this table.
              </p>
              <div className="overflow-x-auto rounded-md border border-border" role="region" aria-label="Unpaid balance by age" tabIndex={0}>
                <table className="w-full min-w-[40rem] text-sm">
                  <thead>
                    <tr className={HEAD_ROW}>
                      <th className={TH}>Currency</th>
                      <th className={TH_RIGHT}>Outstanding</th>
                      <th className={TH_RIGHT}>Not yet due</th>
                      <th className={TH_RIGHT}>1 to 30 days late</th>
                      <th className={TH_RIGHT}>31 to 60 days</th>
                      <th className={TH_RIGHT}>61 to 90 days</th>
                      <th className={TH_RIGHT}>Over 90 days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.summaries.map((s) => (
                      <tr key={s.currency} className={ROW}>
                        <th scope="row" className={`${TD} text-left font-medium`}>{s.currency}</th>
                        <td className={`${TD_MONEY} font-medium`}>{formatMinor(s.outstandingMinor, s.currency)}</td>
                        <td className={TD_MONEY}>{formatMinor(s.currentMinor, s.currency)}</td>
                        <td className={TD_MONEY}>{formatMinor(s.days1to30, s.currency)}</td>
                        <td className={TD_MONEY}>{formatMinor(s.days31to60, s.currency)}</td>
                        <td className={TD_MONEY}>{formatMinor(s.days61to90, s.currency)}</td>
                        <td className={TD_MONEY}>{formatMinor(s.over90, s.currency)}</td>
                      </tr>
                    ))}
                    {data.summaries.length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">No issued invoices yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-foreground">Statement</h3>
              <div className="flex flex-wrap items-end gap-3">
                <div className={FIELD}>
                  <Label htmlFor={`${id}-from`}>From</Label>
                  <Input id={`${id}-from`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40 tabular-nums" />
                </div>
                <div className={FIELD}>
                  <Label htmlFor={`${id}-to`}>To</Label>
                  <Input id={`${id}-to`} type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40 tabular-nums" />
                </div>
                <div className={FIELD}>
                  <Label htmlFor={`${id}-currency`}>Currency</Label>
                  <Select value={currency} onValueChange={setCurrency}>
                    <SelectTrigger id={`${id}-currency`} className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All currencies</SelectItem>
                      {currencies.map((code) => <SelectItem key={code} value={code}>{code}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {filtering && (
                  <Button variant="ghost" onClick={() => { setFrom(''); setTo(''); setCurrency(ALL); }}>Clear</Button>
                )}
              </div>
              <div className="overflow-x-auto rounded-md border border-border" role="region" aria-label="Statement" tabIndex={0}>
                <table className="w-full min-w-[44rem] text-sm">
                  <thead>
                    <tr className={HEAD_ROW}>
                      <th className={TH}>Date</th>
                      <th className={TH}>Type</th>
                      <th className={TH}>Reference</th>
                      <th className={TH}>Invoice</th>
                      <th className={TH}>Currency</th>
                      <th className={TH_RIGHT}>Charge</th>
                      <th className={TH_RIGHT}>Payment</th>
                      <th className={TH_RIGHT}>Running balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {opening.map(([code, minor]) => (
                      <tr key={`opening-${code}`} className={ROW}>
                        <td className={TD_DATE}>{from ? shortDate(from) : ''}</td>
                        <td className={TD} colSpan={3}>Opening balance</td>
                        <td className={`${TD} text-muted-foreground`}>{code}</td>
                        <td className={TD_MONEY}>{dash}</td>
                        <td className={TD_MONEY}>{dash}</td>
                        <td className={`${TD_MONEY} font-medium`}>{formatMinor(minor, code)}</td>
                      </tr>
                    ))}
                    {rows.map((r) => (
                      <tr key={`${r.kind}-${r.id}`} className={ROW}>
                        <td className={TD_DATE}>{shortDate(r.date)}</td>
                        <td className={TD}>{r.kind}</td>
                        <td className={`${TD} tabular-nums`}>{r.reference}</td>
                        <td className={`${TD} tabular-nums`}>
                          <Link to={`/crm/invoices/${r.invoiceId}`} className="hover:underline">{r.invoiceNumber}</Link>
                        </td>
                        <td className={`${TD} text-muted-foreground`}>{r.currency}</td>
                        <td className={TD_MONEY}>{r.chargeMinor ? formatMinor(r.chargeMinor, r.currency) : dash}</td>
                        <td className={TD_MONEY}>{r.paymentMinor ? formatMinor(r.paymentMinor, r.currency) : dash}</td>
                        <td className={`${TD_MONEY} font-medium`}>{formatMinor(r.balanceMinor, r.currency)}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr><td colSpan={8} className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing on the statement for these dates.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {closing.length > 0 && (
                <dl className="flex flex-wrap justify-end gap-x-6 gap-y-1 text-sm">
                  {closing.map(([code, minor]) => (
                    <div key={code} className="flex items-baseline gap-2">
                      <dt className="text-muted-foreground">Closing balance ({code})</dt>
                      <dd className="font-semibold tabular-nums text-foreground">{formatMinor(minor, code)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>
        )}
      </Card>

      {settings && (
        <Card title="Account settings">
          <form
            className="flex flex-col gap-4 p-4"
            onSubmit={(event) => { event.preventDefault(); void save(); }}
          >
            <p className="text-sm text-muted-foreground">
              New invoices for this company start with these. Invoices already issued do not change.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className={FIELD}>
                <Label htmlFor={`${id}-default-currency`}>Currency</Label>
                <Select value={settings.currency} onValueChange={(v) => edit({ currency: v })} disabled={locked}>
                  <SelectTrigger id={`${id}-default-currency`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INVOICE_CURRENCIES.map((code) => <SelectItem key={code} value={code}>{code}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className={FIELD}>
                <Label htmlFor={`${id}-terms`}>Days to pay</Label>
                <Input
                  id={`${id}-terms`}
                  type="number"
                  min={0}
                  max={365}
                  className="tabular-nums"
                  disabled={locked}
                  value={settings.paymentTermsDays}
                  onChange={(e) => edit({ paymentTermsDays: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className={FIELD}>
              <Label htmlFor={`${id}-reference`}>Account reference</Label>
              <Input
                id={`${id}-reference`}
                maxLength={100}
                disabled={locked}
                value={settings.reference}
                onChange={(e) => edit({ reference: e.target.value })}
              />
            </div>
            <div className={FIELD}>
              <Label htmlFor={`${id}-notes`}>Notes for your team</Label>
              <Textarea
                id={`${id}-notes`}
                rows={3}
                maxLength={2000}
                disabled={locked}
                value={settings.notes}
                onChange={(e) => edit({ notes: e.target.value })}
              />
            </div>
            {data && !data.canManage ? (
              <p className="text-sm text-muted-foreground">Only a workspace owner can change these settings.</p>
            ) : (
              <div>
                <Button type="submit" disabled={busy || !edited}>
                  {busy && <Loader2 className="animate-spin" aria-hidden />}
                  Save account settings
                </Button>
              </div>
            )}
          </form>
        </Card>
      )}
    </div>
  );
};

export default CompanyAccountPanel;
