import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Lock, Zap } from 'lucide-react';

interface LimitReachedModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
}

export const LimitReachedModal: React.FC<LimitReachedModalProps> = ({
  open,
  onClose,
  title = "Plan Limit Reached",
  message = "You've reached the limit for your current plan. Upgrade to continue.",
}) => {
  const navigate = useNavigate();

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
              <Lock className="w-5 h-5 text-orange-600" />
            </div>
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-gray-600">
            {message}
          </DialogDescription>
        </DialogHeader>

        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 my-2">
          <p className="text-sm text-orange-800 font-medium">
            💡 Upgrade your plan to unlock higher limits and more features.
          </p>
        </div>

        <div className="flex gap-3 mt-2">
          <Button
            className="flex-1 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600"
            onClick={() => { navigate('/pricing'); onClose(); }}
          >
            <Zap className="w-4 h-4 mr-2" />
            View Plans
          </Button>
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Maybe Later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LimitReachedModal;
