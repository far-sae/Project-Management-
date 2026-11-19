// A PDF shown in the browser's own viewer, with a download link beside it.
import React, { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, Loader2 } from 'lucide-react';
import { errorSentence } from '@/lib/signroom/billing';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface PdfFrameProps {
  /** Fetches the PDF. Called again whenever `sourceKey` changes. */
  load: () => Promise<Blob>;
  /** Names what is being shown, so a new document (or a new revision) is fetched afresh. */
  sourceKey: string;
  /** Read out for the viewer, e.g. "Invoice INV-0001". */
  title: string;
  /** The name the file is saved under. */
  filename: string;
  className?: string;
}

/**
 * Loads a PDF once, shows it in an iframe on a blob URL, and frees the URL
 * when it goes away. The same file is offered as a download and in a new tab,
 * because some phones only show the first page inside a page.
 */
export const PdfFrame: React.FC<PdfFrameProps> = ({ load, sourceKey, title, filename, className }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    setUrl(null);
    setError('');
    loader.current()
      .then((blob) => {
        if (!alive) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch((err) => {
        if (alive) setError(errorSentence(err, 'The PDF could not be loaded.'));
      });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [sourceKey]);

  if (error) {
    return <p role="alert" className="rounded-md border border-border px-3 py-6 text-center text-sm text-destructive">{error}</p>;
  }
  if (!url) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-md border border-border px-3 py-10 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading the PDF
      </div>
    );
  }
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <iframe
        title={title}
        src={url}
        className="h-[70vh] min-h-[24rem] w-full rounded-md border border-border bg-secondary"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <a href={url} download={filename}><Download aria-hidden /> Download PDF</a>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden /> Open in a new tab</a>
        </Button>
      </div>
    </div>
  );
};

/** The same viewer in a dialog, for a quick look from a list. */
export const PdfDialog: React.FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  heading: string;
  description?: string;
} & Omit<PdfFrameProps, 'className'>> = ({ open, onOpenChange, heading, description, ...frame }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-3xl">
      <DialogHeader>
        <DialogTitle>{heading}</DialogTitle>
        <DialogDescription>{description ?? 'This is the PDF your customer receives.'}</DialogDescription>
      </DialogHeader>
      {open && <PdfFrame {...frame} />}
    </DialogContent>
  </Dialog>
);

export default PdfFrame;
