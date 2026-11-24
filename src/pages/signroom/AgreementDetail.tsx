import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight, Check, ChevronLeft, Copy, Download, FileText, Loader2, Lock, RotateCcw, Send, ShieldCheck, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useSignroom } from '@/hooks/useSignroom';
import { useCrmDeals } from '@/hooks/useCrmHub';
import {
  canHold, deliveryState, initials, isLive, shortDate, signedCount, utcDateTime,
} from '@/lib/signroom/agreementFormat';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import PdfViewer from '@/components/signroom/PdfViewer';
import { DeliveryLog } from '@/components/signroom/DeliveryLog';
import { AgreementStatusPill, RecipientPill } from '@/components/signroom/agreements/AgreementStatus';
import { Card, Notice } from '@/components/signroom/agreements/Card';
import { SenderFirstSigning } from '@/components/signroom/agreements/SenderFirstSigning';
import { TextPromptDialog } from '@/components/signroom/agreements/TextPromptDialog';
import { DeleteAgreementButton } from '@/components/signroom/agreements/DeleteAgreement';
import {
  downloadAgreementPdf, exportEvidence, messageOf, type AgreementArtifactKind,
} from '@/components/signroom/agreements/files';
import type { Agreement, Client } from '../../../api/_signroom/shared/types';

/** How often an agreement that is out for signature is checked for progress. */
const REFRESH_MS = 3000;

type Ask = 'cancel' | 'hold' | 'delete' | null;

