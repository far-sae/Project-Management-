import React from 'react';
import { DatabaseZap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HR_SETUP_MIGRATION } from '@/services/supabase/leave';

/**
 * Shown on the Leave and Documents tabs until the database update has been
 * run. Nothing can be saved before that, so the tab shows only this.
 */
export const HrSetupNotice: React.FC<{ feature: string; onRetry?: () => void }> = ({ feature, onRetry }) => (
  <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-foreground/20 px-4 py-12 text-center">
    <DatabaseZap className="h-5 w-5 text-muted-foreground" aria-hidden />
    <p className="text-sm font-medium text-foreground">{feature} needs a one-time database update</p>
    <p className="max-w-xl text-pretty text-sm text-muted-foreground">
      Run the file{' '}
      <code className="rounded bg-secondary px-1 py-0.5 text-xs text-foreground">
        supabase/migrations/{HR_SETUP_MIGRATION}
      </code>{' '}
      in your Supabase project (SQL Editor, paste the file and press Run). It only adds new tables; nothing
      existing is changed. Then press Check again.
    </p>
    {onRetry && (
      <Button variant="outline" className="mt-2" onClick={onRetry}>
        Check again
      </Button>
    )}
  </div>
);

export default HrSetupNotice;
