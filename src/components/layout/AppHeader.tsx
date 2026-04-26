import React, { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Command,
  HelpCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AppHeaderProps {
  /** Slot for breadcrumbs / title */
  left?: ReactNode;
  /** Slot for page-specific actions (filter, view switcher, etc.) */
  right?: ReactNode;
  /** Show the global search button (opens command palette in Phase 3). Default: true. */
  showSearch?: boolean;
  /** Optional click handler for search; defaults to dispatching a global event picked up by CommandPalette. */
  onSearchClick?: () => void;
  className?: string;
}

const COMMAND_OPEN_EVENT = 'app:open-command-palette';

export const openCommandPalette = () => {
  try {
    window.dispatchEvent(new Event(COMMAND_OPEN_EVENT));
  } catch {
    /* ignore */
  }
};

export { COMMAND_OPEN_EVENT };

export const AppHeader: React.FC<AppHeaderProps> = ({
  left,
  right,
  showSearch = true,
  onSearchClick,
  className,
}) => {
  const navigate = useNavigate();
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  return (
    <header
      className={cn(
        'sticky top-0 z-10 bg-card/80 backdrop-blur-md border-b border-border',
        className,
      )}
    >
      <div className="flex items-center gap-3 px-4 lg:px-6 h-14">
        <div className="flex-1 min-w-0 flex items-center gap-3">{left}</div>

        <div className="flex items-center gap-2">
          {showSearch && (
            <button
              type="button"
              onClick={() => (onSearchClick ? onSearchClick() : openCommandPalette())}
              className="hidden md:flex items-center gap-2 h-9 w-72 px-3 rounded-lg border border-border bg-background hover:bg-secondary text-muted-foreground transition-colors text-sm"
            >
              <Search className="w-4 h-4" />
              <span className="flex-1 text-left">Search projects, tasks…</span>
              <kbd className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-border bg-card">
                {isMac ? '⌘K' : 'Ctrl K'}
              </kbd>
            </button>
          )}
          {showSearch && (
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden text-muted-foreground"
              onClick={() => (onSearchClick ? onSearchClick() : openCommandPalette())}
              aria-label="Open command palette"
            >
              <Command className="w-4 h-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            onClick={() => navigate('/settings')}
            aria-label="Help"
            title="Help & shortcuts"
          >
            <HelpCircle className="w-4 h-4" />
          </Button>
          {right}
        </div>
      </div>
    </header>
  );
};

export default AppHeader;
