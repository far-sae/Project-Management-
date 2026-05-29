import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Upload, Globe, Mail, MousePointer2, RefreshCcw,
  ChevronRight, ChevronDown, Copy, Check, ExternalLink,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface LeadsLandingProps {
  canCreate: boolean;
  onCreate: () => void;
  onImport: () => void;
}

type SourceKey = 'webform' | 'email' | 'website' | 'google';

interface SourceMeta {
  key: SourceKey;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
  status: 'ready' | 'manual' | 'coming-soon';
}

const SOURCES: SourceMeta[] = [
  {
    key: 'webform',
    icon: Globe,
    label: 'Webform',
    hint: 'Embed a public form that drops submissions straight into your leads list.',
    status: 'ready',
  },
  {
    key: 'email',
    icon: Mail,
    label: 'Email',
    hint: 'Forward sales inquiries from your inbox and parse them into leads.',
    status: 'manual',
  },
  {
    key: 'website',
    icon: MousePointer2,
    label: 'Website visitors',
    hint: 'Track who lands on your site and enrich them as anonymous leads.',
    status: 'coming-soon',
  },
  {
    key: 'google',
    icon: RefreshCcw,
    label: 'Google Sync',
    hint: 'Sync Google Contacts or Gmail conversations to seed prospects.',
    status: 'ready',
  },
];

/**
 * Zoho-style "How do you bring in Leads?" landing — shown when the
 * workspace has no leads yet so reps know what their options are.
 * Each source row expands to show a concrete next step.
 */
export const LeadsLanding: React.FC<LeadsLandingProps> = ({
  canCreate, onCreate, onImport,
}) => {
  const [expanded, setExpanded] = useState<SourceKey | null>(null);

  const toggle = (k: SourceKey) => setExpanded((cur) => (cur === k ? null : k));

  return (
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

          <div className="grid gap-6 mt-8 md:grid-cols-[1fr_1px_240px] items-start">
            <ul className="space-y-1">
              {SOURCES.map((s) => (
                <SourceRow
                  key={s.key}
                  source={s}
                  expanded={expanded === s.key}
                  onToggle={() => toggle(s.key)}
                />
              ))}
            </ul>

            <div className="hidden md:block h-32 w-px bg-border mx-auto relative mt-4">
              <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs text-muted-foreground">
                or
              </span>
            </div>

            <div className="flex flex-col gap-2 mt-4">
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
};

// ─── Expandable source rows ──────────────────────────────────────────────

const SourceRow: React.FC<{
  source: SourceMeta;
  expanded: boolean;
  onToggle: () => void;
}> = ({ source, expanded, onToggle }) => {
  const Icon = source.icon;
  const Chev = expanded ? ChevronDown : ChevronRight;
  // Standard WAI-ARIA disclosure pattern so screen-reader users hear the
  // expand/collapse state instead of a generic button.
  const regionId = `lead-source-${source.key}-detail`;
  return (
    <li className="border-b border-border/40 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={regionId}
        className="w-full flex items-start gap-2 py-2 text-left hover:bg-muted/30 rounded transition-colors px-1"
      >
        <Chev className="w-3.5 h-3.5 text-muted-foreground mt-1.5 shrink-0" aria-hidden="true" />
        <Icon className="w-4 h-4 text-muted-foreground mt-1.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-medium">{source.label}</p>
            {source.status === 'coming-soon' && (
              <Badge variant="outline" className="text-[9px]">Coming soon</Badge>
            )}
            {source.status === 'manual' && (
              <Badge variant="outline" className="text-[9px]">Manual setup</Badge>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">{source.hint}</p>
        </div>
      </button>
      <div
        id={regionId}
        role="region"
        aria-label={`${source.label} details`}
        className={cn(
          'grid transition-all duration-200',
          expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="overflow-hidden">
          <div className="pl-9 pr-2 pb-3 pt-1">
            <SourceDetail source={source.key} />
          </div>
        </div>
      </div>
    </li>
  );
};

const SourceDetail: React.FC<{ source: SourceKey }> = ({ source }) => {
  switch (source) {
    case 'webform':       return <WebformDetail />;
    case 'email':         return <EmailDetail />;
    case 'website':       return <WebsiteVisitorsDetail />;
    case 'google':        return <GoogleSyncDetail />;
  }
};

const WebformDetail: React.FC = () => {
  const navigate = useNavigate();
  return (
    <div className="space-y-2 text-xs">
      <p className="text-muted-foreground">
        TaskCalendar ships with a Lead-forms builder. Build a public form
        in Settings, then embed the URL on your marketing site. Submissions
        land as new leads in this workspace.
      </p>
      <Button
        size="sm"
        variant="outline"
        onClick={() => navigate('/settings?tab=lead-forms')}
      >
        <ExternalLink className="w-3 h-3 mr-1.5" />
        Open Lead-forms builder
      </Button>
    </div>
  );
};

const EmailDetail: React.FC = () => {
  // For now we surface the manual "forward + parse" pattern without standing
  // up an inbound MX. When email-to-lead lands, this will show a real
  // org-specific forwarding address.
  return (
    <div className="space-y-2 text-xs">
      <p className="text-muted-foreground">
        Email-to-lead parsing is on the roadmap. In the meantime, forward
        sales inquiries to your team, copy the prospect's details into the{' '}
        <strong>Create a Lead</strong> form, and the AI reply suggester will
        draft the first response back.
      </p>
      <p className="text-muted-foreground">
        Or import the conversation as a CSV — Gmail Takeout supports per-thread
        exports.
      </p>
    </div>
  );
};

const WebsiteVisitorsDetail: React.FC = () => {
  const snippet = `<!-- TaskCalendar lead-capture beacon (coming soon) -->
<script async src="https://cdn.taskcalendar.app/lead-beacon.js"
  data-org="YOUR_ORG_ID"></script>`;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success('Snippet copied');
    } catch {
      toast.error("Couldn't copy — select the snippet and copy manually.");
    }
  };
  return (
    <div className="space-y-2 text-xs">
      <p className="text-muted-foreground">
        Drop this beacon on your marketing site. Anonymous visitors who match
        UTM parameters or fill in any contact form get nudged into your leads
        list with a "web visitor" source. The endpoint ships in a future
        release — the snippet is shown so you can plan your tagging.
      </p>
      <pre className="rounded-md border bg-muted/40 p-2 font-mono text-[10px] whitespace-pre overflow-x-auto">
{snippet}
      </pre>
      <Button size="sm" variant="outline" onClick={copy}>
        {copied ? <Check className="w-3 h-3 mr-1.5" /> : <Copy className="w-3 h-3 mr-1.5" />}
        {copied ? 'Copied' : 'Copy snippet'}
      </Button>
    </div>
  );
};

const GoogleSyncDetail: React.FC = () => {
  const navigate = useNavigate();
  return (
    <div className="space-y-2 text-xs">
      <p className="text-muted-foreground">
        Connect your Google account under Integrations. Once connected,
        every contact you exchange more than two emails with becomes a
        candidate lead, and you can pull a Google Contacts group as a CSV
        and import it here.
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigate('/settings?tab=integrations')}
        >
          <ExternalLink className="w-3 h-3 mr-1.5" />
          Open Integrations
        </Button>
      </div>
    </div>
  );
};
