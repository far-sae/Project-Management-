import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import {
  FileText, Plus, Clock, CheckCircle, AlertCircle, Loader2, Edit,
  Trash2, Lock, XCircle, CheckCircle2, Users,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { useOrgCurrency } from '@/hooks/useOrgCurrency';
import { useFormatMoney } from '@/hooks/useFormatMoney';
import {
  createContract, updateContract, deleteContract,
  subscribeToContracts, Contract, ContractStatus,
} from '@/services/supabase/contracts';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { format } from 'date-fns';

const ValueField = ({
  currency, value, onCurrencyChange, onValueChange, idPrefix,
}: {
  currency: string;
  value: string;
  onCurrencyChange: (v: string) => void;
  onValueChange: (v: string) => void;
  idPrefix: string;
}) => (
  <div className="space-y-2">
    <Label htmlFor={`${idPrefix}-value`}>Value</Label>
    <div className="flex gap-2">
      <Select value={currency} onValueChange={onCurrencyChange}>
        <SelectTrigger className="w-28 shrink-0"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="USD">$ USD</SelectItem>
          <SelectItem value="GBP">£ GBP</SelectItem>
          <SelectItem value="EUR">€ EUR</SelectItem>
          <SelectItem value="INR">₹ INR</SelectItem>
          <SelectItem value="AED">د.إ AED</SelectItem>
        </SelectContent>
      </Select>
      <Input
        id={`${idPrefix}-value`}
        type="number"
        min="0"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder="0.00"
        className="flex-1"
      />
    </div>
  </div>
);

export const Contracts: React.FC = () => {
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { hasFeature } = useSubscription();
  const navigate = useNavigate();
  const orgCurrency = useOrgCurrency();
  const fmt = useFormatMoney();

  // Records-only mode: contracts page is now a register of agreements; the
  // "assign-to-teammate-and-have-them-accept-by-email" workflow is gone, so
  // the Tabs split (All vs. Assigned to Me) collapses to a single list.
  const [activeTab] = useState<'all'>('all');
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  // Form states
  const [editingContractId, setEditingContractId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [form, setForm] = useState({
    title: '',
    client: '',
    assignedTo: 'unassigned',
    status: 'draft' as ContractStatus,
    currency: orgCurrency,
    value: '',
    startDate: '',
    endDate: '',
  });

  const orgId = organization?.organizationId ?? user?.organizationId ?? (user ? `local-${user.userId}` : '');

  // Fetch all contracts
  useEffect(() => {
    if (!orgId) {
      setContracts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsubscribe = subscribeToContracts(orgId, (list) => {
      setContracts(list);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [orgId]);

  const resetForm = () => {
    setForm({
      title: '',
      client: '',
      assignedTo: 'unassigned',
      status: 'draft',
      // New contracts pick up the org's preferred currency. Editing an
      // existing contract overwrites this in openEdit() with whatever was
      // recorded on the row, so historical entries don't get repriced.
      currency: orgCurrency,
      value: '',
      startDate: '',
      endDate: '',
    });
    setEditingContractId(null);
  };

  const openEdit = (contract: Contract) => {
    setEditingContractId(contract.contractId);
    setForm({
      title: contract.title,
      client: contract.client,
      assignedTo: contract.assignedTo || 'unassigned',
      status: contract.status,
      currency: contract.currency || 'USD',
      value: contract.value?.toString() || '',
      startDate: contract.startDate ? new Date(contract.startDate).toISOString().slice(0, 10) : '',
      endDate: contract.endDate ? new Date(contract.endDate).toISOString().slice(0, 10) : '',
    });
    setShowEditModal(true);
    setCreateError(null);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.client.trim() || !orgId || !user) return;
    setCreateError(null);
    setCreating(true);
    try {
      // Handle "unassigned" value - if it's "unassigned", set assignedTo to undefined
      const assignedTo = form.assignedTo === 'unassigned' ? undefined : form.assignedTo;

      // Find assigned user details only if actually assigned
      const assignedUser = assignedTo ? organization?.members?.find(
        (m: any) => m.userId === assignedTo
      ) : undefined;

      await createContract(orgId, user.userId, user.displayName || user.email || 'User', {
        title: form.title.trim(),
        client: form.client.trim(),
        assignedTo: assignedTo,
        assignedToName: assignedUser?.displayName || assignedUser?.email,
        assignedToEmail: assignedUser?.email,
        status: assignedTo ? 'pending' : form.status,
        currency: form.currency,
        value: form.value ? Number(form.value) : undefined,
        startDate: form.startDate ? new Date(form.startDate) : undefined,
        endDate: form.endDate ? new Date(form.endDate) : undefined,
      });
      resetForm();
      setShowCreateModal(false);
      toast.success('Contract created successfully');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create contract');
    } finally {
      setCreating(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContractId || !form.title.trim() || !form.client.trim() || !orgId) return;
    setCreateError(null);
    setUpdating(true);
    try {
      const assignedTo = form.assignedTo === 'unassigned' ? undefined : form.assignedTo;

      await updateContract(editingContractId, orgId, {
        title: form.title.trim(),
        client: form.client.trim(),
        assignedTo: assignedTo,
        status: form.status,
        currency: form.currency,
        value: form.value ? Number(form.value) : undefined,
        startDate: form.startDate ? new Date(form.startDate) : undefined,
        endDate: form.endDate ? new Date(form.endDate) : undefined,
      });
      resetForm();
      setShowEditModal(false);
      toast.success('Contract updated successfully');
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to update contract');
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async (contractId: string) => {
    if (!window.confirm('Delete this contract? This cannot be undone.')) return;
    if (!orgId) return;
    try {
      await deleteContract(contractId, orgId);
      // Drop locally so the row disappears immediately rather than waiting on
      // the realtime subscription.
      setContracts((prev) => prev.filter((c) => c.contractId !== contractId));
      toast.success('Contract deleted');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete contract';
      toast.error(msg);
    }
  };

  const getStatusBadge = (status: string, respondedByName?: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"><CheckCircle className="w-3 h-3 mr-1" />Active</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-500/15 text-yellow-700 dark:text-yellow-300 border-yellow-500/30"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case 'accepted':
        return (
          <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Accepted {respondedByName ? `by ${respondedByName}` : ''}
          </Badge>
        );
      case 'rejected':
        return (
          <Badge className="bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30">
            <XCircle className="w-3 h-3 mr-1" />
            Rejected {respondedByName ? `by ${respondedByName}` : ''}
          </Badge>
        );
      case 'expired':
        return <Badge className="bg-secondary text-secondary-foreground"><AlertCircle className="w-3 h-3 mr-1" />Expired</Badge>;
      default:
        return <Badge className="bg-secondary text-secondary-foreground">Draft</Badge>;
    }
  };

  // FEATURE GATE
  if (!hasFeature('contracts')) {
    return (
      <main className="flex-1 overflow-y-auto p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground">Contracts</h1>
            <p className="text-muted-foreground">Manage your contracts and agreements</p>
          </div>
          <div className="flex flex-col items-center justify-center py-24 border-2 border-dashed border-border rounded-xl text-center">
            <div className="w-16 h-16 bg-orange-500/15 rounded-full flex items-center justify-center mb-4">
              <Lock className="w-8 h-8 text-orange-500" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">Contracts</h2>
            <p className="text-muted-foreground mb-2 max-w-md">
              Create and manage contracts and client agreements with status tracking, multi-currency values, and date ranges.
            </p>
            <p className="text-sm text-orange-500 font-medium mb-6">
              Available on Advanced plan and above
            </p>
            <Button
              className="bg-gradient-to-r from-orange-500 to-red-500"
              onClick={() => navigate('/pricing')}
            >
              Upgrade to Advanced
            </Button>
          </div>
        </main>
    );
  }

  return (
    <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-4 sm:p-6 md:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 md:mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Contracts</h1>
            <p className="text-muted-foreground">Manage your contracts and agreements</p>
          </div>
          <Button
            className="bg-gradient-to-r from-orange-500 to-red-500"
            onClick={() => setShowCreateModal(true)}
          >
            <Plus className="w-4 h-4 mr-2" />New Contract
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
            </CardHeader>
            <CardContent><div className="text-2xl font-bold text-foreground">{contracts.length}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Draft</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-muted-foreground">
                {contracts.filter((c) => c.status === 'draft').length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Pending</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-500 dark:text-yellow-400">
                {contracts.filter((c) => c.status === 'pending').length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Accepted</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-500 dark:text-emerald-400">
                {contracts.filter((c) => c.status === 'accepted').length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Rejected</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-500 dark:text-red-400">
                {contracts.filter((c) => c.status === 'rejected').length}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Records list — single panel; "Assigned to Me" tab removed in records-only mode */}
        <Tabs value={activeTab}>
          <TabsContent value="all">
            <Card>
              <CardHeader><CardTitle>All Contracts</CardTitle></CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <Loader2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground/60 animate-spin" />
                    <p>Loading contracts...</p>
                  </div>
                ) : contracts.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <FileText className="w-16 h-16 mx-auto mb-4 text-muted-foreground/60" />
                    <p className="text-lg font-medium text-foreground">No contracts yet</p>
                    <p className="text-sm">Create your first contract to get started</p>
                    <Button className="mt-4 bg-gradient-to-r from-orange-500 to-red-500" onClick={() => setShowCreateModal(true)}>
                      <Plus className="w-4 h-4 mr-2" />Create Contract
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {contracts.map((contract) => {
                      const assignedUser = organization?.members?.find(
                        (m: any) => m.userId === contract.assignedTo
                      );

                      return (
                        <div key={contract.contractId} className="flex items-center justify-between p-4 bg-secondary/40 border border-border rounded-lg hover:bg-secondary/70 group">
                          <div className="flex items-center gap-4 flex-1">
                            <FileText className="w-10 h-10 text-blue-500 shrink-0" />
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-foreground">{contract.title}</p>
                                {contract.assignedTo && (
                                  <Badge variant="outline" className="bg-purple-500/10 text-purple-600 dark:text-purple-300 border-purple-500/30">
                                    <Users className="w-3 h-3 mr-1" />
                                    Assigned to: {assignedUser?.displayName || assignedUser?.email || 'Team member'}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground">{contract.client}</p>
                              {contract.respondedByName && (
                                <p className="text-xs text-muted-foreground/80 mt-1">
                                  Responded by: {contract.respondedByName}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <p className="font-medium text-foreground">
                                {contract.value != null
                                  ? fmt(contract.value, contract.currency)
                                  : '—'}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {contract.startDate
                                  ? format(new Date(contract.startDate), 'MMM d, yyyy')
                                  : 'No start'}
                                {' – '}
                                {contract.endDate
                                  ? format(new Date(contract.endDate), 'MMM d, yyyy')
                                  : 'No end'}
                              </p>
                            </div>
                            {getStatusBadge(contract.status, contract.respondedByName)}

                            {/* Show response reason if rejected */}
                            {contract.status === 'rejected' && contract.rejectionReason && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toast.info(`Rejection reason: ${contract.rejectionReason}`)}
                                className="text-red-600"
                              >
                                <AlertCircle className="w-4 h-4" />
                              </Button>
                            )}

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" aria-label="Contract actions">
                                  <Edit className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openEdit(contract)}>
                                  <Edit className="w-4 h-4 mr-2" />Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem className="text-red-600" onClick={() => handleDelete(contract.contractId)}>
                                  <Trash2 className="w-4 h-4 mr-2" />Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

        </Tabs>

        {/* Create Modal */}
        <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Create New Contract</DialogTitle>
              <DialogDescription>Fill in the details to create a new contract for your organization.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              {createError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-sm text-red-700">{createError}</p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="title">Title *</Label>
                <Input
                  id="title"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Contract title"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="client">Client Name *</Label>
                <Input
                  id="client"
                  value={form.client}
                  onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}
                  placeholder="Client name"
                  required
                />
              </div>

              <ValueField
                idPrefix="create"
                currency={form.currency}
                value={form.value}
                onCurrencyChange={(v) => setForm((f) => ({ ...f, currency: v }))}
                onValueChange={(v) => setForm((f) => ({ ...f, value: v }))}
              />

              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm((f) => ({ ...f, status: v as ContractStatus }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="startDate">Start Date</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endDate">End Date</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)} disabled={creating}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-gradient-to-r from-orange-500 to-red-500"
                  disabled={creating || !form.title.trim() || !form.client.trim()}
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                  Create Contract
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Edit Modal */}
        <Dialog open={showEditModal} onOpenChange={(open) => { if (!open) { setShowEditModal(false); resetForm(); setCreateError(null); } }}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader><DialogTitle>Edit Contract</DialogTitle></DialogHeader>
            <form onSubmit={handleUpdate} className="space-y-4">
              {createError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-sm text-red-700">{createError}</p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="edit-title">Title *</Label>
                <Input
                  id="edit-title"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Contract title"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-client">Client Name *</Label>
                <Input
                  id="edit-client"
                  value={form.client}
                  onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))}
                  placeholder="Client name"
                  required
                />
              </div>

              <ValueField
                idPrefix="edit"
                currency={form.currency}
                value={form.value}
                onCurrencyChange={(v) => setForm((f) => ({ ...f, currency: v }))}
                onValueChange={(v) => setForm((f) => ({ ...f, value: v }))}
              />

              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm((f) => ({ ...f, status: v as ContractStatus }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-startDate">Start Date</Label>
                  <Input
                    id="edit-startDate"
                    type="date"
                    value={form.startDate}
                    onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-endDate">End Date</Label>
                  <Input
                    id="edit-endDate"
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setShowEditModal(false); resetForm(); setCreateError(null); }} disabled={updating}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="bg-gradient-to-r from-orange-500 to-red-500"
                  disabled={updating || !form.title.trim() || !form.client.trim()}
                >
                  {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit className="w-4 h-4 mr-2" />}
                  Save Changes
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

      </main>
  );
};

export default Contracts;