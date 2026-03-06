import React, { useEffect } from 'react';
import { useRouteError, isRouteErrorResponse, useNavigate, useRevalidator } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { AlertCircle, Home, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface ErrorBoundaryProps {
  fallbackPath?: string;
}

export const ErrorBoundary: React.FC<ErrorBoundaryProps> = ({ fallbackPath = '/' }) => {
  const error = useRouteError();
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();

  // Show toast for unexpected (non-route) errors only
  useEffect(() => {
    if (!isRouteErrorResponse(error)) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unexpected error occurred';
      toast.error(errorMessage);
    }
  }, [error]);

  // Resolve human-readable message
  const message = isRouteErrorResponse(error)
    ? error.statusText ||
    (typeof error.data === 'string' ? error.data : error.data?.message) ||
    'Something went wrong'
    : error instanceof Error
      ? error.message
      : 'An unexpected error occurred';

  const status = isRouteErrorResponse(error) ? error.status : null;

  // Status-specific titles
  const title =
    status === 404 ? 'Page Not Found'
      : status === 403 ? 'Access Denied'
        : status === 401 ? 'Unauthorized'
          : status ? `Error ${status}`
            : 'Something Went Wrong';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 text-red-600 mb-6">
          <AlertCircle className="w-8 h-8" />
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">{title}</h1>
        <p className="text-gray-600 mb-6 break-words">{message}</p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          {/* Soft retry via React Router revalidator */}
          <Button
            variant="outline"
            onClick={revalidate}
            className="inline-flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </Button>

          {/* Hard reload */}
          <Button
            variant="outline"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Reload Page
          </Button>

          {/* Navigate to fallback path */}
          <Button
            onClick={() => navigate(fallbackPath, { replace: true })}
            className="inline-flex items-center gap-2 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600"
          >
            <Home className="w-4 h-4" />
            Go Home
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ErrorBoundary;
