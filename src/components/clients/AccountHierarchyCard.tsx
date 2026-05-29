import React, { useMemo } from 'react';
import { Building2, ChevronRight, GitBranch } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { Client } from '@/services/supabase/clients';

interface AccountHierarchyCardProps {
  account: Client;
  /** Full org-wide accounts list — used to look up the parent + children
   *  without an extra round-trip. */
  allAccounts: Client[];
  /** Called when the rep clicks a related account in the tree. The parent
   *  decides what "opening" means (drawer swap, navigate, etc). */
  onOpenAccount?: (c: Client) => void;
}

/**
 * Zoho-style "Account Hierarchy" related list. Reads parentClientId on the
 * current account and shows: the parent above (if any), the current account
 * highlighted in the middle, and direct children below. Reps click to
 * pivot.
 *
 * Deeper trees (grandparents / grandchildren) are out of scope for the
 * first cut — one level up + one level down is the bulk of real use cases
 * and keeps the rendering predictable.
 */
export const AccountHierarchyCard: React.FC<AccountHierarchyCardProps> = ({
  account, allAccounts, onOpenAccount,
}) => {
  const parent = useMemo(
    () => (account.parentClientId
      ? allAccounts.find((a) => a.clientId === account.parentClientId) ?? null
      : null),
    [account.parentClientId, allAccounts],
  );
  const children = useMemo(
    () => allAccounts.filter((a) => a.parentClientId === account.clientId),
    [allAccounts, account.clientId],
  );

  const hasAny = parent || children.length > 0;

  const Row: React.FC<{
    c: Client;
    indent?: number;
    isCurrent?: boolean;
    isParent?: boolean;
  }> = ({ c, indent = 0, isCurrent, isParent }) => (
    <button
      type="button"
      disabled={isCurrent}
      onClick={() => !isCurrent && onOpenAccount?.(c)}
      className={
        'w-full flex items-center gap-2 py-1.5 px-2 rounded text-left text-sm '
        + (isCurrent
          ? 'bg-primary/10 text-primary font-semibold cursor-default'
          : 'hover:bg-muted cursor-pointer')
      }
      style={{ paddingLeft: `${0.5 + indent * 1.25}rem` }}
    >
      {indent > 0 && <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
      <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <span className="truncate flex-1 min-w-0">{c.name}</span>
      {isParent && <Badge variant="outline" className="text-[9px] shrink-0">parent</Badge>}
      {isCurrent && <Badge variant="outline" className="text-[9px] shrink-0">this account</Badge>}
      {c.industry && <span className="text-[10px] text-muted-foreground shrink-0">· {c.industry}</span>}
    </button>
  );

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold inline-flex items-center gap-1.5">
          <GitBranch className="w-4 h-4" /> Account Hierarchy
        </h3>
        <span className="text-xs text-muted-foreground">
          {(parent ? 1 : 0) + 1 + children.length} account{((parent ? 1 : 0) + 1 + children.length) === 1 ? '' : 's'}
        </span>
      </div>

      {!hasAny ? (
        <p className="text-xs text-muted-foreground italic">
          No parent or child accounts. Set a Parent Account on this record (or another) to start a hierarchy.
        </p>
      ) : (
        <div className="rounded-md border bg-card/40 p-1">
          {parent && <Row c={parent} isParent />}
          <Row c={account} indent={parent ? 1 : 0} isCurrent />
          {children.map((c) => (
            <Row key={c.clientId} c={c} indent={parent ? 2 : 1} />
          ))}
        </div>
      )}
    </section>
  );
};
