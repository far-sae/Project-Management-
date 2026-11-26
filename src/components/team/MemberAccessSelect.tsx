// On a person's row of the Team page: what this person may do on Social
// media, without being made an admin. Only shown to the owner and admins, for
// people who are plain members (an admin has everything already; a viewer
// only reads).
import React, { useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { publicMessage } from '@/lib/publicError';
import { SOCIAL_ACCESS_HINT, SOCIAL_ACCESS_NAME, type AreaAccess } from '@/lib/memberAccess';
import { setMemberAccess } from '@/services/supabase/memberAccess';

interface Props {
  organizationId: string;
  userId: string;
  /** The person's name, for the label read out by a screen reader. */
  name: string;
  value: AreaAccess;
  /** The person who is choosing. */
  grantedBy?: string;
  onChanged: (next: AreaAccess) => void;
  className?: string;
}

const LEVELS: AreaAccess[] = ['none', 'use', 'manage'];

export const MemberSocialAccessSelect: React.FC<Props> = ({ organizationId, userId, name, value, grantedBy, onChanged, className }) => {
  const [busy, setBusy] = useState(false);

  const choose = async (next: AreaAccess) => {
    if (next === value) return;
    setBusy(true);
    try {
      await setMemberAccess(organizationId, userId, 'social', next === 'none' ? null : next, grantedBy);
      onChanged(next);
      toast.success(next === 'none' ? `${name} no longer sees Social media.` : `${name} now has Social media: ${next === 'use' ? 'posts only' : 'everything'}.`);
    } catch (error) {
      toast.error(publicMessage(error, 'The access could not be changed. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
      <div className="relative">
        <select
          aria-label={`Social media access of ${name}`} title={SOCIAL_ACCESS_HINT[value]} disabled={busy} value={value}
          onChange={(e) => void choose(e.target.value as AreaAccess)}
          className={cn('h-11 w-44 appearance-none rounded-md border border-input bg-background pl-3 pr-8 text-sm md:h-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60', className)}
        >
          {LEVELS.map((level) => <option key={level} value={level}>{SOCIAL_ACCESS_NAME[level]}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" aria-hidden />
      </div>
    </div>
  );
};

export default MemberSocialAccessSelect;
