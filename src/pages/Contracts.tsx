import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sidebar } from '@/components/sidebar/Sidebar';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  FileText, Plus, Clock, CheckCircle, AlertCircle, Loader2, Edit,
  Trash2, Lock, UserCheck, XCircle, CheckCircle2, Users
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useSubscription } from '@/context/SubscriptionContext';
import {
  createContract, updateContract, deleteContract, respondToContract,
  subscribeToContracts, getContractsAssignedToUser, Contract, ContractStatus,
} from '@/services/supabase/contracts';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { format } from 'date-fns';

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', GBP: '£', EUR: '€', INR: '₹', AED: 'د.إ',
};

function contractHasAssignee(assignedTo: string) {
  return assignedTo !== '' && assignedTo !== 'unassigned';
}

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

  const [activeTab, setActiveTab] = useState<'all' | 'assigned'>('all');
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [assignedContracts, setAssignedContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignedLoading, setAssignedLoading] = useState(false);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showResponseModal, setShowResponseModal] = useState(false);
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [responseType, setResponseType] = useState<'accept' | 'reject' | null>(null);

  // Form states
  const [editingContractId, setEditingContractId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [responding, setResponding] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const [form, setForm] = useState({
    title: '',
    client: '',
    assignedTo: 'unassigned',
    status: 'draft' as ContractStatus,
    currency: 'USD',
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

  // Fetch contracts assigned to current user
  useEffect(() => {
    if (activeTab === 'assigned' && user?.userId && orgId) {
      fetchAssignedContracts();
    }
  }, [activeTab, user?.userId, orgId]);

  const fetchAssignedContracts = async () => {

    // console.log("Current auth user:", user?.userId);
    if (!user?.userId || !orgId) return;
    setAssignedLoading(true);
    try {
      const list = await getContractsAssignedToUser(user.userId, orgId);
      setAssignedContracts(list);
    } catch (error) {
      console.error('Error fetching assigned contracts:', error);
      toast.error('Failed to load assigned contracts');
    } finally {
      setAssignedLoading(false);
    }
  };

  const resetForm = () => {
    setForm({
      title: '',
      client: '',
      assignedTo: 'unassigned',
      status: 'draft',
      currency: 'USD',
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

  const openResponseModal = (contract: Contract, type: 'accept' | 'reject') => {
    setSelectedContract(contract);
    setResponseType(type);
    setRejectionReason('');
    setShowResponseModal(true);
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

  const handleResponse = async () => {
    if (!selectedContract || !responseType || !user || !orgId) return;

    setResponding(true);
    try {
      await respondToContract(
        selectedContract.contractId,
        orgId,
        user.userId,
        user.displayName || user.email || 'User',
        responseType === 'accept' ? 'accepted' : 'rejected',
        responseType === 'reject' ? rejectionReason : undefined
      );

      toast.success(`Contract ${responseType === 'accept' ? 'accepted' : 'rejected'} successfully`);
      setShowResponseModal(false);
      setSelectedContract(null);
      fetchAssignedContracts(); // Refresh assigned contracts
    } catch (error) {
      toast.error(`Failed to ${responseType} contract`);
    } finally {
      setResponding(false);
    }
  };

  const handleDelete = async (contractId: string) => {
    if (!window.confirm('Delete this contract? This cannot be undone.')) return;
    if (!orgId) return;
    try {
      await deleteContract(contractId, orgId);
      toast.success('Contract deleted');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete contract';
      toast.error(msg);
    }
  };

  const getStatusBadge = (status: string, respondedByName?: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />Active</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case 'accepted':
        return (
          <Badge className="bg-blue-100 text-blue-800">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Accepted {respondedByName ? `by ${respondedByName}` : ''}
          </Badge>
        );
      case 'rejected':
        return (
          <Badge className="bg-red-100 text-red-800">
            <XCircle className="w-3 h-3 mr-1" />
            Rejected {respondedByName ? `by ${respondedByName}` : ''}
          </Badge>
        );
      case 'expired':
        return <Badge className="bg-gray-100 text-gray-800"><AlertCircle className="w-3 h-3 mr-1" />Expired</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800">Draft</Badge>;
    }
  };

  // FEATURE GATE
  if (!hasFeature('contracts')) {
    return (
      <div className="flex h-screen bg-background">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-8">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Contracts</h1>
            <p className="text-gray-500">Manage your contracts and agreements</p>
          </div>
          <div className="flex flex-col items-center justify-center py-24 border-2 border-dashed border-gray-200 rounded-xl text-center">
            <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mb-4">
              <Lock className="w-8 h-8 text-orange-500" />
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Contracts</h2>
            <p className="text-gray-500 mb-2 max-w-md">
              Create and manage contracts and client agreements with status tracking, multi-currency values, and date ranges.
            </p>
            <p className="text-sm text-orange-600 font-medium mb-6">
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
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Contracts</h1>
            <p className="text-gray-500">Manage your contracts and agreements</p>
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
              <CardTitle className="text-sm font-medium text-gray-500">Total</CardTitle>
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{contracts.length}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Draft</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-gray-600">
                {contracts.filter((c) => c.status === 'draft').length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Pending</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">
                {contracts.filter((c) => c.status === 'pending').length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Accepted</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {contracts.filter((c) => c.status === 'accepted').length}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-gray-500">Rejected</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {contracts.filter((c) => c.status === 'rejected').length}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'all' | 'assigned')}>
          <TabsList className="mb-6">
            <TabsTrigger value="all">All Contracts</TabsTrigger>
            <TabsTrigger value="assigned">
              <UserCheck className="w-4 h-4 mr-2" />
              Assigned to Me
              {assignedContracts.length > 0 && (
                <span className="ml-2 px-1.5 py-0.5 text-xs bg-orange-500 text-white rounded-full">
                  {assignedContracts.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all">
            <Card>
              <CardHeader><CardTitle>All Contracts</CardTitle></CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-center py-16 text-gray-500">
                    <Loader2 className="w-12 h-12 mx-auto mb-4 text-gray-300 animate-spin" />
                    <p>Loading contracts...</p>
                  </div>
                ) : contracts.length === 0 ? (
                  <div className="text-center py-16 text-gray-500">
                    <FileText className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                    <p className="text-lg font-medium">No contracts yet</p>
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
                        <div key={contract.contractId} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 group">
                          <div className="flex items-center gap-4 flex-1">
                            <FileText className="w-10 h-10 text-blue-500 shrink-0" />
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-medium">{contract.title}</p>
                                {contract.assignedTo && (
                                  <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                                    <Users className="w-3 h-3 mr-1" />
                                    Assigned to: {assignedUser?.displayName || assignedUser?.email || 'Team member'}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-gray-500">{contract.client}</p>
                              {contract.respondedByName && (
                                <p className="text-xs text-gray-400 mt-1">
                                  Responded by: {contract.respondedByName}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <p className="font-medium">
                                {contract.value != null
                                  ? `${CURRENCY_SYMBOLS[contract.currency || 'USD']}${contract.value.toLocaleString()}`
                                  : '—'}
                              </p>
                              <p className="text-sm text-gray-500">
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

          <TabsContent value="assigned">
            <Card>
              <CardHeader>
                <CardTitle>Contracts Assigned to Me</CardTitle>
                <p className="text-sm text-gray-500">Review and respond to contracts assigned to you</p>
              </CardHeader>
              <CardContent>
                {assignedLoading ? (
                  <div className="text-center py-16 text-gray-500">
                    <Loader2 className="w-12 h-12 mx-auto mb-4 text-gray-300 animate-spin" />
                    <p>Loading assigned contracts...</p>
                  </div>
                ) : assignedContracts.length === 0 ? (
                  <div className="text-center py-16 text-gray-500">
                    <UserCheck className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                    <p className="text-lg font-medium">No contracts assigned to you</p>
                    <p className="text-sm">When someone assigns a contract to you, it will appear here</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {assignedContracts.map((contract) => {
                      const creator = organization?.members?.find(
                        (m: any) => m.userId === contract.createdBy
                      );

                      return (
                        <div key={contract.contractId} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                          <div className="flex-1">
                            <h3 className="font-semibold text-gray-900">{contract.title}</h3>
                            <p className="text-sm text-gray-600 mt-1">
                              <span className="font-medium">Client:</span> {contract.client}
                            </p>
                            <p className="text-sm text-gray-600">
                              <span className="font-medium">Created by:</span> {contract.createdByName || creator?.displayName || creator?.email || 'Unknown'}
                            </p>
                            {contract.value != null && (
                              <p className="text-sm text-gray-600 mt-1">
                                <span className="font-medium">Value:</span>{' '}
                                <span className="text-green-600 font-semibold">
                                  {CURRENCY_SYMBOLS[contract.currency || 'USD']}
                                  {contract.value.toLocaleString()}
                                </span>
                              </p>
                            )}
                            {(contract.startDate || contract.endDate) && (
                              <p className="text-sm text-gray-600">
                                <span className="font-medium">Duration:</span>{' '}
                                {contract.startDate ? format(new Date(contract.startDate), 'MMM d, yyyy') : 'No start'}
                                {' → '}
                                {contract.endDate ? format(new Date(contract.endDate), 'MMM d, yyyy') : 'No end'}
                              </p>
                            )}
                          </div>
                          <div className="flex gap-2 ml-4">
                            <Button
                              size="sm"
                              className="bg-green-600 hover:bg-green-700"
                              onClick={() => openResponseModal(contract, 'accept')}
                            >
                              <CheckCircle2 className="w-4 h-4 mr-1" />
                              Accept
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-red-200 text-red-600 hover:bg-red-50"
                              onClick={() => openResponseModal(contract, 'reject')}
                            >
                              <XCircle className="w-4 h-4 mr-1" />
                              Reject
                            </Button>
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

              <div className="space-y-2">
                <Label>Assign to Team Member</Label>
                <Select
                  value={form.assignedTo}
                  onValueChange={(v) => setForm(f => ({ ...f, assignedTo: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select team member (optional)" />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value="unassigned">Not assigned</SelectItem>

                    {organization?.members?.map((member: any) => (
                      <SelectItem key={member.userId} value={member.userId}>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full overflow-hidden bg-gray-200">
                            {member.photoURL ? (
                              <img
                                src={member.photoURL}
                                alt={member.displayName || member.email}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xs font-medium">
                                {(member.displayName || member.email || "?")
                                  .charAt(0)
                                  .toUpperCase()}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-col leading-tight">
                            <span className="text-sm font-medium">
                              {member.displayName || "No name"}
                            </span>
                            <span className="text-xs text-gray-500">
                              {member.email}
                            </span>
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                  disabled={contractHasAssignee(form.assignedTo)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
                {contractHasAssignee(form.assignedTo) && (
                  <p className="text-xs text-amber-600">
                    Status will be set to &quot;Pending&quot; when assigned to a team member
                  </p>
                )}
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

              <div className="space-y-2">
                <Label>Assign to Team Member</Label>
                <Select
                  value={form.assignedTo}
                  onValueChange={(v) => setForm(f => ({ ...f, assignedTo: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select team member (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Not assigned</SelectItem>
                    {organization?.members?.map((member: any) => (
                      <SelectItem key={member.userId} value={member.userId}>
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs">
                            {(member.displayName || member.email || '?').charAt(0).toUpperCase()}
                          </div>
                          <span>{member.displayName || member.email}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                  disabled={contractHasAssignee(form.assignedTo)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
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

        {/* Response Modal (Accept/Reject) */}
        <Dialog open={showResponseModal} onOpenChange={setShowResponseModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {responseType === 'accept' ? 'Accept Contract' : 'Reject Contract'}
              </DialogTitle>
              <DialogDescription>
                {responseType === 'accept'
                  ? 'Confirm you accept the terms and value of this contract.'
                  : 'You can add an optional reason when rejecting a contract.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {selectedContract && (
                <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                  <p className="font-medium text-gray-900">{selectedContract.title}</p>
                  <p className="text-sm text-gray-600">Client: {selectedContract.client}</p>
                  {selectedContract.value != null && (
                    <p className="text-sm font-medium text-green-600">
                      Value: {CURRENCY_SYMBOLS[selectedContract.currency || 'USD']}
                      {selectedContract.value.toLocaleString()}
                    </p>
                  )}
                </div>
              )}

              {responseType === 'reject' && (
                <div className="space-y-2">
                  <Label htmlFor="rejectionReason">Reason for rejection (optional)</Label>
                  <Textarea
                    id="rejectionReason"
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="Please provide a reason..."
                    rows={3}
                  />
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <Button
                  className={responseType === 'accept' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}
                  onClick={handleResponse}
                  disabled={responding}
                >
                  {responding ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : null}
                  Confirm {responseType === 'accept' ? 'Accept' : 'Reject'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowResponseModal(false)}
                  disabled={responding}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
};

export default Contracts;