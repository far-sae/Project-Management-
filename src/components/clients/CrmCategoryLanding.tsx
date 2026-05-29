import React, { useMemo } from 'react';
import {
  Building2, ChevronRight, Layers, FileQuestion, Plus, Settings2,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Client } from '@/services/supabase/clients';
import type { ClientCategory } from '@/services/supabase/clientCategories';
import { cn } from '@/lib/utils';

interface CrmCategoryLandingProps {
  clients: Client[];
  /** Registered categories from client_categories (workspace-scoped). When
   *  empty, the landing nudges the user to set up categories first. */
  registered?: ClientCategory[];
  /** Called with the chosen category name. Pass null = browse "all";
   *  '__uncategorized__' = accounts without a category set. */
  onPick: (category: string | null) => void;
  /** When provided, surfaces a "Create category" tile in the picker that
   *  opens the manage dialog. Hidden for viewers. */
  onCreateCategory?: () => void;
  /** Optional CTA on the header to open the full Manage dialog. */
  onManageCategories?: () => void;
}

interface Bucket {
  key: string;          // category string, or '__uncategorized__'
  label: string;
  count: number;
  sample: string[];     // up to 3 account names from the bucket
  color?: string | null;
  registered: boolean;  // true if it lives in client_categories
}

const ACCENTS = [
  'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
  'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
] as const;

const accentFor = (key: string): string => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return ACCENTS[Math.abs(h) % ACCENTS.length];
};

export const CrmCategoryLanding: React.FC<CrmCategoryLandingProps> = ({
  clients, registered = [], onPick, onCreateCategory, onManageCategories,
}) => {
  // Build the union of registered + derived categories so historic free-text
  // entries still appear alongside categories the rep set up explicitly.
  const buckets = useMemo<Bucket[]>(() => {
    const map = new Map<string, Bucket>();

    // 1. Seed from the registered list — even empty registered categories
    //    should appear so the rep can see them on the landing.
    //    On the All-workspaces view, two workspaces can each own a "Enterprise"
    //    category. We collapse same-name buckets (first-seen wins for the
    //    color/key) so the picker doesn't render a non-deterministic tile
    //    whose metadata flips between renders.
    for (const r of registered) {
      const key = r.name.toLowerCase();
      const existing = map.get(key);
      if (existing) {
        existing.registered = true;
        if (existing.color == null && r.color) existing.color = r.color;
        continue;
      }
      map.set(key, {
        key: r.name,                   // display + filter use the raw name
        label: r.name,
        count: 0,
        sample: [],
        color: r.color ?? null,
        registered: true,
      });
    }

    // 2. Walk accounts: bump counts for registered buckets and add new
    //    "derived" buckets for free-text categories that haven't been
    //    registered yet.
    for (const c of clients) {
      const raw = c.category?.trim();
      if (!raw) {
        const u = map.get('__uncategorized__');
        if (u) {
          u.count += 1;
          if (u.sample.length < 3) u.sample.push(c.name);
        } else {
          map.set('__uncategorized__', {
            key: '__uncategorized__',
            label: 'Uncategorized',
            count: 1,
            sample: [c.name],
            registered: false,
          });
        }
        continue;
      }
      const k = raw.toLowerCase();
      const existing = map.get(k);
      if (existing) {
        existing.count += 1;
        if (existing.sample.length < 3) existing.sample.push(c.name);
      } else {
        map.set(k, {
          key: raw,
          label: raw,
          count: 1,
          sample: [c.name],
          registered: false,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      // Uncategorized at the bottom, then highest count first, then alpha.
      if (a.key === '__uncategorized__') return 1;
      if (b.key === '__uncategorized__') return -1;
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label);
    });
  }, [clients, registered]);

  const total = clients.length;
  const hasAnyCategory = buckets.some((b) => b.key !== '__uncategorized__');

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Pick a list
              </p>
              <h2 className="text-lg font-semibold mt-1">
                Browse accounts by category
              </h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                {hasAnyCategory
                  ? 'Choose a category below to focus on one slice of your accounts. Pick "All accounts" to see everything in this workspace.'
                  : 'No categories yet. Add one or two (Enterprise, Reseller, NGO…) so accounts can be sorted into buckets. Until you do, every account lives in the same big list.'}
              </p>
            </div>
            {onManageCategories && (
              <Button variant="outline" size="sm" onClick={onManageCategories}>
                <Settings2 className="w-3.5 h-3.5 mr-1.5" /> Manage categories
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* "All accounts" is always present so the rep can bail out. */}
        <button
          type="button"
          onClick={() => onPick(null)}
          className="group text-left rounded-lg border bg-card p-4 hover:border-primary/60 hover:shadow-sm transition-all"
        >
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-md bg-primary/15 text-primary grid place-items-center shrink-0">
              <Layers className="w-5 h-5" />
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">All accounts</h3>
                <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Every account in this workspace.
              </p>
              <Badge variant="outline" className="mt-2 text-[10px]">
                {total} account{total === 1 ? '' : 's'}
              </Badge>
            </div>
          </div>
        </button>

        {buckets.map((b) => {
          const isUncategorized = b.key === '__uncategorized__';
          const accent =
            !isUncategorized && b.color
              ? undefined  // use inline style for custom colors
              : isUncategorized
                ? 'bg-muted text-muted-foreground border-border'
                : accentFor(b.key);
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => onPick(b.key)}
              className="group text-left rounded-lg border bg-card p-4 hover:border-primary/60 hover:shadow-sm transition-all"
            >
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    'w-10 h-10 rounded-md grid place-items-center shrink-0 border',
                    accent,
                  )}
                  style={
                    !isUncategorized && b.color
                      ? { background: `${b.color}26`, borderColor: `${b.color}55`, color: b.color }
                      : undefined
                  }
                >
                  {isUncategorized
                    ? <FileQuestion className="w-5 h-5" />
                    : <Building2 className="w-5 h-5" />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h3 className="font-semibold truncate">{b.label}</h3>
                      {b.registered && (
                        <Badge variant="outline" className="text-[9px] shrink-0">saved</Badge>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {b.sample.length > 0
                      ? `${b.sample.join(' · ')}${b.count > b.sample.length ? ` · +${b.count - b.sample.length} more` : ''}`
                      : 'No accounts here yet — open one and set this category.'}
                  </p>
                  <Badge variant="outline" className="mt-2 text-[10px]">
                    {b.count} account{b.count === 1 ? '' : 's'}
                  </Badge>
                </div>
              </div>
            </button>
          );
        })}

        {/* Create-category tile, shown when the parent supplied a handler.
            Hidden for viewers (who can't write to client_categories anyway). */}
        {onCreateCategory && (
          <button
            type="button"
            onClick={onCreateCategory}
            className="group text-left rounded-lg border border-dashed bg-card/40 p-4 hover:border-primary/60 hover:bg-card transition-all"
          >
            <div className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-md bg-primary/10 text-primary grid place-items-center shrink-0">
                <Plus className="w-5 h-5" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold">Create category</h3>
                  <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Add a new bucket like Enterprise, NGO, or Reseller.
                </p>
                <Badge variant="outline" className="mt-2 text-[10px] border-dashed">
                  new
                </Badge>
              </div>
            </div>
          </button>
        )}
      </div>
    </div>
  );
};
