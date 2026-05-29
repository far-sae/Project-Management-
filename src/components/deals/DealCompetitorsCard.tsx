import React, { useState } from 'react';
import { Plus, Trash2, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  DealCompetitor,
  CreateDealCompetitorInput,
} from '@/services/supabase/dealRelations';

interface DealCompetitorsCardProps {
  competitors: DealCompetitor[];
  canManage: boolean;
  onAdd: (input: CreateDealCompetitorInput) => Promise<DealCompetitor>;
  onRemove: (competitorId: string) => Promise<void>;
  dealId: string;
}

/**
 * Inline list of competing vendors on a deal. Quick add form on top, table
 * of existing rows below. No edit affordance yet — reps usually just delete
 * + re-add when something changes.
 */
export const DealCompetitorsCard: React.FC<DealCompetitorsCardProps> = ({
  competitors, canManage, onAdd, onRemove, dealId,
}) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const handleAdd = async () => {
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      await onAdd({ dealId, name: n, url: url.trim() || null });
      setName('');
      setUrl('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add competitor');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string, label: string) => {
    setRemovingId(id);
    try {
      await onRemove(id);
      toast.success(`Removed "${label}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove competitor');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Competitors</h3>
        <span className="text-xs text-muted-foreground">{competitors.length}</span>
      </div>

      {canManage && (
        <div className="flex flex-wrap gap-2 items-center">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Competitor name"
            maxLength={120}
            className="flex-1 min-w-[160px]"
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) void handleAdd(); }}
          />
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Site (optional)"
            className="flex-1 min-w-[160px]"
          />
          <Button onClick={handleAdd} disabled={busy || !name.trim()} size="sm">
            {busy ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
            Add
          </Button>
        </div>
      )}

      {competitors.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No records found</p>
      ) : (
        <ul className="space-y-1.5">
          {competitors.map((c) => (
            <li
              key={c.competitorId}
              className="rounded-md border p-2 flex items-center gap-2"
            >
              <span className="font-medium text-sm flex-1 min-w-0 truncate">{c.name}</span>
              {c.url && (
                <a
                  href={c.url.startsWith('http') ? c.url : `https://${c.url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1 shrink-0"
                >
                  {c.url} <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {canManage && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive shrink-0"
                  disabled={removingId === c.competitorId}
                  onClick={() => handleRemove(c.competitorId, c.name)}
                >
                  {removingId === c.competitorId ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
