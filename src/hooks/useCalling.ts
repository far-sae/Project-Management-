import { useEffect, useState } from 'react';
import { useOrganization } from '@/context/OrganizationContext';
import { NO_CALLING, voiceSetup } from '@/services/voice/client';
import type { VoiceSetup } from '../../api/_voice/shared/types';

/**
 * Whether this person can ring a lead from the CRM itself. Only an owner or
 * admin can, and only once a phone provider has been set up; for everyone
 * else the Call button keeps handing the number to the device's own phone app.
 */
export function useCalling(): { setup: VoiceSetup; inApp: boolean; mayListen: boolean } {
  const { isAdmin } = useOrganization();
  const [setup, setSetup] = useState<VoiceSetup>(NO_CALLING);

  useEffect(() => {
    if (!isAdmin) {
      setSetup(NO_CALLING);
      return;
    }
    let live = true;
    void voiceSetup().then((s) => { if (live) setSetup(s); });
    return () => { live = false; };
  }, [isAdmin]);

  return { setup, inApp: Boolean(isAdmin) && setup.configured, mayListen: Boolean(isAdmin) };
}
