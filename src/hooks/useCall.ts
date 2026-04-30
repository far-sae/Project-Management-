import { useCallContext } from '@/components/calling/CallProvider';

/**
 * Convenience hook that re-exports the call state and actions from CallProvider.
 * Components can `const { state, actions } = useCall()`.
 */
export function useCall() {
  return useCallContext();
}
