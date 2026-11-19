import React, { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Plus } from 'lucide-react';
import { useSignroom } from '@/hooks/useSignroom';
import { shortDate, signedCount, sortAgreements } from '@/lib/signroom/agreementFormat';
import { Button } from '@/components/ui/button';
import type { AgreementSummary } from '../../../../api/_signroom/shared/types';
import { AgreementStatusPill } from './AgreementStatus';
import { agreementPath } from './AgreementRowActions';
import { NewAgreementDialog } from './NewAgreementDialog';
import { messageOf } from './files';

export interface AgreementsPanelProps {
  /** List the agreements of this CRM company. */
  companyId?: string;
  /** List the agreements of this CRM deal. When given, the list is the deal's own. */
  dealId?: string;
}

/** How many rows the card shows before "Show all". */
const SHORT_LIST = 5;

/**
 * A card for the CRM company and deal pages: that company's (or deal's)
 * agreements with where each one stands, and a button to start a new one.
 */
export const AgreementsPanel: React.FC<AgreementsPanelProps> = ({ companyId, dealId }) => {
  const headingId = useId();
  const { client, workspaceId } = useSignroom();
  const [items, setItems] = useState<AgreementSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId || (!companyId && !dealId)) { setItems([]); return; }
    setLoading(true);
    setError('');
    try {
      const query = dealId ? `dealId=${encodeURIComponent(dealId)}` : `companyId=${encodeURIComponent(companyId ?? '')}`;
      const list = await client.call<AgreementSummary[]>(`agreements?${query}`);
      setItems(sortAgreements(list.filter((a) => !a.trashedAt), 'newest'));
    } catch (e) {
      setError(messageOf(e, 'Could not load agreements.'));
    } finally {
      setLoading(false);
    }
  }, [client, workspaceId, companyId, dealId]);

  useEffect(() => { void load(); }, [load]);

  const shown = showAll ? items : items.slice(0, SHORT_LIST);

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card" aria-labelledby={headingId}>
      <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-4">
        <h2 id={headingId} className="text-sm font-semibold text-foreground">
          Agreements
          {workspaceId && items.length > 0 && (
            <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{items.length}</span>
          )}
        </h2>
        {workspaceId && (
          <Button variant="ghost" size="sm" onClick={() => setShowNew(true)}>
            <Plus aria-hidden /> New agreement
          </Button>
        )}
      </div>

      {!workspaceId ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          Pick a workspace in the sidebar to see agreements.
        </p>
      ) : loading && items.length === 0 ? (
        <div className="py-6 text-center">
          <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading agreements" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
          <p role="alert" className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>Try again</Button>
        </div>
      ) : items.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          No agreements yet. Start one to send for signature.
        </p>
      ) : (
        <>
          <ul>
            {shown.map((a) => {
              const { signed, signers } = signedCount(a);
              return (
                <li key={a.id} className="border-b border-border/60 px-4 py-2.5 last:border-0">
                  <div className="flex items-center justify-between gap-3">
                    <Link to={agreementPath(a)} className="min-w-0 truncate text-sm font-medium text-foreground hover:underline">
                      {a.title}
                    </Link>
                    <AgreementStatusPill status={a.status} />
                  </div>
                  <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                    {a.type} · {signers > 0 ? `${signed} of ${signers} signed · ` : ''}Updated {shortDate(a.updated)}
                    {a.archivedAt ? ' · Archived' : ''}
                  </p>
                </li>
              );
            })}
          </ul>
          {items.length > SHORT_LIST && (
            <div className="border-t border-border px-2 py-1.5">
              <Button variant="ghost" size="sm" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show fewer' : `Show all ${items.length}`}
              </Button>
            </div>
          )}
        </>
      )}

      <NewAgreementDialog open={showNew} onOpenChange={setShowNew} companyId={companyId} dealId={dealId} />
    </section>
  );
};

export default AgreementsPanel;
