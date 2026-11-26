import { useEffect, useState } from 'react';
import { useOrganization } from '@/context/OrganizationContext';
import { NO_CALLING, voiceSetup } from '@/services/voice/client';
import type { VoiceSetup } from '../../api/_voice/shared/types';

/**
 * Whether this person can ring a lead from the CRM itself. The owner and
 * admins can, and so can a person who was given Calls on the Team page, once
 * a phone provider has been set up. For everyone else the Call button keeps
 * handing the number to the device's own phone app.
 *
 * `seesAll`: every call of the workspace (the owner, admins, and a person
 * given all calls). Otherwise only the person's own calls and recordings: the
 * server decides that, this only chooses the words on screen.
 */
export function useCalling(): { setup: VoiceSetup; inApp: boolean; mayListen: boolean; mayCall: boolean; seesAll: boolean } {
  const { areaLevel } = useOrganization();
  const given = areaLevel('calls');
  const mayCall = given !== 'none';
  const [setup, setSetup] = useState<VoiceSetup>(NO_CALLING);

  useEffect(() => {
    if (!mayCall) {
      setSetup(NO_CALLING);
      return;
    }
    let live = true;
    void voiceSetup().then((s) => { if (live) setSetup(s); });
    return () => { live = false; };
  }, [mayCall]);

  return { setup, inApp: mayCall && setup.configured, mayListen: mayCall, mayCall, seesAll: given === 'manage' };
}
