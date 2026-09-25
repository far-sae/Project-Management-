import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, Plus, Trash2, ShieldOff, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { listSuppressions, addSuppression, removeSuppression } from '@/services/supabase/email';
import type { EmailSuppression, SuppressionReason } from '@/lib/email/types';

interface SuppressionTabProps {
  orgId: string;
  isAdmin: boolean;
}

const reasonBadge = (reason: SuppressionReason) => {
  switch (reason) {
    case 'bounced':
      return <Badge className="bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30">Bounced</Badge>;
    case 'complaint':
      return <Badge className="bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30">Complaint</Badge>;
    case 'unsubscribed':
      return <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30">Unsubscribed</Badge>;
    default:
      return <Badge variant="secondary">Manual</Badge>;
  }
};

export const SuppressionTab: React.FC<SuppressionTabProps> = ({ orgId, isAdmin }) => {
  const [suppressions, setSuppressions] = useState<EmailSuppression[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const refresh = () => (orgId ? listSuppressions(orgId).then(setSuppressions) : Promise.resolve());

  useEffect(() => {
    if (!orgId) { setSuppressions([]); setLoading(false); return; }
    setLoading(true);
    refresh()
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load suppressions'))
      .finally(() => setLoading(false));
  }, [orgId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = newEmail.trim();
    if (!email || !orgId) return;
    setAdding(true);
    try {
      await addSuppression(orgId, email);
      await refresh();
      setNewEmail('');
      toast.success('Address added to suppression list');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add address');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (suppression: EmailSuppression) => {
    if (!isAdmin) return;
    if (!window.confirm(`Remove ${suppression.email} from the suppression list? It becomes eligible to receive email again.`)) return;
    setRemovingId(suppression.id);
    try {
      await removeSuppression(suppression.id);
      setSuppressions((prev) => prev.filter((s) => s.id !== suppression.id));
      toast.success('Removed from suppression list');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove address');
    } finally {
      setRemovingId(null);
    }
  };

  const filtered = suppressions.filter((s) => s.email.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Suppression list</CardTitle>
        <p className="text-sm text-muted-foreground">
          Addresses here are always skipped when queuing a campaign, no matter which list they come from.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2">
          <Input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="someone@example.com"
            className="sm:max-w-xs"
            required
          />
          <Button type="submit" disabled={adding || !newEmail.trim()}>
            {adding ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            Add address
          </Button>
          <div className="relative sm:ml-auto sm:max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search suppressed addresses"
              className="pl-9"
            />
          </div>
        </form>

        {!isAdmin && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock className="w-4 h-4" />Only an organization owner or admin can remove an address.
          </div>
        )}

        {loading ? (
          <div className="text-center py-16 text-muted-foreground">
            <Loader2 className="w-10 h-10 mx-auto mb-4 animate-spin text-muted-foreground/60" />
            <p>Loading suppression list...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <ShieldOff className="w-14 h-14 mx-auto mb-4 text-muted-foreground/60" />
            <p className="text-lg font-medium text-foreground">
              {suppressions.length === 0 ? 'No suppressed addresses' : 'No matches'}
            </p>
            <p className="text-sm">
              {suppressions.length === 0 ? 'Bounces, complaints and unsubscribes will show up here.' : 'Try a different search.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-4 p-3 bg-secondary/40 border border-border rounded-lg">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{s.email}</p>
                  <p className="text-xs text-muted-foreground">{format(s.createdAt, 'MMM d, yyyy')}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {reasonBadge(s.reason)}
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${s.email}`}
                      disabled={removingId === s.id}
                      onClick={() => handleRemove(s)}
                    >
                      {removingId === s.id
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Trash2 className="w-4 h-4 text-red-600" />}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SuppressionTab;
