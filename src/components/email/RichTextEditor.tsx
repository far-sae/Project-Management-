import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertTriangle, Bold, Braces, Code2, Image as ImageIcon, Italic, Link2, List,
  ListOrdered, Redo2,
  RemoveFormatting, Underline, Undo2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { placeholdersIntact, placeholdersUsed, plainTextToHtml, sanitizePastedHtml } from '@/lib/email/richText';
import { escapeHtml } from '@/lib/email/substitute';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Merge fields the user can insert, e.g. ['first_name','company','angle']. */
  mergeFields?: string[];
}

/** Strips tags the way the warning below needs them stripped: enough to tell
 *  whether there is any writing in the body, and to rejoin a `{{placeholder}}`
 *  the browser split across two elements. */
const textOf = (html: string): string => html.replace(/<[^>]*>/g, '');

interface ToolButtonProps {
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}

/** A toolbar button that does not take focus. `onMouseDown` is where the
 *  selection would be lost — by the time `onClick` runs the caret has already
 *  left the editor and `document.execCommand` has nothing to act on. */
const ToolButton: React.FC<ToolButtonProps> = ({ label, icon, disabled, onClick }) => (
  <Button
    type="button" variant="ghost" size="sm" className="px-2"
    title={label} aria-label={label} disabled={disabled}
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
  >
    {icon}
  </Button>
);

/**
 * The message body, written rather than typed as markup.
 *
 * A `contentEditable` surface driven by `document.execCommand`. That API is
 * formally deprecated and universally supported, and the alternative is a
 * document model of our own — which is precisely what decision 2 below rules
 * out. No editor dependency: the reference implementation does not use one and
 * an email body that needs more than this toolbar renders badly in Outlook
 * anyway.
 *
 * Three things matter more here than the toolbar does:
 *
 * 1. `{{placeholder}}` text survives editing. `substitutePlaceholders` matches
 *    the literal braces, so a placeholder the browser split across two
 *    elements is never substituted and the recipient is greeted as
 *    `{{first_name}}`. Merge fields go in as plain text, and a break that
 *    happens anyway is reported rather than repaired — a repair that guesses
 *    wrong loses the person's writing.
 * 2. The output IS the stored `body_html`. `innerHTML` goes straight to
 *    `onChange`; there is no second representation to drift from what was
 *    typed.
 * 3. Paste is cleaned on the way in, so Word's `mso-` markup never reaches the
 *    body — and cleaned on paste rather than on save, so the person sees what
 *    they actually got.
 */
