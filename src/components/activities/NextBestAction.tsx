// src/components/activities/NextBestAction.tsx
// A button that asks the crm-assistant edge function for the single next best
// action to take and renders the reply + any proposed_actions via the shared
// action runner. Permission-gated via canRunAction identical to CrmAssistantChat.

import React, { useState } from 'react';
import { Sparkles, Loader2, CheckCircle2, AlertTriangle, Mail, MoveRight, ListTodo } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { supabase } from '@/services/supabase/config';
import { ProposedAction, canRunAction, ActionPerms } from '@/services/agent/agentActions';
import { useAgentActionRunner } from '@/services/agent/useAgentActionRunner';
import { useMemo } from 'react';

interface EntityRef {
  type: 'client' | 'deal' | 'lead';
  id: string;
  label?: string;
}

interface Props {
  /** When provided, asks for a next action specific to that record.
   *  When omitted, asks for the highest-priority action across the pipeline. */
  entity?: EntityRef;
}

interface NbaResult {
  reply: string;
  proposedActions: ProposedAction[];
}

/**
 * One-click "Next best action" widget. Surfaces a contextual AI suggestion
 * from the crm-assistant edge function and lets the user run the proposed
 * action immediately through the shared useAgentActionRunner hook.
 */
export const NextBestAction: React.FC<Props> = ({ entity }) => {
  const { user } = useAuth();
  const { organization, isOwner, isAdmin, canEditModule } = useOrganization();
  const orgId = organization?.organizationId ?? user?.organizationId ?? null;

  const perms: ActionPerms = useMemo(
    () => ({ isAdmin: isOwner || isAdmin, canEditModule }),
    [isOwner, isAdmin, canEditModule],
  );

  const { running, run } = useAgentActionRunner();

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<NbaResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buildPrompt = (): string => {
    if (entity) {
      return (
        `For the ${entity.type} "${entity.label ?? entity.id}" (id ${entity.id}), ` +
        `look at its recent activity and propose the single next best action to move it forward. ` +
        `Use find_records if you need the id.`
      );
    }
    return (
      'Across my pipeline and overdue tasks, what is the single most important next action I should take right now? Propose it.'
    );
  };

  const fetchSuggestion = async () => {
    if (!orgId) { toast.error('No organization found.'); return; }
    if (!user) { toast.error('Sign in first.'); return; }
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const { data, error: invokeError } = await supabase.functions.invoke('crm-assistant', {
        body: {
          organization_id: orgId,
          user_message: buildPrompt(),
          history: [],
        },
      });
      if (invokeError) throw invokeError;
      const reply = (data as { reply?: string })?.reply ?? '(no response)';
      const proposed: ProposedAction[] =
        (data as { proposed_actions?: ProposedAction[] })?.proposed_actions ?? [];
      setResult({ reply, proposedActions: proposed });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'crm-assistant call failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={loading}
          onClick={() => void fetchSuggestion()}
          className="gap-1.5 text-xs"
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
          )}
          {loading ? 'Thinking…' : 'Next best action'}
        </Button>
        {result && !loading && (
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => setResult(null)}
          >
            dismiss
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded-md border bg-muted/60 px-3 py-2 space-y-2">
          <p className="text-xs whitespace-pre-wrap break-words">{result.reply}</p>

          {result.proposedActions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {result.proposedActions.map((a, i) => {
                const actionId = `${a.type}-${JSON.stringify(a.payload)}`;
                const Icon =
                  a.type === 'draft_email' ? Mail
                  : a.type === 'move_deal_stage' ? MoveRight
                  : a.type === 'create_client_task' || a.type === 'create_pm_task' || a.type === 'assign_task'
                    ? ListTodo
                  : CheckCircle2;
                const allowed = canRunAction(a.type, perms);
                return (
                  <div
                    key={i}
                    className="rounded-md border bg-card/80 px-2 py-1.5 flex items-center gap-2 text-foreground"
                  >
                    <Icon className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                    <span className="text-xs flex-1 min-w-0 truncate">{a.label}</span>
                    {!allowed ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-amber-600">
                        <AlertTriangle className="w-3 h-3" /> no access
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[11px] px-2"
                        disabled={running === actionId}
                        onClick={() => void run(a)}
                      >
                        {running === actionId ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          'Confirm'
                        )}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
