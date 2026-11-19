import React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Check, ChevronDown, Minus, Palmtree } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import type { PresenceStatusPreference } from '@/hooks/usePresenceStatusPreference';

const OPTIONS: Array<{ value: PresenceStatusPreference; label: string; description: string }> = [
  { value: 'auto', label: 'Online', description: 'Shown as online while this tab is open.' },
  { value: 'dnd', label: 'Do not disturb', description: 'Mutes message sounds and pop-ups. Calls still ring.' },
  { value: 'holiday', label: 'On holiday', description: 'Others see that you are away.' },
  { value: 'appear_offline', label: 'Appear offline', description: 'You are left out of the online list.' },
];

const optionFor = (preference: PresenceStatusPreference) =>
  OPTIONS.find((o) => o.value === preference) ?? OPTIONS[0]!;

/** The small mark that stands for a status: green dot, red "no entry", palm tree, hollow ring. */
const StatusGlyph: React.FC<{ status: PresenceStatusPreference; className?: string }> = ({ status, className }) => {
  const box = cn('inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full', className);
  if (status === 'dnd') {
    return (
      <span aria-hidden className={cn(box, 'bg-destructive text-destructive-foreground')}>
        <Minus className="h-2.5 w-2.5" strokeWidth={4} />
      </span>
    );
  }
  if (status === 'holiday') {
    return (
      <span aria-hidden className={cn(box, 'bg-info text-info-foreground')}>
        <Palmtree className="h-2 w-2" strokeWidth={3} />
      </span>
    );
  }
  if (status === 'appear_offline') {
    return <span aria-hidden className={cn(box, 'border-2 border-muted-foreground bg-background')} />;
  }
  return <span aria-hidden className={cn(box, 'bg-success')} />;
};

const initialsOf = (name: string): string =>
  name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';

interface PresenceStatusMenuProps {
  preference: PresenceStatusPreference;
  onChange: (p: PresenceStatusPreference) => void;
}

/** What opens from either trigger: who you are, how you appear now, and the choices. */
const StatusMenuBody: React.FC<PresenceStatusMenuProps> = ({ preference, onChange }) => {
  const { user } = useAuth();
  const name = user?.displayName || user?.email || 'You';
  const active = optionFor(preference);

  return (
    <DropdownMenuContent align="end" className="w-72 p-0">
      <div className="flex items-center gap-3 px-3 py-3">
        <span className="relative shrink-0">
          <Avatar className="h-10 w-10">
            <AvatarImage src={user?.photoURL || undefined} alt="" />
            <AvatarFallback className="bg-primary-soft text-sm font-semibold text-primary-soft-foreground">
              {initialsOf(name)}
            </AvatarFallback>
          </Avatar>
          <StatusGlyph status={preference} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-popover" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-5 text-foreground">{name}</p>
          {user?.email && user.email !== name && (
            <p className="truncate text-xs leading-4 text-muted-foreground">{user.email}</p>
          )}
          <p data-current-status className="mt-0.5 truncate text-xs font-medium leading-4 text-foreground">
            {active.label}
          </p>
        </div>
      </div>
      <DropdownMenuSeparator className="my-0" />
      <DropdownMenuPrimitive.RadioGroup
        value={preference}
        onValueChange={(next) => onChange(next as PresenceStatusPreference)}
        aria-label="Set your status"
        className="p-1"
      >
        {OPTIONS.map((o) => (
          <DropdownMenuPrimitive.RadioItem
            key={o.value}
            value={o.value}
            className={cn(
              'relative flex cursor-default select-none items-start gap-2.5 rounded-md px-2 py-2 outline-none transition-colors',
              'focus:bg-accent data-[state=checked]:bg-secondary',
            )}
          >
            <StatusGlyph status={o.value} className="mt-1" />
            <span className="min-w-0 flex-1">
              <span data-testid="status-label" className="block text-sm font-medium leading-5 text-foreground">
                {o.label}
              </span>
              <span className="block text-xs leading-4 text-muted-foreground">{o.description}</span>
            </span>
            <DropdownMenuPrimitive.ItemIndicator className="mt-0.5 shrink-0">
              <Check className="h-4 w-4 text-foreground" aria-hidden />
            </DropdownMenuPrimitive.ItemIndicator>
          </DropdownMenuPrimitive.RadioItem>
        ))}
      </DropdownMenuPrimitive.RadioGroup>
      <DropdownMenuSeparator className="my-0" />
      <p className="px-3 py-2 text-xs leading-4 text-muted-foreground">
        People in your projects see this next to your name. It is remembered on this device.
      </p>
    </DropdownMenuContent>
  );
};

/** Your status as a button with its name (for toolbars). */
export const PresenceStatusMenu: React.FC<PresenceStatusMenuProps> = ({ preference, onChange }) => {
  const active = optionFor(preference);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" className="font-normal" aria-label={`Your status: ${active.label}`}>
          <StatusGlyph status={preference} />
          <span className="hidden max-w-[9rem] truncate sm:inline">{active.label}</span>
          <ChevronDown className="text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <StatusMenuBody preference={preference} onChange={onChange} />
    </DropdownMenu>
  );
};

/** Your status behind your profile picture (for the project header). */
export const PresenceStatusAvatarMenu: React.FC<PresenceStatusMenuProps & { className?: string }> = ({
  preference,
  onChange,
  className,
}) => {
  const { user } = useAuth();
  const active = optionFor(preference);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'relative rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            className,
          )}
          title={`Your status: ${active.label}`}
          aria-label={`Your status: ${active.label}`}
        >
          <Avatar className="h-8 w-8">
            <AvatarImage src={user?.photoURL || undefined} alt="" />
            <AvatarFallback className="bg-primary-soft text-xs font-semibold text-primary-soft-foreground">
              {initialsOf(user?.displayName || user?.email || '?')}
            </AvatarFallback>
          </Avatar>
          <StatusGlyph status={preference} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-background" />
        </button>
      </DropdownMenuTrigger>
      <StatusMenuBody preference={preference} onChange={onChange} />
    </DropdownMenu>
  );
};

export default PresenceStatusMenu;
