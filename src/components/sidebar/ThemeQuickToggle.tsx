import React from 'react';
import { Sun, Moon, Monitor, Rows, Rows3 } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { cn } from '@/lib/utils';

const MODES = [
  { id: 'light' as const, label: 'Light', icon: Sun },
  { id: 'system' as const, label: 'System', icon: Monitor },
  { id: 'dark' as const, label: 'Dark', icon: Moon },
];

export const ThemeQuickToggle: React.FC = () => {
  const { mode, setMode, density, setDensity } = useTheme();

  return (
    <div className="flex items-center gap-1.5">
      <div
        role="group"
        aria-label="Theme mode"
        className="flex items-center bg-secondary rounded-lg p-0.5 flex-1"
      >
        {MODES.map(({ id, label, icon: Icon }) => {
          const active = mode === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              aria-pressed={active}
              aria-label={label}
              title={label}
              className={cn(
                'flex-1 h-7 flex items-center justify-center rounded-md transition-colors',
                active
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() =>
          setDensity(density === 'compact' ? 'comfortable' : 'compact')
        }
        aria-pressed={density === 'compact'}
        aria-label={
          density === 'compact'
            ? 'Switch to comfortable density'
            : 'Switch to compact density'
        }
        title={density === 'compact' ? 'Compact' : 'Comfortable'}
        className={cn(
          'h-7 w-7 flex items-center justify-center rounded-md border border-border bg-background transition-colors hover:bg-secondary',
          density === 'compact' && 'text-primary border-primary/40',
        )}
      >
        {density === 'compact' ? (
          <Rows3 className="w-3.5 h-3.5" />
        ) : (
          <Rows className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  );
};

export default ThemeQuickToggle;
