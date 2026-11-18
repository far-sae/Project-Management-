import React, { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Avatar, AvatarFallback, AvatarImage,
} from '@/components/ui/avatar';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Users, Edit, Loader2, ShieldAlert, Lock, Trash2,
} from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
import { PageHeader } from '@/components/common/PageHeader';
import { StatusPill } from '@/components/common/StatusPill';
import { TimeTracking } from '@/pages/TimeTracking';
import { TeamAttendance } from '@/components/hr/TeamAttendance';
import { HrOverviewTab } from '@/components/hr/HrOverviewTab';
import { HrLeaveTab } from '@/components/hr/HrLeaveTab';
import { HrDocumentsTab } from '@/components/hr/HrDocumentsTab';
import { HR_TABS, isHrTab, type HrPerson, type HrTab } from '@/components/hr/types';
import { useLeave } from '@/hooks/useLeave';
import { useEmployeeDocuments } from '@/hooks/useEmployeeDocuments';
import { Payroll } from '@/pages/Payroll';
import { Expenses } from '@/pages/Expenses';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useEmployees } from '@/hooks/useEmployees';
import { useOrgCurrency } from '@/hooks/useOrgCurrency';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import {
  EmployeeProfile, EmployeeStatus, EmploymentType, PayPeriod, PayType,
} from '@/services/supabase/employees';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  DateRangeFilter,
  DateRangeValue,
  ALL_TIME,
  inRange,
} from '@/components/common/DateRangeFilter';

const CURRENCIES = ['USD', 'GBP', 'EUR', 'INR', 'AED'];

/** Small square tag (4px corners) for roles and employment type. */
const TAG =
  'inline-flex h-5 shrink-0 items-center rounded border border-border px-1.5 text-xs text-muted-foreground';

/** 28px square icon button in a table row (touch-sized on phones). */
const ROW_ICON_BUTTON = 'w-10 px-0 text-muted-foreground md:w-7';

const employmentBadge = (t: EmploymentType) => (
  <span className={TAG}>{t === 'contractor' ? 'Contractor' : 'Employee'}</span>
);

const statusBadge = (s: EmployeeStatus) => {
  if (s === 'active') return <StatusPill tone="success">Active</StatusPill>;
  if (s === 'onboarding') return <StatusPill tone="warning">Onboarding</StatusPill>;
  return <StatusPill tone="muted">Terminated</StatusPill>;
};

interface FormState {
  jobTitle: string;
  department: string;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  hireDate: string;
  payType: PayType;
  payRate: string;
  currency: string;
  payPeriod: PayPeriod;
  overtimeMultiplier: string;
  defaultWeeklyHours: string;
  bankLast4: string;
  taxIdLast4: string;
  notes: string;
}

const blankForm: FormState = {
  jobTitle: '',
  department: '',
  employmentType: 'employee',
  status: 'active',
  hireDate: '',
  payType: 'hourly',
  payRate: '0',
  currency: 'USD',
  payPeriod: 'biweekly',
  overtimeMultiplier: '1.5',
  defaultWeeklyHours: '40',
  bankLast4: '',
  taxIdLast4: '',
  notes: '',
};

const fromProfile = (p: EmployeeProfile): FormState => ({
  jobTitle: p.jobTitle ?? '',
  department: p.department ?? '',
  employmentType: p.employmentType,
  status: p.status,
  hireDate: p.hireDate ? p.hireDate.toISOString().slice(0, 10) : '',
  payType: p.payType,
  payRate: String(p.payRate ?? 0),
  currency: p.currency,
  payPeriod: p.payPeriod,
  overtimeMultiplier: String(p.overtimeMultiplier ?? 1.5),
  defaultWeeklyHours: String(p.defaultWeeklyHours ?? 40),
  bankLast4: p.bankLast4 ?? '',
  taxIdLast4: p.taxIdLast4 ?? '',
  notes: p.notes ?? '',
});

/** Padding shared by every HR tab body. */
const TAB_BODY = 'flex w-full flex-col gap-6 px-4 py-6 lg:px-6';
const TAB_PANEL = 'mt-0 min-h-0 flex-1 overflow-y-auto overflow-x-hidden';

