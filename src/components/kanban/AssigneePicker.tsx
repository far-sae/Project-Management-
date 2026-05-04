import React, { useMemo, useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Search, UserPlus, X, Check } from 'lucide-react';
import { TaskAssignee } from '@/types';
import { cn } from '@/lib/utils';

interface AssignableMember {
  userId: string;
  displayName: string;
  email: string;
  photoURL: string;
}

interface AssigneePickerProps {
  value: TaskAssignee[];
  members: AssignableMember[];
  onChange: (assignees: TaskAssignee[]) => void;
  disabled?: boolean;
}

/** Searchable popover for picking task assignees from project members. */
export const AssigneePicker: React.FC<AssigneePickerProps> = ({
  value,
  members,
  onChange,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return members;
    const q = query.trim().toLowerCase();
    return members.filter(
      (m) =>
        (m.displayName || '').toLowerCase().includes(q) ||
        (m.email || '').toLowerCase().includes(q),
    );
  }, [members, query]);

  const isSelected = (userId: string) => value.some((a) => a.userId === userId);

  const toggle = (m: AssignableMember) => {
    if (disabled) return;
    if (isSelected(m.userId)) {
      onChange(value.filter((a) => a.userId !== m.userId));
    } else {
      onChange([
        ...value,
        {
          userId: m.userId,
          displayName: m.displayName || m.email || 'Unknown',
          email: m.email || '',
          photoURL: m.photoURL || '',
        },
      ]);
    }
  };

  // Older invites/tasks sometimes stored placeholder text like "Member" or
  // "Unknown" as the assignee's displayName. When rendering a chip, prefer
  // the freshly-loaded name from `members` (resolved against user_profiles)
  // and only fall back to the stored value if the user isn't in the project
  // members list anymore (e.g., they were removed).
  const resolveDisplay = (a: TaskAssignee) => {
    const fresh = members.find((m) => m.userId === a.userId);
    const stored = (a.displayName || '').trim();
    const isGeneric =
      !stored ||
      ['owner', 'admin', 'member', 'user', 'unknown', 'you'].includes(
        stored.toLowerCase(),
      );
    const display =
      fresh?.displayName ||
      (isGeneric
        ? (a.email?.split('@')[0] || a.email || 'Member')
        : stored) ||
      'Member';
    const photoURL = fresh?.photoURL || a.photoURL || '';
    return { display, photoURL };
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((a) => {
          const { display, photoURL } = resolveDisplay(a);
          return (
          <span
            key={a.userId}
            className="inline-flex items-center gap-1.5 pl-1 pr-1.5 py-0.5 bg-secondary rounded-full text-xs"
          >
            <Avatar className="w-5 h-5">
              <AvatarImage src={photoURL} alt={display} />
              <AvatarFallback className="text-[10px] bg-primary-soft text-primary-soft-foreground">
                {display.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="text-foreground max-w-[120px] truncate">
              {display}
            </span>
            <button
              type="button"
              onClick={() =>
                onChange(value.filter((x) => x.userId !== a.userId))
              }
              disabled={disabled}
              className="text-muted-foreground hover:text-destructive disabled:opacity-40"
              aria-label={`Remove ${display}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
          );
        })}

        <Popover open={disabled ? false : open} onOpenChange={disabled ? () => {} : setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs border-dashed"
              disabled={disabled}
            >
              <UserPlus className="w-3.5 h-3.5 mr-1" />
              Assign
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-72 p-0"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search people…"
                autoFocus
                className="flex-1 h-7 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No matching members
                </div>
              ) : (
                filtered.map((m) => {
                  const selected = isSelected(m.userId);
                  return (
                    <button
                      type="button"
                      key={m.userId}
                      onClick={() => toggle(m)}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-secondary',
                        selected && 'bg-secondary/60',
                      )}
                    >
                      <Avatar className="w-7 h-7 shrink-0">
                        <AvatarImage src={m.photoURL} alt={m.displayName} />
                        <AvatarFallback className="text-xs bg-primary-soft text-primary-soft-foreground">
                          {(m.displayName || m.email || '?')
                            .charAt(0)
                            .toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate text-foreground">
                          {m.displayName || m.email || 'Unknown'}
                        </p>
                        {m.email && (
                          <p className="text-[11px] text-muted-foreground truncate">
                            {m.email}
                          </p>
                        )}
                      </div>
                      {selected && (
                        <Check className="w-4 h-4 text-primary shrink-0" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
};

export default AssigneePicker;
