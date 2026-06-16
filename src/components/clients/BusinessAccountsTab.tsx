import React, { useMemo, useState } from 'react';
import { ArrowLeft, Plus, Upload, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { ClientsTable } from '@/components/clients/ClientsTable';
import { CrmCategoryLanding } from '@/components/clients/CrmCategoryLanding';
import type { Client } from '@/services/supabase/clients';
import type { Lead } from '@/services/supabase/leads';
import type { ClientCategory } from '@/services/supabase/clientCategories';

interface Props {
  /** Every company in the org (filtered to the picked category here). */
  clients: Client[];
  registeredCategories: ClientCategory[];
  /** Leads — only used for the landing tile counts ("N accounts · M leads"). */
  leads: Lead[];
  canCreate: boolean;
  /** Open a company in the full business-account window (ClientDetailDrawer). */
  onOpenCompany: (c: Client) => void;
  /** Add one business account, filed under the given category (null = none). */
  onAddCompany: (category: string | null) => void;
  /** Import companies, filed under the given category (null = none). */
  onImportCompanies: (category: string | null) => void;
  onExportCategory?: (categoryKey: string, label: string) => void;
  onManageCategories?: () => void;
}

const UNCATEGORIZED = '__uncategorized__';

/**
 * "Business accounts" tab — the company records (clients), browsed by the same
 * category buckets as leads. Landing (category tiles) → pick a category → the
 * companies in it, with Import + Add. Opening a company shows its full window.
 *
 * An account = a category bucket; a business account = a company that lives in
 * one. Leads link to a business account from their own window (separate slice).
 */
export const BusinessAccountsTab: React.FC<Props> = ({
  clients, registeredCategories, leads, canCreate,
  onOpenCompany, onAddCompany, onImportCompanies, onExportCategory, onManageCategories,
}) => {
  // null = show the category landing; otherwise a specific bucket: 'all' |
  // '__uncategorized__' | a category name.
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      if (category && category !== 'all') {
        if (category === UNCATEGORIZED) {
          if (c.category && c.category.trim()) return false;
        } else if ((c.category ?? '').trim().toLowerCase() !== category.toLowerCase()) {
          return false;
        }
      }
      if (!q) return true;
      const hay = [c.name, c.legalName, c.industry, c.email, c.phone, c.city, c.country, c.accountOwnerName]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [clients, category, search]);

  // Landing gate.
  if (category === null) {
    return (
      <CrmCategoryLanding
        clients={clients}
        registered={registeredCategories}
        leads={leads}
        onPick={(cat) => setCategory(cat ?? 'all')}
        onExport={onExportCategory}
        onManageCategories={onManageCategories}
      />
    );
  }

  const label = category === 'all'
    ? 'All business accounts'
    : category === UNCATEGORIZED ? 'Uncategorised' : category;
  const scopeCategory = (category === 'all' || category === UNCATEGORIZED) ? null : category;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="outline" size="sm" onClick={() => setCategory(null)}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Categories
          </Button>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold truncate">{label}</h2>
            <p className="text-xs text-muted-foreground">
              Companies in this category. Open one for its full record, or add/import more.
            </p>
          </div>
        </div>
        {canCreate && (
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={() => onImportCompanies(scopeCategory)}>
              <Upload className="w-4 h-4 mr-1" /> Import
            </Button>
            <Button size="sm" onClick={() => onAddCompany(scopeCategory)}>
              <Plus className="w-4 h-4 mr-1" /> Add business account
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardContent className="pt-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search company name, email, owner…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={200}
            />
          </div>
          <span className="text-xs text-muted-foreground">{scoped.length} compan{scoped.length === 1 ? 'y' : 'ies'}</span>
        </CardContent>
      </Card>

      <ClientsTable
        rows={scoped}
        selectedIds={new Set<string>()}
        canManage={false}
        onOpen={onOpenCompany}
        onToggleRow={() => { /* no bulk-select on the business-accounts tab */ }}
        onToggleAll={() => { /* no bulk-select on the business-accounts tab */ }}
      />
    </div>
  );
};
