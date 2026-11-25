// Text the autopilot wrote (a study, the trends, notes from a website, its
// rules), shown the way it was meant: headings as headings, points as a list,
// and **strong** words strong. The text is never run as HTML: it is read line
// by line and built from plain elements.
import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

export type NoteBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'text'; text: string };

const HASH_HEADING = /^#{1,6}\s+(.+)$/;
const STAR_HEADING = /^\*\*([^*]+?)\*\*:?$/;
const ITEM = /^(?:[-*•–]|\d{1,2}[.)])\s+(.+)$/;
/** A short line with no full stop that names what follows: "YouTube", "What it sells:". */
const looksLikeLabel = (line: string): boolean => line.length <= 48 && !/[.!?,;]$/.test(line.replace(/:$/, '')) && !ITEM.test(line);

/**
 * The text as blocks. `rules`: every line is a point of its own (a playbook is
 * written as short lines, not as paragraphs).
 */
export function blocksOf(raw: string, mode: 'prose' | 'rules' = 'prose'): NoteBlock[] {
  const lines = raw.replace(/\r/g, '').split('\n').map((l) => l.trim());
  const blocks: NoteBlock[] = [];
  const last = (): NoteBlock | undefined => blocks[blocks.length - 1];
  let gap = true;
  lines.forEach((line, i) => {
    if (!line) { gap = true; return; }
    const heading = line.match(HASH_HEADING)?.[1] ?? line.match(STAR_HEADING)?.[1];
    const item = line.match(ITEM)?.[1];
    const next = lines.slice(i + 1).find((l) => l !== '') ?? '';
    const prev = last();
    if (heading) {
      blocks.push({ kind: 'heading', text: heading.replace(/:$/, '').trim() });
    } else if (item) {
      if (prev?.kind === 'list') prev.items.push(item); else blocks.push({ kind: 'list', items: [item] });
    } else if (looksLikeLabel(line) && (line.endsWith(':') || ITEM.test(next)) && mode === 'prose') {
      // "YouTube" alone on a line with points under it, or "What you can do now:".
      blocks.push({ kind: 'heading', text: line.replace(/:$/, '').trim() });
    } else if (mode === 'rules') {
      if (prev?.kind === 'list') prev.items.push(line); else blocks.push({ kind: 'list', items: [line] });
    } else if (prev?.kind === 'text' && !gap) {
      prev.text += ` ${line}`;
    } else {
      blocks.push({ kind: 'text', text: line });
    }
    gap = false;
  });
  return blocks;
}

/** **strong** inside a line. Any other star is shown as it is. */
export function inline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) => {
    const strong = part.match(/^\*\*([^*]+)\*\*$/)?.[1];
    return strong ? <strong key={i} className="font-medium text-foreground">{strong}</strong> : <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

interface Props {
  text: string;
  mode?: 'prose' | 'rules';
  /** Longer than this many characters: the rest is folded away behind "Show all". */
  foldAt?: number;
  className?: string;
}

export const RichNote: React.FC<Props> = ({ text, mode = 'prose', foldAt = 900, className }) => {
  const [open, setOpen] = useState(false);
  const blocks = blocksOf(text, mode);
  const long = text.length > foldAt;
  return (
    <div className={className}>
      <div className={cn('relative flex max-w-3xl flex-col gap-3 text-sm leading-6 text-muted-foreground', long && !open && 'max-h-60 overflow-hidden')}>
        {blocks.map((block, i) => (
          block.kind === 'heading' ? (
            <h5 key={i} className={cn('text-sm font-semibold text-foreground', i > 0 && 'mt-1')}>{inline(block.text)}</h5>
          ) : block.kind === 'list' ? (
            <ul key={i} className="flex flex-col gap-1.5">
              {block.items.map((item, n) => (
                <li key={n} className="flex gap-2.5">
                  <span aria-hidden className="mt-[0.6rem] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                  <span className="min-w-0">{inline(item)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p key={i}>{inline(block.text)}</p>
          )
        ))}
        {long && !open && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />}
      </div>
      {long && (
        <button
          type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className="mt-2 inline-flex items-center gap-1 rounded text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {open ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}{open ? 'Show less' : 'Show all'}
        </button>
      )}
    </div>
  );
};

export default RichNote;