export const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value, onChange, placeholder, disabled, mergeFields = [],
}) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [showSource, setShowSource] = useState(false);
  /**
   * The last HTML this component handed to `onChange`.
   *
   * The sync below compares `value` against THIS rather than against the live
   * `innerHTML`, and the difference is not academic. `useEffect` is passive:
   * its closure holds `value` from the render it was scheduled in, while
   * `innerHTML` keeps moving. React flushes a pending passive effect at the
   * top of the next synchronous render — i.e. while handling the NEXT input
   * event — so with two inputs inside one window the guard sees a stale
   * `value` against a newer DOM, writes the old string back, and takes the
   * newest character with it while collapsing the caret to the start.
   *
   * Two inputs in one window is not exotic: key autorepeat does it, and an IME
   * does it on every keystroke, emitting several `insertCompositionText`
   * events per character. Comparing against what we last emitted makes the
   * guard true only when the value really did change underneath us.
   */
  const lastEmitted = useRef<string>('');
  /**
   * True while an input method is composing — Japanese, Chinese, Korean, and
   * the accent menus on macOS. Nothing may rewrite `innerHTML` mid-composition
   * or the half-formed word is destroyed and the IME loses its anchor.
   */
  const composing = useRef(false);

  // Only written when the incoming value is not already what the editor holds.
  // Writing `innerHTML` on every keystroke re-creates the nodes the caret sits
  // in and drops it back to position 0, which turns typing a sentence into
  // typing it backwards.
  useEffect(() => {
    const el = editorRef.current;
    if (!el || showSource || composing.current) return;
    // Against `lastEmitted`, not `el.innerHTML` — see the ref's own comment.
    if (value === lastEmitted.current) return;
    if (value !== el.innerHTML) el.innerHTML = value;
    lastEmitted.current = value;
  }, [value, showSource]);

  const emit = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    lastEmitted.current = el.innerHTML;
    onChange(el.innerHTML);
  }, [onChange]);

  // The caret has to be remembered as it moves, because the merge-field menu
  // and the link prompt both take focus away before we get to use it.
  const rememberSelection = useCallback(() => {
    const el = editorRef.current;
    const selection = window.getSelection();
    if (!el || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (el.contains(range.commonAncestorContainer)) savedRange.current = range.cloneRange();
  }, []);

  const restoreSelection = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const selection = window.getSelection();
    if (!selection || !savedRange.current) return;
    selection.removeAllRanges();
    selection.addRange(savedRange.current);
  }, []);

  const exec = useCallback((command: string, argument?: string) => {
    if (disabled) return;
    restoreSelection();
    document.execCommand(command, false, argument);
    rememberSelection();
    emit();
  }, [disabled, restoreSelection, rememberSelection, emit]);

  const insertMergeField = useCallback((name: string) => {
    if (disabled) return;
    restoreSelection();
    // `insertText`, never a styled span or a wrapper element: the whole point
    // of a merge field is that it reaches substitution as literal text.
    document.execCommand('insertText', false, `{{${name}}}`);
    rememberSelection();
    emit();
  }, [disabled, restoreSelection, rememberSelection, emit]);

  const applyImage = useCallback(() => {
    if (disabled) return;
    // By URL, not by upload. A mail body cannot carry a local file, and an
    // image embedded as a data: URI is both enormous and what several filters
    // score hardest — it has to be hosted somewhere the recipient's client can
    // reach.
    const url = window.prompt('Image URL');
    if (!url) return;
    const trimmed = url.trim();
    // The same allowlist the link path uses. A javascript: or data: source is
    // not an image anybody meant to insert, and no mail client honours one.
    if (!/^https?:/i.test(trimmed)) {
      window.alert('An image needs a full https:// address.');
      return;
    }
    restoreSelection();
    document.execCommand('insertImage', false, trimmed);
    rememberSelection();
    emit();
  }, [disabled, restoreSelection, rememberSelection, emit]);

  const applyLink = useCallback(() => {
    if (disabled) return;
    const url = window.prompt('Link to which address?', 'https://');
    if (!url) return;
    restoreSelection();
    const selection = window.getSelection();
    // `createLink` does nothing to a collapsed caret, which reads as a dead
    // button — with nothing selected the address becomes its own link text.
    if (!selection || selection.isCollapsed) {
      document.execCommand('insertHTML', false, `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`);
    } else {
      document.execCommand('createLink', false, url);
    }
    rememberSelection();
    emit();
  }, [disabled, restoreSelection, rememberSelection, emit]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const cleaned = html ? sanitizePastedHtml(html) : plainTextToHtml(text);
    e.preventDefault();
    document.execCommand('insertHTML', false, cleaned);
    emit();
  }, [disabled, emit]);

  // Named rather than merely counted: "a merge field is broken" sends the
  // person hunting through their own paragraph. A placeholder that is whole
  // once the tags come out but not with them in is one the browser split.
  const broken = !placeholdersIntact(value);
  const brokenFields = useMemo(() => {
    if (!broken) return [];
    const whole = placeholdersUsed(value);
    return placeholdersUsed(textOf(value)).filter((name) => !whole.includes(name));
  }, [broken, value]);

  const isEmpty = textOf(value).replace(/&nbsp;/g, ' ').trim().length === 0;

  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-input bg-background">
        <div className="flex flex-wrap items-center gap-0.5 border-b border-border p-1">
          <ToolButton label="Bold" disabled={disabled || showSource} icon={<Bold className="w-4 h-4" />}
            onClick={() => exec('bold')} />
          <ToolButton label="Italic" disabled={disabled || showSource} icon={<Italic className="w-4 h-4" />}
            onClick={() => exec('italic')} />
          <ToolButton label="Underline" disabled={disabled || showSource} icon={<Underline className="w-4 h-4" />}
            onClick={() => exec('underline')} />
          <ToolButton label="Bulleted list" disabled={disabled || showSource} icon={<List className="w-4 h-4" />}
            onClick={() => exec('insertUnorderedList')} />
          <ToolButton label="Numbered list" disabled={disabled || showSource} icon={<ListOrdered className="w-4 h-4" />}
            onClick={() => exec('insertOrderedList')} />
          <ToolButton label="Link" disabled={disabled || showSource} icon={<Link2 className="w-4 h-4" />}
            onClick={applyLink} />
          <ToolButton label="Image by URL" disabled={disabled || showSource} icon={<ImageIcon className="w-4 h-4" />}
            onClick={applyImage} />
          <ToolButton label="Clear formatting" disabled={disabled || showSource} icon={<RemoveFormatting className="w-4 h-4" />}
            onClick={() => { exec('removeFormat'); exec('unlink'); }} />
          <ToolButton label="Undo" disabled={disabled || showSource} icon={<Undo2 className="w-4 h-4" />}
            onClick={() => exec('undo')} />
          <ToolButton label="Redo" disabled={disabled || showSource} icon={<Redo2 className="w-4 h-4" />}
            onClick={() => exec('redo')} />

          <div className="ml-auto flex items-center gap-0.5">
            {mergeFields.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="px-2"
                    disabled={disabled || showSource} onMouseDown={(e) => e.preventDefault()}>
                    <Braces className="w-4 h-4 mr-1" />
                    Merge field
                  </Button>
                </DropdownMenuTrigger>
                {/* Radix hands focus back to the trigger on close, which would
                    undo the caret we just restored and drop the insert at the
                    top of the body. */}
                <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()}>
                  <DropdownMenuLabel>Insert a merge field</DropdownMenuLabel>
                  {mergeFields.map((field) => (
                    <DropdownMenuItem key={field} onSelect={() => insertMergeField(field)}>
                      <span className="font-mono text-xs">{`{{${field}}}`}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button type="button" variant={showSource ? 'secondary' : 'ghost'} size="sm" className="px-2"
              title="Show the raw HTML" aria-pressed={showSource}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowSource((s) => !s)}>
              <Code2 className="w-4 h-4 mr-1" />
              Source
            </Button>
          </div>
        </div>

        {showSource ? (
          <Textarea
            value={value} disabled={disabled}
            className="min-h-[180px] rounded-none border-0 px-3 py-2 font-mono text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <div className="relative">
            {isEmpty && placeholder && (
              <span className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">
                {placeholder}
              </span>
            )}
            <div
              ref={editorRef}
              contentEditable={!disabled}
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label={placeholder ?? 'Message body'}
              className={cn(
                'min-h-[180px] w-full px-3 py-2 text-sm outline-none',
                '[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5',
                '[&_a]:text-primary [&_a]:underline',
                disabled && 'cursor-not-allowed opacity-50',
              )}
              onInput={emit}
              // Nothing may rewrite innerHTML while an input method is
              // composing: a half-formed Japanese or Chinese word would be
              // destroyed and the IME would lose its anchor mid-character.
              onCompositionStart={() => { composing.current = true; }}
              onCompositionEnd={() => { composing.current = false; emit(); }}
              onPaste={handlePaste}
              onKeyUp={rememberSelection}
              onMouseUp={rememberSelection}
              onBlur={rememberSelection}
            />
          </div>
        )}
      </div>

      {/* Reported, not repaired. Rejoining the braces means guessing which of
          the two elements the person meant the text to stay in, and guessing
          wrong deletes writing — whereas a campaign that goes out with a split
          field greets everybody by the same literal `{{first_name}}`. */}
      {broken && (
        <p className="flex items-start gap-1.5 text-xs text-orange-700 dark:text-orange-300">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            Formatting has split{' '}
            {brokenFields.length > 0 ? brokenFields.map((f) => `{{${f}}}`).join(', ') : 'a merge field'}
            {' '}in two, so it will be sent as it stands instead of being filled in. Open Source
            and retype the braces together, or clear the formatting over that word.
          </span>
        </p>
      )}
    </div>
  );
};

export default RichTextEditor;
