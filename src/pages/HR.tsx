import React, { useMemo, useState } from 'react';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import {
  Users, Edit, Loader2, ShieldAlert, Lock,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useEmployees } from '@/hooks/useEmployees';
import {
  EmployeeProfile, EmployeeStatus, EmploymentType, PayPeriod, PayType,
} from '@/services/supabase/employees';
import { format } from 'date-fns';
import { toast } from 'sonner';

const CURRENCIES = ['USD', 'GBP', 'EUR', 'INR', 'AED'];

const employmentBadge = (t: EmploymentType) =>
  t === 'contractor' ? (
    <Badge variant="outline">Contractor</Badge>
  ) : (
    <Badge variant="outline">Employee</Badge>
  );

const statusBadge = (s: EmployeeStatus) => {
  if (s === 'active') {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
        Active
      </Badge>
    );
  }
  if (s === 'onboarding') {
    return (
      <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30">
        Onboarding
      </Badge>
    );
  }
  return (
    <Badge className="bg-muted text-muted-foreground">Terminated</Badge>
  );
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

export const HR: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { profilesByUserId, loading, upsert, canManage, canView } =
    useEmployees();

  const [editingMember, setEditingMember] = useState<{
    userId: string;
    displayName: string;
    email: string;
    photoURL?: string;
  } | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [saving, setSaving] = useState(false);

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
    setForm(entry.profile ? fromProfile(entry.profile) : blankForm);
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

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
                <Users className="w-6 h-6 text-primary" /> HR Directory
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Job titles, employment, and pay rates.
                {!canManage && (
                  <span className="inline-flex items-center gap-1 ml-1 text-amber-600 dark:text-amber-400">
                    <ShieldAlert className="w-3.5 h-3.5" /> Owner-only edits.
                  </span>
                )}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : directory.length === 0 ? (
            <Card>
              <CardContent className="text-center py-10 text-sm text-muted-foreground">
                No team members yet.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {directory.map((entry) => {
                const p = entry.profile;
                return (
                  <Card key={entry.userId}>
                    <CardContent className="pt-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <Avatar className="w-12 h-12">
                          <AvatarImage src={entry.photoURL} alt={entry.displayName} />
                          <AvatarFallback>
                            {entry.displayName.charAt(0).toUpperCase() || '?'}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold truncate">
                              {entry.displayName}
                            </h3>
                            {p && employmentBadge(p.employmentType)}
                            {p && statusBadge(p.status)}
                            {entry.role === 'owner' && (
                              <Badge variant="outline" className="border-primary/40 text-primary">
                                Owner
                              </Badge>
                            )}
                            {entry.role === 'admin' && (
                              <Badge variant="outline">Admin</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {entry.email}
                          </p>
                          {p?.jobTitle && (
                            <p className="text-sm mt-1">
                              {p.jobTitle}
                              {p.department ? ` · ${p.department}` : ''}
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(entry)}
                          disabled={!canManage}
                          title={canManage ? 'Edit profile' : 'Owner only'}
                        >
                          {canManage ? (
                            <Edit className="w-4 h-4" />
                          ) : (
                            <Lock className="w-4 h-4" />
                          )}
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="rounded border border-border p-2">
                          <div className="text-muted-foreground uppercase tracking-wide">
                            Pay
                          </div>
                          <div className="font-mono mt-0.5">
                            {p &&
                            typeof p.payRate === 'number' &&
                            Number.isFinite(p.payRate)
                              ? `${p.currency} ${p.payRate.toFixed(2)} ${p.payType === 'hourly' ? '/hr' : `/${p.payPeriod}`}`
                              : '—'}
                          </div>
                        </div>
                        <div className="rounded border border-border p-2">
                          <div className="text-muted-foreground uppercase tracking-wide">
                            Hire date
                          </div>
                          <div className="mt-0.5">
                            {p?.hireDate ? format(p.hireDate, 'MMM d, yyyy') : '—'}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
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
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default HR;
