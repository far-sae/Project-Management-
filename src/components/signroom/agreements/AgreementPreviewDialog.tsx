import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import PdfViewer from '@/components/signroom/PdfViewer';
import type { Agreement } from '../../../../api/_signroom/shared/types';
import { agreementPath } from './AgreementRowActions';

/**
 * A quick look at one agreement from the list: the PDF once there is one (the
 * signed PDF once completed), otherwise the draft's text.
 */
export const AgreementPreviewDialog: React.FC<{
  agreement: Agreement | null;
  onClose: () => void;
}> = ({ agreement: a, onClose }) => (
  <Dialog open={a !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="sm:max-w-3xl">
      {a && (
        <>
          <DialogHeader>
            <DialogTitle>{a.title}</DialogTitle>
            <DialogDescription>{a.type} · {a.status}</DialogDescription>
          </DialogHeader>
          {a.documentHash ? (
            <PdfViewer agreement={{ id: a.id, kind: a.status === 'Completed' ? 'final' : 'source', version: a.documentHash }} />
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">No PDF has been prepared yet. Draft text:</p>
              <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-secondary/50 p-3 font-sans text-sm">
                {a.content || 'This draft is empty.'}
              </pre>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Close</Button>
            <Button asChild>
              <Link to={agreementPath(a)}>Open document details</Link>
            </Button>
          </DialogFooter>
        </>
      )}
    </DialogContent>
  </Dialog>
);

export default AgreementPreviewDialog;
