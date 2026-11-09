import { useEffect } from 'react';
import { toast } from 'sonner';
import {
  dismissCallAlertsOffer,
  requestCallAlerts,
  shouldOfferCallAlerts,
  unlockCallAudio,
} from '@/services/calling/incomingAlert';

const OFFER_DELAY_MS = 4000;

/**
 * App-wide setup so incoming calls get noticed (used by CallProvider):
 * unlock call audio on the first click/keypress, and once ask the user to
 * allow desktop notifications for calls.
 */
export function useCallAlerts(signedIn: boolean): void {
  useEffect(() => {
    if (!signedIn) return;
    const removeUnlock = unlockCallAudio();

    const timer = setTimeout(() => {
      if (!shouldOfferCallAlerts()) return;
      toast('Get alerted about incoming calls?', {
        description:
          'Allow notifications so your browser rings and shows a pop-up when a teammate calls — even when TaskCalendar is in another tab.',
        duration: 20000,
        action: {
          label: 'Enable',
          onClick: () => {
            void requestCallAlerts().then((result) => {
              if (result === 'granted') toast.success('Call alerts are on');
              else if (result === 'denied') {
                toast.message('Notifications are blocked — you can allow them from the padlock in the address bar.');
              }
            });
          },
        },
        cancel: {
          label: 'Not now',
          onClick: () => dismissCallAlertsOffer(),
        },
      });
    }, OFFER_DELAY_MS);

    return () => {
      clearTimeout(timer);
      removeUnlock();
    };
  }, [signedIn]);
}
