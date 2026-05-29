import React from 'react';
import {
  Plus, Upload, Phone, Mail, Radio, ChevronRight,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface ContactsLandingProps {
  canCreate: boolean;
  onCreate: () => void;
  onImport: () => void;
}

const POINTS: { icon: React.ComponentType<{ className?: string }>; label: string; hint: string }[] = [
  {
    icon: Phone,
    label: 'Engage Contacts through multiple channels',
    hint: 'Call from the record, send a quick SMS, or fire off an email — every touch lands on the timeline.',
  },
  {
    icon: Mail,
    label: 'Email Contacts with reusable templates',
    hint: 'Pick a template, let merge tokens fill in the personal bits, and ship it.',
  },
  {
    icon: Radio,
    label: 'Keep track of Contacts in a single place — Signals',
    hint: 'Notes, deals, tasks, and meetings stay nested under the contact so nothing slips through.',
  },
];

/**
 * Zoho-style "How to get the most out of your Contacts?" empty state.
 * Shown when no contacts exist in the workspace yet.
 */
export const ContactsLanding: React.FC<ContactsLandingProps> = ({
  canCreate, onCreate, onImport,
}) => (
  <div className="grid place-items-center py-10">
    <Card className="max-w-3xl w-full">
      <CardContent className="pt-8 pb-8">
        <h2 className="text-xl md:text-2xl font-semibold text-center">
          How to get the most out of your Contacts?
        </h2>

        <div className="grid gap-6 mt-8 md:grid-cols-[1fr_1px_240px] items-start">
          <ul className="space-y-2.5">
            {POINTS.map((p) => {
              const Icon = p.icon;
              return (
                <li key={p.label} className="flex items-start gap-2 text-sm">
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground mt-1 shrink-0" />
                  <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium">{p.label}</p>
                    <p className="text-[11px] text-muted-foreground">{p.hint}</p>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="hidden md:block h-32 w-px bg-border mx-auto relative">
            <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs text-muted-foreground">
              or
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {canCreate ? (
              <>
                <Button onClick={onCreate}>
                  <Plus className="w-4 h-4 mr-2" /> Create a Contact
                </Button>
                <Button variant="outline" onClick={onImport}>
                  <Upload className="w-4 h-4 mr-2" /> Import Contacts
                </Button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground text-center">
                Ask an admin or owner to add contacts. Viewers can read but not create.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
);
