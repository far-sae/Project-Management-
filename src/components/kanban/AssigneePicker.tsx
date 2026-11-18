import React, { useMemo, useState } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
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
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {value.map((a) => {
          const { display, photoURL } = resolveDisplay(a);
          return (
          <span
            key={a.userId}
            data-assignee-chip
            className="inline-flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border bg-background pl-0.5 pr-0.5 text-xs font-medium"
          >
            <Avatar className="h-[18px] w-[18px] shrink-0">
              <AvatarImage src={photoURL} alt="" />
              <AvatarFallback className="bg-secondary text-[10px] font-semibold text-foreground">
                {display.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 truncate text-foreground" title={display}>
              {display}
            </span>
            {disabled ? (
              <span className="w-1 shrink-0" aria-hidden />
            ) : (
              <button
                type="button"
                onClick={() =>
                  onChange(value.filter((x) => x.userId !== a.userId))
                }
                className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove ${display}`}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            )}
          </span>
          );
        })}

        <Popover open={disabled ? false : open} onOpenChange={disabled ? () => {} : setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-dashed border-input px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-secondary data-[state=open]:text-foreground"
              disabled={disabled}
            >
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
              Assign
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-72 p-0"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="flex h-10 items-center gap-2 border-b border-border px-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search people…"
                aria-label="Search people"
                autoFocus
                className="h-8 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-[13px]"
              />
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-6 text-center text-[13px] text-muted-foreground">
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
                      aria-pressed={selected}
                      className={cn(
                        'flex min-h-10 w-full items-center gap-2 px-3 py-1 text-left transition-colors hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none',
                        selected && 'bg-surface-2',
                      )}
                    >
                      <Avatar className="h-6 w-6 shrink-0">
                        <AvatarImage src={m.photoURL} alt="" />
                        <AvatarFallback className="bg-secondary text-[11px] font-semibold text-foreground">
                          {(m.displayName || m.email || '?')
                            .charAt(0)
                            .toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-foreground">
                          {m.displayName || m.email || 'Unknown'}
                        </p>
                        {m.email && (
                          <p className="truncate text-xs text-muted-foreground">
                            {m.email}
                          </p>
                        )}
                      </div>
                      {selected && (
                        <Check className="h-4 w-4 shrink-0 text-foreground" aria-hidden />
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
