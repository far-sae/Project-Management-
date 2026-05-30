import React from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Mail } from 'lucide-react';

interface SendInvitesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participantCount: number;
  onChoose: (send: boolean) => void;
}

/**
 * Confirm dialog that mirrors Zoho's "Send Invitations?" prompt after
 * a meeting save. We don't auto-send for two reasons:
 *  - The user may have added participants speculatively while drafting.
 *  - Some orgs route invites through their own calendar tool and want
 *    to opt out per-meeting.
 *
 * The `send` boolean is persisted on meetings.send_invites so an
 * external worker (e.g. a Calendar-sync edge function) can pick it up
 * and dispatch invites without re-prompting the user.
 */
export const SendInvitesDialog: React.FC<SendInvitesDialogProps> = ({
  open, onOpenChange, participantCount, onChoose,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-primary" />
            Send Invitations
          </DialogTitle>
          <DialogDescription>
            Would you like to send invitations to{' '}
            {participantCount === 1 ? '1 guest' : `${participantCount} guests`}?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row gap-2">
          <Button onClick={() => onChoose(true)} className="bg-emerald-600 hover:bg-emerald-700">
            Send
          </Button>
          <Button variant="outline" onClick={() => onChoose(false)}>
            Do Not Send
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
