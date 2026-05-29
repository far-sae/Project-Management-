import React from 'react';
import { TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DealsEmptyStateProps {
  canManage: boolean;
  onCreate: () => void;
  onImport: () => void;
}

/**
 * Zoho's "How do you monitor your sales?" landing for the Pipeline tab.
 * Shown only when there are no deals at all in the current scope.
 */
export const DealsEmptyState: React.FC<DealsEmptyStateProps> = ({
  canManage, onCreate, onImport,
}) => (
  <div className="min-h-[60vh] flex flex-col items-center justify-center px-6 py-12">
    <div className="max-w-md text-center space-y-5">
      <h2 className="text-2xl font-semibold">How do you monitor your sales?</h2>
      <ul className="space-y-2 text-left mx-auto inline-block">
        <li className="text-sm flex items-start gap-2">
          <span className="text-muted-foreground mt-0.5">›</span>
          <span>Define your sales cycle <span className="text-primary">- Configure Stages</span></span>
        </li>
        <li className="text-sm flex items-start gap-2">
          <span className="text-muted-foreground mt-0.5">›</span>
          <span>Track your sales pipeline <span className="text-primary">- Create Dashboard</span></span>
        </li>
      </ul>
      <div className="flex items-center gap-3 justify-center pt-2">
        {canManage && <Button onClick={onCreate}>Create a Deal</Button>}
        <span className="text-sm text-muted-foreground">or</span>
        <Button variant="outline" onClick={onImport}>Import Deals</Button>
      </div>
    </div>

    <div className="mt-10 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-sky-500/15 via-cyan-500/15 to-blue-500/15 text-foreground">
      <TrendingUp className="w-4 h-4" /> <span className="font-semibold">Deals (Sales Pipeline)</span>
    </div>
  </div>
);
