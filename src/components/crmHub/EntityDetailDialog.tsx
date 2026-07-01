import React from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { NotesPanel } from './NotesPanel';

type Scope =
  | { kind: 'contact'; id: string; label: string; subtitle?: string | null }
  | { kind: 'company'; id: string; label: string; subtitle?: string | null }
  | { kind: 'deal'; id: string; label: string; subtitle?: string | null };

interface Props {
  scope: Scope | null;
  onOpenChange: (open: boolean) => void;
  /** Optional extra content shown above the notes panel (e.g. field summary). */
  children?: React.ReactNode;
}

const kindHeading: Record<Scope['kind'], string> = {
  contact: 'Contact',
  company: 'Company',
  deal: 'Deal',
};

export const EntityDetailDialog: React.FC<Props> = ({ scope, onOpenChange, children }) => {
  const open = scope !== null;
  const scopedTo = scope
    ? scope.kind === 'contact' ? { contactId: scope.id }
      : scope.kind === 'company' ? { companyId: scope.id }
      : { dealId: scope.id }
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {scope && (
          <>
            <DialogHeader>
              <DialogTitle>
                <span className="text-xs uppercase tracking-wide text-muted-foreground mr-2">
                  {kindHeading[scope.kind]}
                </span>
                {scope.label}
              </DialogTitle>
              {scope.subtitle && (
                <DialogDescription>{scope.subtitle}</DialogDescription>
              )}
            </DialogHeader>
            {children}
            {scopedTo && (
              <div className="border-t border-border pt-4 mt-2 max-h-[55vh] overflow-y-auto">
                <NotesPanel scopedTo={scopedTo} />
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default EntityDetailDialog;
