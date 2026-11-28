// The document beside the editor, as it will look: the text being typed, drawn
// by the server as the PDF it would become, with the workspace's letterhead,
// logo and font. It follows the typing: a moment after it stops, the page is
// drawn again. The PDF signers get is still the one "Prepare signing PDF"
// makes and freezes; this one is only looked at, and nothing of it is stored.
import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { DOCUMENT_FONTS, documentFont, type DocumentFont } from '../../../../api/_signroom/shared/documentFonts';
import type { Workspace } from '../../../../api/_signroom/shared/types';
import { agreementPreviewPdf } from '@/components/signroom/billing/brandingPreviewRequest';
import { useSignroom } from '@/hooks/useSignroom';
import { errorSentence } from '@/lib/signroom/billing';

/** The fonts with serifs: the ones a formal document is usually set in. */
const FORMAL: readonly string[] = ['lora', 'source-serif'];

interface Props {
  workspaceId: string;
  agreementId: string;
  title: string;
  content: string;
  /** How long typing must rest before the page is drawn again. */
  delayMs?: number;
  className?: string;
}

export const AgreementLivePreview: React.FC<Props> = ({ workspaceId, agreementId, title, content, delayMs = 1200, className }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [problem, setProblem] = useState('');
  const [pending, setPending] = useState(false);
  /** Counts requests, so an answer that a newer text has overtaken is dropped. */
  const latest = useRef(0);
  const shown = useRef<string | null>(null);
  const first = useRef(true);
  const lookSeen = useRef(0);
  const empty = !content.trim();
  /** Goes up when the look changes (a new font), so the page is drawn again. */
  const [look, setLook] = useState(0);

  useEffect(() => {
    if (empty) {
      latest.current += 1;
      setPending(false);
      setProblem('');
      return;
    }
    setPending(true);
    // Opening the editor on a text shows it at once; after that, typing is waited out.
    // A new font is not typing: it is shown at once too.
    const wait = first.current || lookSeen.current !== look ? 0 : delayMs;
    first.current = false;
    lookSeen.current = look;
    const timer = setTimeout(() => {
      const mine = ++latest.current;
      agreementPreviewPdf(workspaceId, agreementId, { title, content })
        .then((blob) => {
          if (mine !== latest.current) return;
          const next = URL.createObjectURL(blob);
          // The page before stays on screen until this one is ready, then is freed.
          if (shown.current) URL.revokeObjectURL(shown.current);
          shown.current = next;
          setUrl(next);
          setProblem('');
        })
        .catch((error) => {
          if (mine === latest.current) setProblem(errorSentence(error, 'The preview could not be drawn. It is tried again when the text changes.'));
        })
        .finally(() => {
          if (mine === latest.current) setPending(false);
        });
    }, wait);
    return () => clearTimeout(timer);
  }, [workspaceId, agreementId, title, content, delayMs, empty, look]);

  // Leaving the editor frees the page that was shown.
  useEffect(() => () => {
    latest.current += 1;
    if (shown.current) URL.revokeObjectURL(shown.current);
    shown.current = null;
  }, []);

  return (
    <section aria-label="How the document will look" className={className}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          How it will look
          <span aria-live="polite" className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
            {pending && !empty ? <><Loader2 className="h-3 w-3 animate-spin" aria-hidden />Updating…</> : ''}
          </span>
        </h3>
        <FontChoice onChanged={() => setLook((n) => n + 1)} />
        <a
          href="/crm/document-settings" target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline underline-offset-4"
        >
          Letterhead, logo and font <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </div>

      <div className="mt-2">
        {empty ? (
          <p className="flex min-h-[24rem] items-center justify-center rounded-md border border-dashed border-border px-4 text-center text-sm text-muted-foreground">
            Start writing, and the document shows here with your letterhead.
          </p>
        ) : (
          <>
            {problem && <p role="alert" className="mb-2 rounded-md border border-border px-3 py-2 text-sm text-destructive">{problem}</p>}
            {url ? (
              <iframe
                title="Preview of the agreement" src={`${url}`}
                className={`h-[70vh] min-h-[24rem] w-full rounded-md border border-border bg-secondary ${problem ? 'opacity-60' : ''}`}
              />
            ) : !problem && (
              <div className="flex min-h-[24rem] items-center justify-center gap-2 rounded-md border border-border text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Drawing the document
              </div>
            )}
          </>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Drawn with your letterhead as it is now. The PDF your signers get is made, and frozen, when you prepare it.
      </p>
    </section>
  );
};

/**
 * The font of the workspace's documents, changed without leaving the draft.
 * It is the same setting as in Document settings, so it is the owner's to
 * change, and it applies to every document made from now on (a document that
 * was already issued or sent keeps the look it has).
 */
const FontChoice: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const { client, workspaceId } = useSignroom();
  /** The look as saved. Null until known, and for somebody who may not change it. */
  const [saved, setSaved] = useState<Workspace['branding'] | null | undefined>(undefined);
  const [owner, setOwner] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setOwner(false);
    if (!workspaceId) return;
    client.call<{ workspace: Workspace; role: 'Owner' | 'Member' }>('session')
      .then((view) => {
        if (!alive) return;
        setSaved(view?.workspace?.branding ?? null);
        setOwner(view?.role === 'Owner');
      })
      .catch(() => { /* not known: the choice is simply not offered */ });
    return () => { alive = false; };
  }, [client, workspaceId]);

  if (!owner) return null;
  const current = documentFont(saved?.fontFamily).id;

  const choose = async (next: DocumentFont) => {
    if (next === current) return;
    setBusy(true);
    try {
      // The layout and the side of the logo go along: the server puts both back to its own when they are left out.
      const body = { fontFamily: next, layout: saved?.layout === 'minimal' ? 'minimal' : 'letterhead', logoPosition: saved?.logoPosition === 'right' ? 'right' : 'left' };
      const workspace = await client.call<Workspace>('workspaces/branding', body);
      setSaved(workspace?.branding ?? { ...(saved ?? {}), fontFamily: next } as Workspace['branding']);
      toast.success(`Your documents now use ${documentFont(next).label}.`);
      onChanged();
    } catch (error) {
      toast.error(errorSentence(error, 'The font could not be changed. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      Font
      <select
        aria-label="Font of your documents" value={current} disabled={busy}
        title="The font of every document this workspace makes from now on"
        onChange={(e) => void choose(e.target.value as DocumentFont)}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
      >
        {DOCUMENT_FONTS.map((f) => <option key={f.id} value={f.id}>{FORMAL.includes(f.id) ? `${f.label} (formal)` : f.label}</option>)}
      </select>
    </label>
  );
};

export default AgreementLivePreview;
