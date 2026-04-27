import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Circle,
  X,
  Building2,
  UserPlus,
  FolderKanban,
  CheckSquare,
  Sparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { useOrganization } from '@/context/OrganizationContext';
import { useProjects } from '@/hooks/useProjects';
import { useAllTasks } from '@/hooks/useAllTasks';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'onboarding_v1';

/** Fired in the same tab after onboarding prefs change (storage event is cross-tab only). */
export const ONBOARDING_CHANGE_EVENT = 'app:onboarding-change';

interface OnboardingState {
  dismissed?: boolean;
  triedAi?: boolean;
}

const readState = (): OnboardingState => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as OnboardingState;
  } catch {
    return {};
  }
};

const writeState = (state: OnboardingState) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
};

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  done: boolean;
  cta: string;
  onClick: () => void;
}

export const markOnboardingAi = () => {
  const state = readState();
  writeState({ ...state, triedAi: true });
  try {
    window.dispatchEvent(new CustomEvent(ONBOARDING_CHANGE_EVENT));
  } catch {
    /* ignore */
  }
};

export const OnboardingChecklist: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { organization } = useOrganization();
  const { projects } = useProjects();
  const { tasks } = useAllTasks();

  const [state, setState] = useState<OnboardingState>(() => readState());

  useEffect(() => {
    const sync = () => setState(readState());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) sync();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(ONBOARDING_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(ONBOARDING_CHANGE_EVENT, sync);
    };
  }, []);

  const hasOrg = !!organization?.organizationId;
  const hasInvite = (organization?.members?.length ?? 0) > 1;
  const hasProject = (projects?.length ?? 0) > 0;
  const hasTask = (tasks?.length ?? 0) > 0;
  const triedAi = !!state.triedAi;

  const steps: OnboardingStep[] = useMemo(
    () => [
      {
        id: 'workspace',
        title: 'Set up your organization',
        description: 'Create a workspace where your team will collaborate.',
        icon: Building2,
        done: hasOrg,
        cta: hasOrg ? 'Done' : 'Open settings',
        onClick: () => navigate('/settings'),
      },
      {
        id: 'invite',
        title: 'Invite your teammates',
        description: 'Bring others into your organization to collaborate.',
        icon: UserPlus,
        done: hasInvite,
        cta: hasInvite ? 'Done' : 'Invite people',
        onClick: () => navigate('/team'),
      },
      {
        id: 'project',
        title: 'Create your first project',
        description: 'Use a template or start blank.',
        icon: FolderKanban,
        done: hasProject,
        cta: hasProject ? 'Done' : 'New project',
        onClick: () => navigate('/dashboard?action=new-project'),
      },
      {
        id: 'task',
        title: 'Add a task',
        description: 'Drop a task on your board to get rolling.',
        icon: CheckSquare,
        done: hasTask,
        cta: hasTask ? 'Done' : 'Add a task',
        onClick: () => navigate('/dashboard'),
      },
      {
        id: 'ai',
        title: 'Try AI assistance',
        description: 'Generate subtasks or summaries from a task.',
        icon: Sparkles,
        done: triedAi,
        cta: triedAi ? 'Done' : 'Open a task',
        onClick: () => navigate('/dashboard'),
      },
    ],
    [hasOrg, hasInvite, hasProject, hasTask, triedAi, navigate],
  );

  const completed = steps.filter((s) => s.done).length;
  const total = steps.length;
  const percent = Math.round((completed / total) * 100);

  if (!user) return null;
  if (state.dismissed) return null;
  if (completed === total) return null;

  const handleDismiss = () => {
    const next = { ...state, dismissed: true };
    setState(next);
    writeState(next);
  };

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Get started
          </h3>
          <p className="text-xs text-muted-foreground/90 mt-0.5">
            Finish these {total} steps to unlock the full product.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={handleDismiss}
          aria-label="Dismiss onboarding checklist"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="px-4 pt-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full bg-primary transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {completed}/{total}
          </span>
        </div>
      </div>

      <ul className="mt-3 divide-y divide-border">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <li
              key={step.id}
              className={cn(
                'flex items-center gap-3 px-4 py-3 transition-colors',
                step.done && 'opacity-70',
              )}
            >
              {step.done ? (
                <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
              ) : (
                <Circle className="w-5 h-5 text-muted-foreground shrink-0" />
              )}
              <div className="flex items-center justify-center w-7 h-7 rounded-md bg-primary/10 text-primary shrink-0">
                <Icon className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-sm font-medium text-foreground',
                    step.done && 'line-through text-muted-foreground',
                  )}
                >
                  {step.title}
                </p>
                <p className="text-xs text-muted-foreground/90 truncate">
                  {step.description}
                </p>
              </div>
              <Button
                variant={step.done ? 'ghost' : 'outline'}
                size="sm"
                onClick={step.onClick}
                disabled={step.done}
                className="shrink-0"
              >
                {step.cta}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default OnboardingChecklist;
