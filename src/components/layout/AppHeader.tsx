import React, { type ReactNode } from 'react';
import {
  Search,
  Command,
  HelpCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { openShortcutsModal } from '@/components/command/CommandPalette';

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
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  return (
    <header
      className={cn(
        'sticky top-0 z-10 border-b border-border/70 bg-card/80 shadow-sm shadow-black/5 backdrop-blur-xl',
        className,
      )}
    >
      <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
        <div className="flex-1 min-w-0 flex items-center gap-3">{left}</div>

        <div className="flex items-center gap-2">
          {showSearch && (
            <button
              type="button"
              onClick={() => (onSearchClick ? onSearchClick() : openCommandPalette())}
              className="hidden h-10 w-80 items-center gap-2 rounded-lg border border-border/70 bg-background/80 px-3 text-sm text-muted-foreground shadow-sm transition-colors hover:bg-secondary md:flex"
            >
              <Search className="w-4 h-4" />
              <span className="flex-1 text-left">Search projects, tasks…</span>
              <kbd className="rounded border border-border/70 bg-card px-1.5 py-0.5 text-[10px] font-medium">
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
            onClick={() => openShortcutsModal()}
            aria-label="Keyboard shortcuts and help"
            title="Shortcuts & help (?)"
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
