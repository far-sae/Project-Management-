// A sample invoice, receipt or agreement as a PDF, in the look on the page, saved or not.
import React, { useId, useState } from 'react';
import { Eye } from 'lucide-react';
import type { PreviewKind } from '@/lib/signroom/branding';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { brandingPreviewPdf } from '@/components/signroom/billing/brandingPreviewRequest';
import { PdfFrame } from '@/components/signroom/billing/PdfFrame';
import { Card, FIELD } from '@/components/signroom/billing/shared';

interface Props {
  workspaceId: string;
  /** The look as it would be sent to be saved, read afresh for every preview. */
  body: () => Record<string, unknown>;
  className?: string;
}

export const PreviewCard: React.FC<Props> = ({ workspaceId, body, className }) => {
  const id = useId();
  const [kind, setKind] = useState<PreviewKind>('invoice');
  /** Counts previews asked for: zero means none is shown, and each new one is fetched afresh. */
  const [run, setRun] = useState(0);

  return (
    <Card title="Preview" className={className}>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted-foreground">
          A sample document as a PDF, exactly as it would be printed, including changes you have not saved yet.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className={FIELD}>
            <Label htmlFor={`${id}-kind`}>Document to preview</Label>
            <Select value={kind} onValueChange={(v) => { setKind(v as PreviewKind); setRun(0); }}>
              <SelectTrigger id={`${id}-kind`} className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="invoice">Invoice</SelectItem>
                <SelectItem value="receipt">Receipt</SelectItem>
                <SelectItem value="agreement">Agreement</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="button" variant="outline" onClick={() => setRun((n) => n + 1)}>
            <Eye aria-hidden /> {run ? 'Refresh preview' : 'Preview PDF'}
          </Button>
        </div>
        {run > 0 && (
          <PdfFrame
            load={() => brandingPreviewPdf(workspaceId, { ...body(), previewKind: kind })}
            sourceKey={`${kind}-${run}`}
            title={`Sample ${kind}`}
            filename={`sample-${kind}.pdf`}
          />
        )}
      </div>
    </Card>
  );
};

export default PreviewCard;