export const HR: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { profilesByUserId, loading, upsert, remove, canManage, canView } =
    useEmployees();
  const orgCurrency = useOrgCurrency();
  const fmt = useFormatMoney();
  const leave = useLeave();
  const docs = useEmployeeDocuments();

  // The open tab lives in the address (?tab=leave) so it can be linked to.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: HrTab = isHrTab(tabParam) ? tabParam : 'overview';
  const openTab = useCallback(
    (tab: string) => {
      const next = new URLSearchParams(searchParams);
      if (tab === 'overview') next.delete('tab');
      else next.set('tab', tab);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const [editingMember, setEditingMember] = useState<{
    userId: string;
    displayName: string;
    email: string;
    photoURL?: string;
  } | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [saving, setSaving] = useState(false);
  // Filters the directory by `hireDate`. "All time" shows everyone (including
  // members without a profile yet); any preset/custom range only shows people
  // whose hireDate falls inside it.
  const [dateRange, setDateRange] = useState<DateRangeValue>(ALL_TIME);

  const [deletingMember, setDeletingMember] = useState<{
    userId: string;
    displayName: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!deletingMember) return;
    setDeleting(true);
    try {
      await remove(deletingMember.userId);
      toast.success(`${deletingMember.displayName} removed from HR`);
      setDeletingMember(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  // Build the directory from organization members so people show up even
  // before a profile row is created.
  const directory = useMemo(() => {
    const members = organization?.members ?? [];
    const list = members.map((m) => {
      const profile = profilesByUserId.get(m.userId) ?? null;
      return {
        userId: m.userId,
        displayName: m.displayName ?? m.email ?? '',
        email: m.email ?? '',
        photoURL: m.photoURL ?? '',
        role: m.role,
        profile,
      };
    });
    // If a member is not viewing as owner/admin, only show themselves.
    if (!canView) {
      return list.filter((entry) => entry.userId === user?.userId);
    }
    return list;
  }, [organization?.members, profilesByUserId, canView, user?.userId]);

  const visibleDirectory = useMemo(() => {
    if (dateRange.preset === 'all') return directory;
    return directory.filter((entry) =>
      entry.profile?.hireDate
        ? inRange(entry.profile.hireDate, dateRange)
        : false,
    );
  }, [directory, dateRange]);

  const openEdit = (entry: typeof directory[number]) => {
    if (!canManage) {
      toast.error('Only the organization owner can edit pay info.');
      return;
    }
    setEditingMember({
      userId: entry.userId,
      displayName: entry.displayName,
      email: entry.email,
      photoURL: entry.photoURL,
    });
    // New profiles default to the org currency; existing profiles keep
    // whatever was on the record so back pay history isn't accidentally
    // re-denominated.
    setForm(
      entry.profile ? fromProfile(entry.profile) : { ...blankForm, currency: orgCurrency },
    );
  };

  const handleSave = async () => {
    if (!editingMember) return;
    const payRate = Number(form.payRate);
    if (!Number.isFinite(payRate) || payRate < 0) {
      toast.error('Pay rate must be a positive number');
      return;
    }
    setSaving(true);
    try {
      await upsert({
        userId: editingMember.userId,
        displayName: editingMember.displayName,
        email: editingMember.email,
        jobTitle: form.jobTitle.trim() || null,
        department: form.department.trim() || null,
        employmentType: form.employmentType,
        status: form.status,
        hireDate: form.hireDate ? new Date(form.hireDate) : null,
        payType: form.payType,
        payRate,
        currency: form.currency,
        payPeriod: form.payPeriod,
        overtimeMultiplier: Number(form.overtimeMultiplier) || 1.5,
        defaultWeeklyHours: Number(form.defaultWeeklyHours) || 40,
        bankLast4: form.bankLast4.trim() || null,
        taxIdLast4: form.taxIdLast4.trim() || null,
        notes: form.notes.trim() || null,
      });
      toast.success('Profile saved');
      setEditingMember(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  };

  // Everyone in the organization, for the tabs that list people.
  const people: HrPerson[] = directory;

  return (
    <>
      <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <AppHeader left={<span className="text-sm font-semibold">HR</span>} />
        <Tabs value={activeTab} onValueChange={openTab} className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 overflow-x-auto border-b border-border px-4 lg:px-6">
            <TabsList className="border-b-0">
              {HR_TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="overview" className={TAB_PANEL}>
            <div className={TAB_BODY}>
              <HrOverviewTab people={people} leave={leave} docs={docs} onOpenTab={openTab} />
            </div>
          </TabsContent>

          <TabsContent value="attendance" className={TAB_PANEL}>
            <div className={TAB_BODY}>
              <TeamAttendance />
            </div>
          </TabsContent>

          <TabsContent value="leave" className={TAB_PANEL}>
            <div className={TAB_BODY}>
              <HrLeaveTab people={people} leave={leave} />
            </div>
          </TabsContent>

          <TabsContent value="documents" className={TAB_PANEL}>
            <div className={TAB_BODY}>
              <HrDocumentsTab people={people} docs={docs} />
            </div>
          </TabsContent>

          <TabsContent value="people" className={TAB_PANEL}>
            <div className={TAB_BODY}>
              <PageHeader
                title="People"
                description={
                  <>
                    Job titles, employment, and pay rates.
                    {!canManage && (
                      <span className="ml-1 inline-flex items-center gap-1 text-warning-soft-foreground">
                        <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Owner-only edits.
                      </span>
                    )}
                  </>
                }
                actions={<DateRangeFilter value={dateRange} onChange={setDateRange} />}
              />

              <div className="overflow-hidden rounded-lg border border-border">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading directory" />
                  </div>
                ) : visibleDirectory.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
                    <Users className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
                    <p className="text-sm font-medium">
                      {directory.length === 0
                        ? 'No team members yet.'
                        : 'No employees with a hire date in this range.'}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead>
                        <tr className="h-10 border-b border-border bg-surface-2 text-xs text-muted-foreground">
                          <th scope="col" className="px-4 font-medium">Member</th>
                          <th scope="col" className="px-4 font-medium">Status</th>
                          <th scope="col" className="px-4 font-medium">Pay</th>
                          <th scope="col" className="px-4 font-medium">Hire date</th>
                          <th scope="col" className="px-4 text-right font-medium">
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleDirectory.map((entry) => {
                          const p = entry.profile;
                          return (
                            <tr
                              key={entry.userId}
                              className="border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2"
                            >
                              <td className="px-4 py-2">
                                <div className="flex min-w-0 items-center gap-2.5">
                                  <Avatar className="h-7 w-7 shrink-0">
                                    <AvatarImage src={entry.photoURL} alt={entry.displayName} />
                                    <AvatarFallback className="text-xs font-semibold">
                                      {entry.displayName.charAt(0).toUpperCase() || '?'}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <h3 className="max-w-[16rem] truncate font-medium text-foreground">
                                        {entry.displayName}
                                      </h3>
                                      {entry.role === 'owner' && <span className={TAG}>Owner</span>}
                                      {entry.role === 'admin' && <span className={TAG}>Admin</span>}
                                    </div>
                                    <p className="max-w-[20rem] truncate text-xs text-muted-foreground">
                                      {entry.email}
                                    </p>
                                    {p?.jobTitle && (
                                      <p className="max-w-[20rem] truncate text-xs text-foreground/80">
                                        {p.jobTitle}
                                        {p.department ? ` · ${p.department}` : ''}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-2">
                                {p ? (
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {statusBadge(p.status)}
                                    {employmentBadge(p.employmentType)}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                              <td className="whitespace-nowrap px-4 py-2 tabular-nums">
                                {p &&
                                typeof p.payRate === 'number' &&
                                Number.isFinite(p.payRate)
                                  ? `${fmt(p.payRate, p.currency)} ${p.payType === 'hourly' ? '/hr' : `/${p.payPeriod}`}`
                                  : '—'}
                              </td>
                              <td className="whitespace-nowrap px-4 py-2 tabular-nums">
                                {p?.hireDate ? format(p.hireDate, 'MMM d, yyyy') : '—'}
                              </td>
                              <td className="whitespace-nowrap px-4 py-2 text-right">
                                <div className="inline-flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className={ROW_ICON_BUTTON}
                                    onClick={() => openEdit(entry)}
                                    disabled={!canManage}
                                    title={canManage ? 'Edit profile' : 'Owner only'}
                                    aria-label={canManage ? `Edit ${entry.displayName}'s profile` : 'Owner only'}
                                  >
                                    {canManage ? <Edit aria-hidden /> : <Lock aria-hidden />}
                                  </Button>
                                  {canManage && p && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className={cn(
                                        ROW_ICON_BUTTON,
                                        'text-destructive hover:bg-destructive-soft hover:text-destructive',
                                      )}
                                      onClick={() =>
                                        setDeletingMember({
                                          userId: entry.userId,
                                          displayName: entry.displayName,
                                        })
                                      }
                                      title="Remove HR profile"
                                      aria-label={`Remove ${entry.displayName}'s HR profile`}
                                    >
                                      <Trash2 aria-hidden />
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="time-tracking" className={TAB_PANEL}>
            <TimeTracking embedded />
          </TabsContent>

          <TabsContent value="payroll" className={TAB_PANEL}>
            <Payroll embedded />
          </TabsContent>

          <TabsContent value="expenses" className={TAB_PANEL}>
            <Expenses embedded />
          </TabsContent>
        </Tabs>
      </main>

      {/* Edit dialog (owner only) */}
      <Dialog
        open={!!editingMember}
        onOpenChange={(o) => !o && setEditingMember(null)}
      >
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Edit {editingMember?.displayName}
            </DialogTitle>
            <DialogDescription>
              Pay rate and frequency are owner-only and used by payroll runs.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="hr-title">Job title</Label>
                <Input
                  id="hr-title"
                  value={form.jobTitle}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, jobTitle: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hr-dept">Department</Label>
                <Input
                  id="hr-dept"
                  value={form.department}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, department: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="hr-emp">Employment</Label>
                <Select
                  value={form.employmentType}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, employmentType: v as EmploymentType }))
                  }
                >
                  <SelectTrigger id="hr-emp"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="contractor">Contractor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hr-status">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, status: v as EmployeeStatus }))
                  }
                >
                  <SelectTrigger id="hr-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="onboarding">Onboarding</SelectItem>
                    <SelectItem value="terminated">Terminated</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="hr-hire">Hire date</Label>
                <Input
                  id="hr-hire"
                  type="date"
                  value={form.hireDate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, hireDate: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hr-currency">Currency</Label>
                <Select
                  value={form.currency}
                  onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}
                >
                  <SelectTrigger id="hr-currency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="hr-paytype">Pay type</Label>
                <Select
                  value={form.payType}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, payType: v as PayType }))
                  }
                >
                  <SelectTrigger id="hr-paytype"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="salary">Salary</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hr-rate">
                  {form.payType === 'hourly' ? 'Rate per hour' : 'Pay per period'}
                </Label>
                <Input
                  id="hr-rate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.payRate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, payRate: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="hr-period">Pay period</Label>
                <Select
                  value={form.payPeriod}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, payPeriod: v as PayPeriod }))
                  }
                >
                  <SelectTrigger id="hr-period"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Bi-weekly</SelectItem>
                    <SelectItem value="semimonthly">Semi-monthly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hr-ot">Overtime multiplier</Label>
                <Input
                  id="hr-ot"
                  type="number"
                  min="1"
                  step="0.05"
                  value={form.overtimeMultiplier}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, overtimeMultiplier: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="hr-weekly">Weekly hours</Label>
                <Input
                  id="hr-weekly"
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.defaultWeeklyHours}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, defaultWeeklyHours: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hr-bank">Bank ••• 4 (optional)</Label>
                <Input
                  id="hr-bank"
                  inputMode="numeric"
                  maxLength={4}
                  value={form.bankLast4}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      bankLast4: e.target.value.replace(/\D/g, '').slice(0, 4),
                    }))
                  }
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="hr-notes">Notes</Label>
              <Textarea
                id="hr-notes"
                rows={3}
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingMember(null)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="animate-spin" aria-hidden />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deletingMember}
        onOpenChange={(o) => !o && setDeletingMember(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {deletingMember?.displayName} from HR?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Deletes the HR profile (job title, pay rate, hire date,
              employment type). The teammate stays in the organization and on
              your projects — only their HR record is removed. Past payroll
              runs that already referenced this person are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="animate-spin" aria-hidden />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default HR;
