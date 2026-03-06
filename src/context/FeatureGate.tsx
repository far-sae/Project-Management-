import { useSubscription, AppFeature } from '@/context/SubscriptionContext';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Lock } from 'lucide-react';

interface FeatureGateProps {
  feature: AppFeature;
  children: React.ReactNode;
  fallback?: React.ReactNode; // custom fallback UI
}

export const FeatureGate: React.FC<FeatureGateProps> = ({ feature, children, fallback }) => {
  const { hasFeature } = useSubscription();
  const navigate = useNavigate();

  if (hasFeature(feature)) return <>{children}</>;

  if (fallback) return <>{fallback}</>;

  return (
    <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-gray-200 rounded-lg text-center">
      <Lock className="w-8 h-8 text-gray-400 mb-3" />
      <p className="font-medium text-gray-700 mb-1">Feature Locked</p>
      <p className="text-sm text-gray-500 mb-4">Upgrade your plan to unlock this feature.</p>
      <Button
        className="bg-gradient-to-r from-orange-500 to-red-500"
        onClick={() => navigate('/pricing')}
      >
        Upgrade Plan
      </Button>
    </div>
  );
};
