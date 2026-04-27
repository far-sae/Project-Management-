import React from 'react';
import {
  ChevronsUpDown,
  Check,
  Boxes,
  Plus,
  LayoutGrid,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ALL_WORKSPACES_ID,
  useSelectedWorkspace,
} from '@/hooks/useSelectedWorkspace';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface WorkspaceSwitcherProps {
  className?: string;
  onCreateClick?: () => void;
}

export const WorkspaceSwitcher: React.FC<WorkspaceSwitcherProps> = ({
  className,
  onCreateClick,
}) => {
  const { workspaces, selectedId, selected, isAll, select } =
    useSelectedWorkspace();
  const navigate = useNavigate();

  const triggerLabel = isAll
    ? 'All workspaces'
    : selected?.name || 'Select workspace';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border border-border bg-background hover:bg-secondary transition-colors text-left',
            className,
          )}
        >
          <span className="w-7 h-7 rounded-md bg-primary-soft text-primary-soft-foreground flex items-center justify-center shrink-0">
            {isAll ? (
              <LayoutGrid className="w-3.5 h-3.5" />
            ) : (
              <Boxes className="w-3.5 h-3.5" />
            )}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none">
              Workspace
            </p>
            <p className="text-sm font-semibold text-foreground truncate leading-tight mt-0.5">
              {triggerLabel}
            </p>
          </div>
          <ChevronsUpDown className="w-4 h-4 text-muted-foreground shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-[15rem]"
      >
        <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => select(ALL_WORKSPACES_ID)}>
          <LayoutGrid className="w-4 h-4 mr-2" />
          <span className="flex-1">All workspaces</span>
          {isAll && <Check className="w-4 h-4 text-primary" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {workspaces.length === 0 && (
          <DropdownMenuItem disabled>
            <span className="text-muted-foreground">No workspaces yet</span>
          </DropdownMenuItem>
        )}
        {workspaces.map((w) => {
          const active = !isAll && w.workspaceId === selectedId;
          return (
            <DropdownMenuItem
              key={w.workspaceId}
              onSelect={() => select(w.workspaceId)}
            >
              <Boxes className="w-4 h-4 mr-2" />
              <span className="flex-1 truncate">{w.name}</span>
              {active && <Check className="w-4 h-4 ml-2 text-primary" />}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            if (onCreateClick) {
              onCreateClick();
            } else {
              navigate('/dashboard?newWorkspace=1');
            }
          }}
        >
          <Plus className="w-4 h-4 mr-2" />
          New workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default WorkspaceSwitcher;
