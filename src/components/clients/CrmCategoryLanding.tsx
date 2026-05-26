import React, { useMemo } from 'react';
import {
  Building2, ChevronRight, Layers, FileQuestion,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { Client } from '@/services/supabase/clients';
import { cn } from '@/lib/utils';

interface CrmCategoryLandingProps {
  clients: Client[];
  /** Called with the chosen category name. Pass null to mean "browse all".
   *  Pass '__uncategorized__' to mean "only accounts with no category". */
  onPick: (category: string | null) => void;
}

interface Bucket {
  key: string;        // the category string, or '__uncategorized__'
  label: string;
  count: number;
  sample: string[];   // first 3 account names in this bucket
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
  // Stable per-name pick so the same category always gets the same colour.
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return ACCENTS[Math.abs(h) % ACCENTS.length];
};

export const CrmCategoryLanding: React.FC<CrmCategoryLandingProps> = ({
  clients, onPick,
}) => {
  const buckets = useMemo<Bucket[]>(() => {
    const map = new Map<string, Bucket>();
    for (const c of clients) {
      const key = c.category?.trim() || '__uncategorized__';
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        if (existing.sample.length < 3) existing.sample.push(c.name);
      } else {
        map.set(key, {
          key,
          label: key === '__uncategorized__' ? 'Uncategorized' : key,
          count: 1,
          sample: [c.name],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      // Real categories first, then 'Uncategorized'.
      if (a.key === '__uncategorized__') return 1;
      if (b.key === '__uncategorized__') return -1;
      return b.count - a.count || a.label.localeCompare(b.label);
    });
  }, [clients]);

  const total = clients.length;
  const hasRealCategories = buckets.some((b) => b.key !== '__uncategorized__');

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-5 pb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pick a list
          </p>
          <h2 className="text-lg font-semibold mt-1">
            Browse accounts by category
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            {hasRealCategories
              ? 'Choose a category below to focus on one slice of your accounts. Pick "All accounts" to see everything in this workspace.'
              : 'No categories yet — every account lives in one big list. Open an account and set a category to start grouping them here.'}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* "All accounts" tile is always present so people can bail out of
            the category picker even when they haven't tagged anything yet. */}
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
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => onPick(b.key)}
              className="group text-left rounded-lg border bg-card p-4 hover:border-primary/60 hover:shadow-sm transition-all"
            >
              <div className="flex items-start gap-3">
                <span className={cn(
                  'w-10 h-10 rounded-md grid place-items-center shrink-0 border',
                  isUncategorized
                    ? 'bg-muted text-muted-foreground border-border'
                    : accentFor(b.key),
                )}>
                  {isUncategorized
                    ? <FileQuestion className="w-5 h-5" />
                    : <Building2 className="w-5 h-5" />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold truncate">{b.label}</h3>
                    <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {b.sample.join(' · ')}
                    {b.count > b.sample.length && ` · +${b.count - b.sample.length} more`}
                  </p>
                  <Badge
                    variant="outline"
                    className="mt-2 text-[10px]"
                  >
                    {b.count} account{b.count === 1 ? '' : 's'}
                  </Badge>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
