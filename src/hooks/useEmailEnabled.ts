import { useAuth } from '@/context/AuthContext';
import { isAppOwner } from '@/lib/app-owner';
import { FEATURES } from '@/config/featureFlags';

/**
 * Whether Gmail-backed "send email" features should be shown.
 *
 * Gmail's OAuth app isn't Google-verified yet, so sending shows users the scary
 * "unverified app" consent screen. Until it's verified we hide every email-send
 * surface from customers — only the app owner (us) sees it, so we can still
 * test. Flip VITE_ENABLE_GMAIL=true to open it to everyone after verification.
 */
export const useEmailEnabled = (): boolean => {
  const { user } = useAuth();
  return isAppOwner(user?.userId) || FEATURES.gmail;
};
