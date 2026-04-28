import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  applyMention,
  filterMentionMembers,
  getActiveMention,
  mentionLabelForMember,
  type MentionableMember,
} from "@/lib/mentionUtils";

export type { MentionableMember };

export interface MentionTextareaProps
  extends Omit<
    React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    "value" | "onChange"
  > {
  value: string;
  onChange: (value: string) => void;
  members: MentionableMember[];
  excludeUserId?: string;
}

export const MentionTextarea = React.forwardRef<
  HTMLTextAreaElement,
  MentionTextareaProps
>(function MentionTextarea(
  {
    value,
    onChange,
    members,
    excludeUserId,
    className,
    disabled,
    onKeyDown,
    onSelect,
    onClick,
    ...rest
  },
  forwardedRef,
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const setRefs = useCallback(
    (el: HTMLTextAreaElement | null) => {
      innerRef.current = el;
      if (typeof forwardedRef === "function") forwardedRef(el);
      else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
    },
    [forwardedRef],
  );

  const [selStart, setSelStart] = useState(0);
  const [highlight, setHighlight] = useState(0);
  const [dismissedFrom, setDismissedFrom] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const syncSelection = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    setSelStart(el.selectionStart);
  }, []);

  const mention = useMemo(
    () => getActiveMention(value, selStart),
    [value, selStart],
  );

  const filtered = useMemo(
    () =>
      mention
        ? filterMentionMembers(members, mention.query, excludeUserId, 12)
        : [],
    [mention, members, excludeUserId],
  );

  useEffect(() => {
    if (!mention) {
      setDismissedFrom(null);
      return;
    }
    if (dismissedFrom !== null && mention.from !== dismissedFrom) {
      setDismissedFrom(null);
    }
  }, [mention, dismissedFrom]);

  const open =
    Boolean(mention) &&
    filtered.length > 0 &&
    !disabled &&
    (dismissedFrom === null || mention!.from !== dismissedFrom);

  useLayoutEffect(() => {
    if (!open) return;
    setHighlight(0);
  }, [open, mention?.query, filtered.length]);

  useLayoutEffect(() => {
    if (!open || highlight < 0) return;
    const row = listRef.current?.querySelector(`[data-idx="${highlight}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  const pick = useCallback(
    (m: MentionableMember) => {
      if (!mention || !innerRef.current) return;
      const label = mentionLabelForMember(m);
      const { next, cursor } = applyMention(
        value,
        mention.from,
        selStart,
        label,
      );
      onChange(next);
      setDismissedFrom(null);
      requestAnimationFrame(() => {
        const el = innerRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(cursor, cursor);
        setSelStart(cursor);
      });
    },
    [mention, value, selStart, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (open) {
        if (e.key === "Escape") {
          e.preventDefault();
          if (mention) setDismissedFrom(mention.from);
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setHighlight((h) => (h + 1) % filtered.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const m = filtered[highlight];
          if (m) pick(m);
          return;
        }
        if (e.key === "Tab" && !e.shiftKey && filtered[highlight]) {
          e.preventDefault();
          pick(filtered[highlight]);
          return;
        }
      }
      onKeyDown?.(e);
    },
    [open, mention, filtered, highlight, pick, onKeyDown],
  );

  return (
    <div className="relative overflow-visible">
      <Textarea
        ref={setRefs}
        value={value}
        disabled={disabled}
        className={cn(className)}
        onChange={(e) => {
          onChange(e.target.value);
          setSelStart(e.target.selectionStart);
        }}
        onSelect={(e) => {
          syncSelection();
          onSelect?.(e);
        }}
        onClick={(e) => {
          syncSelection();
          onClick?.(e);
        }}
        onKeyUp={syncSelection}
        onKeyDown={handleKeyDown}
        {...rest}
      />
      {open && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md"
          role="listbox"
          aria-label="Mention teammate"
        >
          {filtered.map((m, idx) => (
            <button
              key={m.userId}
              type="button"
              data-idx={idx}
              role="option"
              aria-selected={idx === highlight}
              className={cn(
                "flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent",
                idx === highlight && "bg-accent",
              )}
              onMouseDown={(ev) => {
                ev.preventDefault();
                pick(m);
              }}
              onMouseEnter={() => setHighlight(idx)}
            >
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarImage src={m.photoURL} alt="" />
                <AvatarFallback className="text-[10px]">
                  {(m.displayName || "?").charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{m.displayName}</div>
                {m.email ? (
                  <div className="truncate text-xs text-muted-foreground">
                    {m.email}
                  </div>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
