import React from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Check, Circle, EyeOff, Palmtree, Sparkles, BellOff } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import type { PresenceStatusPreference } from '@/hooks/usePresenceStatusPreference';

const OPTIONS: {
  value: PresenceStatusPreference;
  label: string;
  description: string;
  icon: React.ReactNode;
}[] = [
  {
    value: 'auto',
    label: 'Auto',
    description: 'Online with this tab, offline in background',
    icon: <Sparkles className="w-4 h-4" />,
  },
  {
    value: 'appear_offline',
    label: 'Appear offline',
    description: 'Hide from the online list for this project',
    icon: <EyeOff className="w-4 h-4" />,
  },
  {
    value: 'dnd',
    label: 'Do not disturb',
    description: 'Shown to others; blocks distraction styling',
    icon: <BellOff className="w-4 h-4" />,
  },
  {
    value: 'holiday',
    label: 'Holiday',
    description: 'Let others know you are away',
    icon: <Palmtree className="w-4 h-4" />,
  },
];

interface PresenceStatusMenuProps {
  preference: PresenceStatusPreference;
  onChange: (p: PresenceStatusPreference) => void;
}

/** Current-user presence mode for the project (stored locally). */
export const PresenceStatusMenu: React.FC<PresenceStatusMenuProps> = ({
  preference,
  onChange,
}) => {
  const active = OPTIONS.find((o) => o.value === preference) ?? OPTIONS[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs font-normal"
          title="How you appear to others in this project"
        >
          <span className="text-muted-foreground" aria-hidden>
            {active.icon}
          </span>
          <span className="max-w-[9rem] truncate hidden sm:inline">
            {active.label}
          </span>
          <Circle className="w-2 h-2 fill-primary text-primary shrink-0" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Your status
        </DropdownMenuLabel>
        {OPTIONS.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onSelect={() => onChange(o.value)}
            className="flex flex-col items-stretch gap-0.5 py-2"
          >
            <div className="flex items-center gap-2 w-full">
              {o.icon}
              <span className="font-medium text-sm flex-1">{o.label}</span>
              {preference === o.value && (
                <Check className="w-4 h-4 text-primary shrink-0" />
              )}
            </div>
            <p className="text-[11px] text-muted-foreground pl-6 leading-snug">
              {o.description}
            </p>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-[10px] text-muted-foreground leading-relaxed">
          With <span className="font-medium text-foreground">Auto</span>, others see
          you online or offline based on this tab. Other modes are manual.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const avatarStatusDot = (p: PresenceStatusPreference): string => {
  switch (p) {
    case 'appear_offline':
      return 'bg-muted-foreground/80';
    case 'dnd':
      return 'bg-amber-500';
    case 'holiday':
      return 'bg-sky-500';
    case 'auto':
    default:
      return 'bg-emerald-500';
  }
};

/** Status dropdown with your profile image as the trigger (for project header). */
export const PresenceStatusAvatarMenu: React.FC<PresenceStatusMenuProps & { className?: string }> = ({
  preference,
  onChange,
  className,
}) => {
  const { user } = useAuth();
  const initial =
    (user?.displayName || user?.email || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0])
      .join('')
      .toUpperCase() || '?';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'relative rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            className,
          )}
          title="Your status in this project"
          aria-label="Your status in this project"
        >
          <Avatar className="h-8 w-8 ring-2 ring-border">
            <AvatarImage src={user?.photoURL || undefined} alt={user?.displayName || ''} />
            <AvatarFallback className="text-xs">{initial}</AvatarFallback>
          </Avatar>
          <span
            className={cn(
              'absolute bottom-0 right-0 block w-2.5 h-2.5 rounded-full ring-2 ring-card',
              avatarStatusDot(preference),
            )}
            aria-hidden
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
          Your status
        </DropdownMenuLabel>
        {OPTIONS.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onSelect={() => onChange(o.value)}
            className="flex flex-col items-stretch gap-0.5 py-2"
          >
            <div className="flex items-center gap-2 w-full">
              {o.icon}
              <span className="font-medium text-sm flex-1">{o.label}</span>
              {preference === o.value && (
                <Check className="w-4 h-4 text-primary shrink-0" />
              )}
            </div>
            <p className="text-[11px] text-muted-foreground pl-6 leading-snug">
              {o.description}
            </p>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-[10px] text-muted-foreground leading-relaxed">
          With <span className="font-medium text-foreground">Auto</span>, others see
          you online or offline based on this tab. Other modes are manual.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default PresenceStatusMenu;
