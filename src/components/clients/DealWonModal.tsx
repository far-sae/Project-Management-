import { useEffect, useMemo, useState } from 'react';
import { Loader2, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { closeDealToWon } from '@/services/supabase/deals';
import { getOrganizationTemplates, type ProjectTemplate } from '@/services/supabase/projectTemplates';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export interface DealWonModalDeal {
  dealId: string;
  organizationId: string;
  clientName?: string | null;
  title: string;
  ownerId?: string | null;
}

interface DealWonModalProps {
  deal: DealWonModalDeal;
  targetStage: unknown;
  onClose: () => void;
  onWon?: (deal: DealWonModalDeal) => void;
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

export const DealWonModal = ({ deal, targetStage: _targetStage, onClose, onWon }: DealWonModalProps) => {
  const defaultName = useMemo(
    () => [deal.clientName, deal.title].filter(Boolean).join(' - ').slice(0, 120),
    [deal.clientName, deal.title],
  );
  const [name, setName] = useState(defaultName);
  const [templateId, setTemplateId] = useState('none');
  const [startDate, setStartDate] = useState(() => isoDate(new Date()));
  const [dueDate, setDueDate] = useState(() => isoDate(new Date(Date.now() + 30 * 86_400_000)));
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    getOrganizationTemplates(deal.organizationId)
      .then((items) => { if (active) setTemplates(items); })
      .catch(() => { if (active) setTemplates([]); });
    return () => { active = false; };
  }, [deal.organizationId]);

  const submit = async (skip: boolean) => {
    setSubmitting(true);
    try {
      await closeDealToWon(deal.dealId, {
        skip,
        name: skip ? undefined : name.trim(),
        ownerId: skip ? undefined : deal.ownerId ?? undefined,
        startDate: skip ? undefined : startDate,
        dueDate: skip ? undefined : dueDate,
        templateId: skip || templateId === 'none' ? null : templateId,
      });
      toast.success(skip ? 'Deal marked as won' : 'Deal won and project created');
      onWon?.(deal);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not close the deal');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-emerald-500" />
            Close deal as won
          </DialogTitle>
          <DialogDescription>
            Create a delivery project now, or mark the deal as won and handle the project later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="won-project-name">Project name</Label>
            <Input id="won-project-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="won-start-date">Start</Label>
              <Input id="won-start-date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="won-due-date">Due</Label>
              <Input id="won-due-date" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Template</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No template</SelectItem>
                {templates.map((template) => (
                  <SelectItem key={template.templateId} value={template.templateId}>{template.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => void submit(true)} disabled={submitting}>Skip</Button>
          <Button onClick={() => void submit(false)} disabled={submitting || !name.trim()}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DealWonModal;
