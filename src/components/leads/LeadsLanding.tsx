import React from 'react';
import {
  Plus, Upload, Globe, Mail, MousePointer2, RefreshCcw, ChevronRight,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface LeadsLandingProps {
  canCreate: boolean;
  onCreate: () => void;
  onImport: () => void;
}

const SOURCES: { icon: React.ComponentType<{ className?: string }>; label: string; hint: string }[] = [
  { icon: Globe,         label: 'Webform',           hint: 'Embed a public form that drops submissions straight into your leads list.' },
  { icon: Mail,          label: 'Email',             hint: 'Forward sales inquiries from your inbox and parse them into leads.' },
  { icon: MousePointer2, label: 'Website visitors',  hint: 'Track who lands on your site and enrich them as anonymous leads.' },
  { icon: RefreshCcw,    label: 'Google Sync',       hint: 'Sync Google Contacts or Gmail conversations to seed prospects.' },
];

/**
 * Zoho-style "How do you bring in Leads?" landing — shown when the
 * workspace has no leads yet so reps know what their options are.
 */
export const LeadsLanding: React.FC<LeadsLandingProps> = ({
  canCreate, onCreate, onImport,
}) => (
  <div className="grid place-items-center py-10">
    <Card className="max-w-3xl w-full">
      <CardContent className="pt-8 pb-8">
        <h2 className="text-xl md:text-2xl font-semibold text-center">
          How do you bring in Leads?
        </h2>
        <p className="text-sm text-muted-foreground text-center mt-1.5 max-w-xl mx-auto">
          There are lots of ways to identify prospective customers for your
          product or service.
        </p>

        <div className="grid gap-6 mt-8 md:grid-cols-[1fr_1px_240px] items-center">
          <ul className="space-y-2.5">
            {SOURCES.map((s) => {
              const Icon = s.icon;
              return (
                <li
                  key={s.label}
                  className="flex items-start gap-2 text-sm"
                  title={s.hint}
                >
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground mt-1 shrink-0" />
                  <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium">{s.label}</p>
                    <p className="text-[11px] text-muted-foreground">{s.hint}</p>
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
                  <Plus className="w-4 h-4 mr-2" /> Create a Lead
                </Button>
                <Button variant="outline" onClick={onImport}>
                  <Upload className="w-4 h-4 mr-2" /> Import Leads
                </Button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground text-center">
                Ask an admin or owner to add leads. Viewers can read but not create.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
);
