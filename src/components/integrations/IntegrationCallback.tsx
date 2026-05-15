import React, { useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

export const IntegrationCallback: React.FC = () => {
  const [params] = useSearchParams();
  const connected = params.get('connected');
  const error = params.get('error');

  useEffect(() => {
    if (connected) {
      toast.success(`${connected} connected`);
    } else if (error) {
      toast.error(`Connection failed: ${error}`);
    }
  }, [connected, error]);

  // The Edge Function redirects directly to /settings?tab=integrations, so
  // this component is mostly a safety net. If it ever loads, forward to the
  // tab.
  return <Navigate to="/settings?tab=integrations" replace />;
};
