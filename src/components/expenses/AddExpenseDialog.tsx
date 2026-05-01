import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useExpenses } from '@/hooks/useExpenses';
import { uploadExpenseInvoice } from '@/services/supabase/expenses';
import { toast } from 'sonner';

const CURRENCIES = ['USD', 'GBP', 'EUR', 'INR', 'AED'];
const CATEGORIES = ['Materials', 'Tools', 'Fuel', 'Travel', 'Subcontractor', 'Other'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-filled task context. Both fields are optional but together describe
   *  the work the expense was incurred for (e.g. screws bought for "frame
   *  the deck"). */
  taskId?: string | null;
  taskTitle?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  onCreated?: () => void;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * Compact "submit an expense" form, used from inside TaskExpensesPanel so
 * members can file expenses without leaving the task — and without needing
 * access to the /expenses page (which is admin/owner only).
 *
 * Submitted with status "pending" — owner/admin must approve before it lands
 * on a payroll run for reimbursement.
 */
export const AddExpenseDialog: React.FC<Props> = ({
  open,
  onOpenChange,
  taskId,
  taskTitle,
  projectId,
  projectName,
  onCreated,
}) => {
  const { create, organizationId } = useExpenses();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    category: 'Materials',
    amount: '',
    currency: 'USD',
    vendor: '',
    incurredOn: todayIso(),
  });

  // Reset whenever the dialog opens so old values don't leak between tasks.
  useEffect(() => {
    if (!open) return;
    setForm({
      title: taskTitle ? `Expense for ${taskTitle}` : '',
      description: '',
      category: 'Materials',
      amount: '',
      currency: 'USD',
      vendor: '',
      incurredOn: todayIso(),
    });
    setInvoiceFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [open, taskTitle]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!form.title.trim()) {
      toast.error('Title is required');
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error('Amount must be a non-negative number');
      return;
    }
    setSubmitting(true);
    try {
      let invoice: Awaited<ReturnType<typeof uploadExpenseInvoice>> | null = null;
      if (invoiceFile && organizationId) {
        try {
          invoice = await uploadExpenseInvoice(organizationId, invoiceFile);
        } catch (uploadErr) {
          toast.warning(
            'Invoice upload failed — submitting expense without it. ' +
              (uploadErr instanceof Error ? uploadErr.message : ''),
          );
        }
      }

      await create({
        title: form.title.trim(),
        description: form.description.trim() || null,
        category: form.category || null,
        amount,
        currency: form.currency,
        vendor: form.vendor.trim() || null,
        projectId: projectId ?? null,
        projectName: projectName ?? null,
        taskId: taskId ?? null,
        taskTitle: taskTitle ?? null,
        incurredOn: new Date(form.incurredOn),
        ...(invoice
          ? {
              invoiceUrl: invoice.invoiceUrl,
              invoicePath: invoice.invoicePath,
              invoiceName: invoice.invoiceName,
              invoiceType: invoice.invoiceType,
              invoiceSize: invoice.invoiceSize,
            }
          : {}),
      });
      toast.success('Expense submitted for approval');
      onCreated?.();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit expense');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add expense</DialogTitle>
          <DialogDescription>
            {taskTitle
              ? `For task: ${taskTitle}. Submitted as pending — owner / admin can approve.`
              : 'Submitted as pending — owner / admin can approve.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ax-title">Title</Label>
            <Input
              id="ax-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. 2x4 lumber, drywall screws"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ax-amount">Amount</Label>
              <Input
                id="ax-amount"
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ax-currency">Currency</Label>
              <Select
                value={form.currency}
                onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}
              >
                <SelectTrigger id="ax-currency"><SelectValue /></SelectTrigger>
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
              <Label htmlFor="ax-cat">Category</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
              >
                <SelectTrigger id="ax-cat"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ax-date">Date</Label>
              <Input
                id="ax-date"
                type="date"
                value={form.incurredOn}
                onChange={(e) => setForm((f) => ({ ...f, incurredOn: e.target.value }))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ax-vendor">Vendor</Label>
            <Input
              id="ax-vendor"
              value={form.vendor}
              onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))}
              placeholder="Home Depot, etc."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ax-desc">Notes</Label>
            <Textarea
              id="ax-desc"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Anything the reviewer should know"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ax-invoice">Invoice / receipt</Label>
            <Input
              ref={fileInputRef}
              id="ax-invoice"
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setInvoiceFile(e.target.files?.[0] ?? null)}
            />
            {invoiceFile && (
              <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <Paperclip className="w-3 h-3" />
                {invoiceFile.name}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Submit for approval
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddExpenseDialog;
