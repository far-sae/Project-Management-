import React, { useId, useState } from 'react';
import { Loader2, PenLine, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useSignroom } from '@/hooks/useSignroom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import PdfViewer from '@/components/signroom/PdfViewer';
import type { Agreement } from '../../../../api/_signroom/shared/types';
import { Card, CheckRow } from './Card';
import { messageOf } from './files';

/**
 * The sender signs their own part before anyone else is invited, then chooses
 * when to send the signed document on. Shown on the agreement's page while it
 * waits for that first signature or for the release.
 */
export const SenderFirstSigning: React.FC<{
  agreement: Agreement;
  onChange: (agreement: Agreement) => void;
}> = ({ agreement: a, onChange }) => {
  const id = useId();
  const { client } = useSignroom();
  const [signature, setSignature] = useState('');
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const sender = a.participants.find((p) => p.role === 'signer');
  const frozen = a.frozen;
  if (!sender || !frozen) return null;
  const signed = sender.progress === 'signed';
  const ownFields = frozen.fields.filter(
    (f) => f.participantId === sender.id && !['signature', 'date_signed'].includes(f.kind),
  );

  const run = async (kind: 'sign-first' | 'release-first') => {
    setBusy(true);
    setError('');
    try {
      onChange(await client.call<Agreement>(
        `agreements/${a.id}/${kind}`,
        kind === 'sign-first'
          ? { signature, values, consent, consentVersion: frozen.consent.version, sourceHash: frozen.sourceHash }
          : {},
      ));
      toast.success(kind === 'sign-first'
        ? 'Your signature is recorded. Review the signed PDF, then send it to the other company.'
        : 'The sender-signed document was sent to the next signer.');
    } catch (e) {
      const message = messageOf(e);
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={signed ? 'Your signature is recorded' : 'Sign first, then send'}
      note={signed
        ? 'The other company has not been invited yet. Review your signed version and explicitly send it when you are ready.'
        : `You are signing the frozen PDF as ${sender.name}. No invitation will go to the other company until you sign and choose Send to other company.`}
    >
      <div className="grid items-start gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <PdfViewer agreement={{ id: a.id, kind: 'source', version: a.senderSignedHash || a.documentHash }} />
        {!signed ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run('sign-first');
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-signature`}>Your typed signature</Label>
              <Input
                id={`${id}-signature`} value={signature} maxLength={150} required disabled={busy} autoComplete="name"
                onChange={(e) => setSignature(e.target.value)}
              />
            </div>
            {ownFields.map((f) => (f.kind === 'checkbox' ? (
              <CheckRow
                key={f.id}
                checked={Boolean(values[f.id])}
                required={f.required}
                disabled={busy}
                onChange={(checked) => setValues((v) => ({ ...v, [f.id]: checked }))}
              >
                {f.label}
              </CheckRow>
            ) : (
              <div key={f.id} className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-${f.id}`}>{f.label}</Label>
                <Input
                  id={`${id}-${f.id}`} value={String(values[f.id] || '')} maxLength={500} required={f.required} disabled={busy}
                  onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                />
              </div>
            )))}
            <CheckRow checked={consent} onChange={setConsent} required disabled={busy} className="rounded-md border border-border px-3">
              {frozen.consent.text}
            </CheckRow>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={busy || !consent}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <PenLine aria-hidden />}
              Sign my part first
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <Button disabled={busy || !a.senderSignedHash} onClick={() => void run('release-first')}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
              Send to other company for signature
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
};

export default SenderFirstSigning;