/** One agreement after it has left the editor: who has signed, the files, and what the sender can still do. */
export const AgreementDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { client, workspaceId } = useSignroom();
  const { items: deals } = useCrmDeals();

  const [a, setA] = useState<Agreement | null>(null);
  const [forClient, setForClient] = useState<Client | null>(null);
  const [owner, setOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [ask, setAsk] = useState<Ask>(null);

  const load = useCallback(async () => {
    if (!workspaceId || !id) { setA(null); setLoading(false); return; }
    setLoading(true);
    setLoadError('');
    try {
      const agreement = await client.call<Agreement>(`agreements/${id}`);
      setA(agreement);
      // The company's name and CRM link come from the clients list; the page still works without it.
      client.call<Client[]>('clients')
        .then((list) => setForClient(list.find((c) => c.id === agreement.clientId) ?? null))
        .catch(() => setForClient(null));
      // Retention and legal hold are for the workspace's owners; the server says who that is, and checks again on each action.
      client.call<{ role?: string }>('session')
        .then((session) => setOwner(session.role === 'Owner'))
        .catch(() => setOwner(false));
    } catch (e) {
      setA(null);
      setLoadError(messageOf(e, 'Could not load this agreement.'));
    } finally {
      setLoading(false);
    }
  }, [client, workspaceId, id]);

  useEffect(() => { void load(); }, [load]);

  // While signatures are being collected or the final files are being made, keep the page current.
  const agreementId = a?.id;
  const status = a?.status;
  useEffect(() => {
    if (!agreementId || !status || !isLive(status)) return;
    const timer = setInterval(() => {
      client.call<Agreement>(`agreements/${agreementId}`).then(setA).catch(() => { /* the next tick tries again */ });
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [client, agreementId, status]);

  if (!workspaceId) return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-background px-4 py-12 text-center">
      <p className="text-sm text-muted-foreground">Pick a workspace in the sidebar to open this agreement.</p>
    </main>
  );

  if (loading && !a) return (
    <main className="flex flex-1 items-center justify-center bg-background">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading agreement" />
    </main>
  );

  if (!a) return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-background px-4 py-12 text-center">
      <p role="alert" className="text-sm font-medium">{loadError || 'Agreement not found.'}</p>
      <Button asChild variant="outline">
        <Link to="/crm/agreements"><ChevronLeft aria-hidden />Back to agreements</Link>
      </Button>
    </main>
  );

  const run = async (action: string, body: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const next = await client.call<Agreement>(`agreements/${a.id}/${action}`, body);
      if (action === 'duplicate') {
        toast.success('A new draft is ready with fresh recipients and consent.');
        navigate(`/crm/agreements/${next.id}/edit`);
        return;
      }
      setA(next);
      setAsk(null);
      toast.success(
        action === 'resend' ? 'Fresh invitations sent. Old links and signing sessions are revoked.'
          : action === 'cancel' ? 'Agreement cancelled. All signing access has been revoked.'
            : 'Agreement updated.',
      );
    } catch (e) {
      toast.error(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const exportZip = async () => {
    try {
      setA(await exportEvidence(client, a.id));
    } catch (e) {
      toast.error(messageOf(e));
    }
  };

  const download = async (kind: AgreementArtifactKind) => {
    try {
      await downloadAgreementPdf(client, a.id, kind);
    } catch (e) {
      toast.error(messageOf(e));
    }
  };

  const { signed, signers } = signedCount(a);
  const deal = a.dealId ? deals.find((d) => d.id === a.dealId) : undefined;
  const signsFirst = Boolean(a.senderReleasePending) && a.status === 'Awaiting signatures' && a.senderId === user?.userId;
  const names = Object.fromEntries(a.participants.map((p) => [p.id, p.name]));

  return (
    <main className="min-w-0 flex-1 overflow-y-auto bg-background">
      <div className="flex w-full flex-col gap-6 px-4 py-6 lg:px-6">
        <div className="flex flex-col gap-3">
          <Button variant="ghost" size="sm" asChild className="-ml-2.5 self-start text-muted-foreground">
            <Link to="/crm/agreements"><ChevronLeft aria-hidden />Agreements</Link>
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="min-w-0 flex-1 basis-72">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <h1 className="min-w-0 break-words text-2xl font-semibold tracking-tight text-foreground">{a.title}</h1>
                <AgreementStatusPill status={a.status} />
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                {forClient && (forClient.crmCompanyId
                  ? <Link to={`/crm/companies/${forClient.crmCompanyId}`} className="text-foreground hover:underline">{forClient.name}</Link>
                  : <span>{forClient.name}</span>)}
                {a.dealId && (
                  <Link to={`/crm/deals/${a.dealId}`} className="hover:text-foreground hover:underline">
                    · {deal ? `Deal: ${deal.name}` : 'View deal'}
                  </Link>
                )}
                <span>{forClient ? '· ' : ''}{a.type}</span>
                <span className="tabular-nums">
                  · Created {shortDate(a.created)} · {a.deadline ? `Deadline ${shortDate(a.deadline)}` : 'No signing deadline'}
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {a.documentHash && (
                <Button variant="outline" onClick={() => void download('source')}>
                  <Download aria-hidden /> Source PDF
                </Button>
              )}
              {a.status === 'Draft' ? (
                a.trashedAt
                  ? <Button disabled>Continue editing <ArrowRight aria-hidden /></Button>
                  : (
                    <Button asChild>
                      <Link to={`/crm/agreements/${a.id}/edit`}>Continue editing <ArrowRight aria-hidden /></Link>
                    </Button>
                  )
              ) : (
                <Button variant="outline" disabled={busy} onClick={() => void run('duplicate')}>
                  <Copy aria-hidden /> Duplicate as draft
                </Button>
              )}
              {/* For the workspace's owners; the server checks again. */}
              {owner && <DeleteAgreementButton agreement={a} onDeleted={() => navigate('/crm/agreements')} />}
            </div>
          </div>
        </div>

        {a.trashedAt && (
          <Notice icon={<Trash2 />}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p>This document is in Trash. Restore it before editing or sending it.</p>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void run('restore')}>Restore</Button>
            </div>
          </Notice>
        )}
        {a.archivedAt && !a.trashedAt && (
          <Notice icon={<FileText />}>
            This document is archived. Its signing status and recipient access are unchanged.
          </Notice>
        )}

        {a.status === 'Completed' && (
          <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-success/30 bg-success-soft px-4 py-4" aria-label="Completed agreement files">
            <div className="flex min-w-0 flex-1 basis-72 items-start gap-3">
              <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-success text-success-foreground">
                <Check className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-success-soft-foreground">Everyone has signed</h2>
                <p className="text-sm text-success-soft-foreground">
                  The final files are immutable and shared with authorised recipients through verified download invitations.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void download('final')}><Download aria-hidden /> Signed PDF</Button>
              <Button variant="outline" onClick={() => void download('completion')}>Completion record</Button>
              <Button variant="outline" onClick={() => void exportZip()}>Export evidence <ArrowRight aria-hidden /></Button>
            </div>
          </section>
        )}
        {a.status === 'Finalising' && (
          <Notice role="status" icon={<RotateCcw />}>
            All signatures are accepted. We are generating the final PDF, completion record and signed evidence manifest.
            This page updates automatically.
          </Notice>
        )}

        {signsFirst && (
          <SenderFirstSigning key={a.id + String(Boolean(a.senderSignedHash))} agreement={a} onChange={setA} />
        )}

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <Card
              title="People and progress"
              note={<span className="tabular-nums">{signed} of {signers} signed · {a.sequential ? 'Signing in order' : 'Any signing order'}</span>}
            >
              {a.participants.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">No recipients yet.</p>
              ) : (
                <ul>
                  {a.participants.map((p) => {
                    const delivery = deliveryState(a.deliveries, p.id);
                    return (
                      <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-border/60 px-4 py-2.5 last:border-0">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-muted-foreground">
                            {initials(p.name || p.email) || '?'}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{p.name || 'No name'}</p>
                            <p className="truncate text-xs text-muted-foreground">{p.email}</p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-0.5">
                          <RecipientPill participant={p} />
                          {delivery && <span className="text-xs text-muted-foreground">Delivery: {delivery}</span>}
                          {p.signedAt && <time dateTime={p.signedAt} className="text-xs tabular-nums text-muted-foreground">{utcDateTime(p.signedAt)}</time>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {a.status === 'Awaiting signatures' && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
                  <Button variant="outline" disabled={busy} onClick={() => void run('resend')}>
                    <Send aria-hidden /> Resend invitations
                  </Button>
                  <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => setAsk('cancel')}>
                    Cancel agreement
                  </Button>
                </div>
              )}
            </Card>

            <Card
              title="Document"
              action={a.documentHash && (
                <Button variant="ghost" size="sm" onClick={() => setPreview(!preview)} aria-expanded={preview}>
                  <FileText aria-hidden /> {preview ? 'Hide preview' : 'Show exact PDF'}
                </Button>
              )}
            >
              <div className="flex flex-col gap-3 p-4">
                <div className="flex items-center gap-3">
                  <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{a.type}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      {a.pages.length} pages · {a.fields.length} assigned fields · {a.sourceKind === 'upload' ? 'Uploaded PDF' : 'Authored document'}
                    </p>
                  </div>
                  <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </div>
                {a.frozen && (
                  <div className="rounded-md border border-border bg-secondary/50 px-3 py-2">
                    <p className="text-xs text-muted-foreground">Frozen source SHA-256</p>
                    <code className="block break-all text-xs">{a.frozen.sourceHash}</code>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Consent {a.frozen.consent.version} · Server UTC timestamps · Email access verified
                    </p>
                  </div>
                )}
                {preview && a.documentHash && (
                  <PdfViewer
                    agreement={{
                      id: a.id,
                      kind: a.status === 'Completed' ? 'final' : 'source',
                      version: a.senderSignedHash || a.documentHash,
                    }}
                    fields={a.fields}
                    recipientNames={names}
                  />
                )}
              </div>
            </Card>

            {/* The server refuses a hold on a trashed agreement: restore it first. */}
            {canHold(a, owner) && (
              <Card title="Retention and legal hold">
                <div className="flex flex-col gap-3 p-4">
                  <p className="text-sm text-muted-foreground">
                    Export before scheduling deletion. The workspace retention period and any legal hold are enforced automatically.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" disabled={busy} onClick={() => setAsk('hold')}>
                      <Lock aria-hidden /> {a.legalHold ? 'Release legal hold' : 'Apply legal hold'}
                    </Button>
                    <Button
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={busy || a.legalHold}
                      onClick={() => setAsk('delete')}
                    >
                      <Trash2 aria-hidden /> Schedule retention deletion
                    </Button>
                  </div>
                  {a.legalHold && <p className="text-sm text-success">Legal hold active. Scheduled deletion is paused.</p>}
                  {a.deletionAt && <p className="text-sm tabular-nums">Deletion eligible on {shortDate(a.deletionAt)}.</p>}
                </div>
              </Card>
            )}
          </div>

          {/* Every email sent for this agreement; re-read whenever something happens to it. */}
          {a.status !== 'Draft' && <DeliveryLog key={a.events.length} path={`agreements/${a.id}/deliveries`} title="Emails" />}

          <Card title="Activity" note="An append-only account of this agreement.">
            {a.events.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing has happened yet.</p>
            ) : (
              <ol>
                {[...a.events].reverse().map((e) => (
                  <li key={e.seq} className="border-b border-border/60 px-4 py-2.5 last:border-0">
                    <p className="text-sm font-medium text-foreground">{e.type}</p>
                    <p className="break-words text-xs tabular-nums text-muted-foreground">
                      <time dateTime={e.at}>{utcDateTime(e.at)}</time> · {e.actor}
                    </p>
                    {typeof e.detail?.reason === 'string' && e.detail.reason && (
                      <p className="mt-0.5 break-words text-sm text-muted-foreground">{e.detail.reason}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>

      <TextPromptDialog
        open={ask === 'cancel'}
        onOpenChange={(open) => { if (!open) setAsk(null); }}
        title="Cancel this agreement?"
        description="Cancel and revoke signing access? Give a reason."
        label="Reason"
        multiline
        maxLength={1000}
        confirmLabel="Cancel agreement"
        cancelLabel="Keep agreement"
        destructive
        busy={busy}
        onConfirm={(reason) => void run('cancel', { reason })}
      />
      <TextPromptDialog
        open={ask === 'hold'}
        onOpenChange={(open) => { if (!open) setAsk(null); }}
        title={a.legalHold ? 'Release legal hold' : 'Apply legal hold'}
        description={a.legalHold
          ? 'Scheduled deletion can go ahead again once the hold is released. The reason is kept in the activity.'
          : 'While the hold is on, this agreement cannot be moved to Trash or deleted. The reason is kept in the activity.'}
        label={a.legalHold ? 'Reason for releasing the hold' : 'Reason for applying a legal hold'}
        multiline
        maxLength={500}
        confirmLabel={a.legalHold ? 'Release legal hold' : 'Apply legal hold'}
        busy={busy}
        onConfirm={(reason) => void run('hold', { hold: !a.legalHold, reason })}
      />
      <AlertDialog open={ask === 'delete'} onOpenChange={(open) => { if (!open && !busy) setAsk(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Schedule deletion?</AlertDialogTitle>
            <AlertDialogDescription>
              Schedule controlled deletion after the retention period? Export the evidence first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep agreement</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => { e.preventDefault(); void run('delete'); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Schedule deletion
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
};

export default AgreementDetailPage;
