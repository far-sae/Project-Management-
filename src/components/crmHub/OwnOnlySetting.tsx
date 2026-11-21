import { publicMessage } from '@/lib/publicError';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useOrganization } from '@/context/OrganizationContext';
import { useSelectedWorkspace } from '@/hooks/useSelectedWorkspace';
import { Switch } from '@/components/ui/switch';
import { getOwnOnly, setOwnOnly } from '@/services/supabase/crmHub/visibility';

/**
 * The switch for "each person sees only their own leads and deals" in the
 * workspace on screen. The owner and admins set it and always see everything.
 */
export const OwnOnlySetting: React.FC = () => {
  const { organization, isAdmin } = useOrganization();
  const { selected } = useSelectedWorkspace();
  const organizationId = organization?.organizationId ?? '';
  const workspaceId = selected?.workspaceId ?? '';
  const [on, setOn] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'saving'>('loading');
  const [problem, setProblem] = useState('');

  useEffect(() => {
    if (!workspaceId) return;
    let alive = true;
    setState('loading');
    setProblem('');
    getOwnOnly(workspaceId)
      .then((value) => { if (alive) { setOn(value); setState('ready'); } })
      .catch((err: unknown) => { if (alive) { setProblem(publicMessage(err, 'The setting could not be read.')); setState('ready'); } });
    return () => { alive = false; };
  }, [workspaceId]);

  const change = async (next: boolean) => {
    if (!organizationId || !workspaceId) return;
    setState('saving');
    setProblem('');
    try {
      await setOwnOnly(organizationId, workspaceId, next);
      setOn(next);
      toast.success(next ? 'Each person now sees only their own leads and deals' : 'Everybody in the workspace sees every lead and deal again');
    } catch (err) {
      setProblem(publicMessage(err, 'The setting could not be saved.'));
    } finally {
      setState('ready');
    }
  };

  return (
    <section className="max-w-3xl overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex min-h-11 flex-col justify-center border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">Who sees what</h2>
      </div>
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <p id="own-only-label" className="text-sm font-medium">Each person sees only their own leads and deals</p>
          <p className="mt-1 text-pretty text-xs text-muted-foreground">
            With this on, a member sees the leads and deals they own, the follow-ups given to them, and the timeline of
            those. The owner and admins still see everything. Companies stay visible to everybody. A lead with no owner
            is seen by the owner and admins only, so give each lead an owner.
          </p>
          {!isAdmin && <p className="mt-1 text-xs text-muted-foreground">Only the owner and admins can change this.</p>}
          {problem && <p role="alert" className="mt-2 text-sm text-destructive">{problem}</p>}
        </div>
        <Switch
          aria-labelledby="own-only-label"
          checked={on}
          onCheckedChange={(next) => void change(next)}
          disabled={!isAdmin || state !== 'ready' || !workspaceId || (problem !== '' && !on)}
        />
      </div>
    </section>
  );
};
