import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, Save, Lock, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { getEmailSettings, saveEmailSettings } from '@/services/supabase/email';
import { describeSendWindow, MAX_JITTER_MS } from '@/lib/email/sendWindow';
import type { EmailSettings } from '@/lib/email/types';

interface SettingsTabProps {
  orgId: string;
  isAdmin: boolean;
  orgTimezone: string;
}

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

const dayLabels = (days: number[]): string =>
  WEEKDAYS.filter((d) => days.includes(d.value)).map((d) => d.label).join(', ') || 'No days selected';

// A short curated list, not every IANA zone — same "plain Select" pattern as
// the currency picker on the Contracts page. The organization's saved zone is
// prepended if it isn't already one of these, so reopening this tab never
// silently swaps a stored value for a nearby one.
const COMMON_TIMEZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'Africa/Lagos', 'Africa/Cairo', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo',
  'Asia/Singapore', 'Australia/Sydney', 'Pacific/Auckland',
];

const formatHour = (h: number): string => {
  if (h === 24) return '12:00 AM (end of day)';
  const hour = h % 24;
  const period = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:00 ${period}`;
};

/**
 * The send window, weekday and jitter settings for the whole organization.
 * Migration 156 constrains send_window_start to 0-23, send_window_end to
 * 1-24, and requires start < end, and jitter_min_ms <= jitter_max_ms — the
 * two hour selects and the two jitter inputs below only ever offer, or nudge
 * toward, choices that keep both true, so an invalid pair cannot be built
 * here and submitted.
 *
 * Only an admin ever sees the editable form: a member gets a read-only
 * summary instead of the same controls disabled, per the admin-only gate —
 * omitted from the DOM, not just styled unusable.
 */
export const SettingsTab: React.FC<SettingsTabProps> = ({ orgId, isAdmin, orgTimezone }) => {
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = () => {
    if (!orgId) { setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    getEmailSettings(orgId, orgTimezone)
      .then(setSettings)
      .catch((err) => setLoadError(err instanceof Error ? err.message : 'Failed to load email settings'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const update = (updater: (s: EmailSettings) => EmailSettings) => {
    setSettings((prev) => (prev ? updater(prev) : prev));
  };

  // Keeping the pair valid on every change, not just filtering the options:
  // nudging the other bound when a choice would otherwise cross it means
  // start < end holds even between the two onChange calls.
  const setStartHour = (value: string) => {
    const start = Number(value);
    update((s) => ({
      ...s,
      window: {
        ...s.window,
        startHour: start,
        endHour: s.window.endHour <= start ? Math.min(24, start + 1) : s.window.endHour,
      },
    }));
  };

  const setEndHour = (value: string) => {
    const end = Number(value);
    update((s) => ({
      ...s,
      window: {
        ...s.window,
        endHour: end,
        startHour: s.window.startHour >= end ? Math.max(0, end - 1) : s.window.startHour,
      },
    }));
  };

  // Turning off the last remaining day is refused rather than saved. An empty
  // list is a perfectly valid array as far as the column is concerned, and
  // isWithinSendWindow() then matches no day of the week — so the whole
  // organization stops sending, silently, with a screen that looks saved.
  const toggleDay = (day: number) => {
    update((s) => {
      const has = s.window.days.includes(day);
      if (has && s.window.days.length === 1) return s;
      const days = has ? s.window.days.filter((d) => d !== day) : [...s.window.days, day].sort((a, b) => a - b);
      return { ...s, window: { ...s.window, days } };
    });
  };

  // Same nudge-the-other-bound approach as the hour selects, so
  // jitterMinMs <= jitterMaxMs holds after every edit rather than only being
  // checked (and rejected) by saveEmailSettings once Save is pressed.
  //
  // Displayed and edited in whole seconds. If the stored value isn't an
  // exact multiple of 1000ms — e.g. seeded directly in the database —
  // touching either field rounds it to the nearest second the next time
  // settings are saved. Accepted rather than fixed: this UI is meant to be
  // read and set in seconds, and a sub-second difference in a random pause
  // has no practical effect on pacing.
  // Clamped at both ends. MAX_JITTER_MS is the same ceiling
  // email_settings_jitter_ceiling_check enforces in migration 156: a pause
  // long enough to push the tail of every batch past the end of the window is
  // a typo, not a setting, and it would stop sending rather than slow it.
  const setJitterMinSeconds = (raw: string) => {
    const minMs = Math.min(MAX_JITTER_MS, Math.max(0, Number(raw) || 0) * 1000);
    update((s) => ({
      ...s,
      jitterMinMs: minMs,
      jitterMaxMs: s.jitterMaxMs < minMs ? minMs : s.jitterMaxMs,
    }));
  };

  const setJitterMaxSeconds = (raw: string) => {
    const maxMs = Math.min(MAX_JITTER_MS, Math.max(0, Number(raw) || 0) * 1000);
    update((s) => ({
      ...s,
      jitterMaxMs: maxMs,
      jitterMinMs: s.jitterMinMs > maxMs ? maxMs : s.jitterMinMs,
    }));
  };

  const handleSave = async () => {
    if (!isAdmin || !settings) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveEmailSettings(orgId, settings);
      toast.success('Email settings saved');
    } catch (err) {
      // saveEmailSettings throws a readable message for an out-of-order
      // window or jitter range — surfaced as-is rather than a generic failure.
      setSaveError(err instanceof Error ? err.message : 'Failed to save email settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-muted-foreground">
          <Loader2 className="w-10 h-10 mx-auto mb-4 animate-spin text-muted-foreground/60" />
          <p>Loading settings...</p>
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sending schedule</CardTitle>
        </CardHeader>
        <CardContent className="py-12 text-center">
          <p className="text-sm text-red-600 dark:text-red-400 mb-4">{loadError}</p>
          <Button variant="outline" onClick={load}>
            <RefreshCw className="w-4 h-4 mr-2" />Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!settings) return null;

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sending schedule</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            When your organization sends, and how it paces messages between them. Nothing else
            throttles a campaign: this window, the pause between messages and each
            mailbox&rsquo;s daily limit are the whole of it.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock className="w-4 h-4" />Only an organization owner or admin can change these settings.
          </div>
          <div className="p-4 bg-secondary/40 border border-border rounded-lg space-y-1.5 text-sm">
            <p className="text-foreground">{describeSendWindow(settings.window)}</p>
            <p className="text-muted-foreground">Days: {dayLabels(settings.window.days)}</p>
            <p className="text-muted-foreground">Timezone: {settings.window.timezone}</p>
            <p className="text-muted-foreground">
              Pauses {Math.round(settings.jitterMinMs / 1000)}–{Math.round(settings.jitterMaxMs / 1000)}{' '}
              seconds between messages.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const timezoneOptions = COMMON_TIMEZONES.includes(settings.window.timezone)
    ? COMMON_TIMEZONES
    : [settings.window.timezone, ...COMMON_TIMEZONES];
  const startOptions = Array.from({ length: 24 }, (_, h) => h).filter((h) => h < settings.window.endHour);
  const endOptions = Array.from({ length: 24 }, (_, h) => h + 1).filter((h) => h > settings.window.startHour);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sending schedule</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          When your organization sends, and how it paces messages between them. Nothing else
          throttles a campaign: this window, the pause between messages and each
          mailbox&rsquo;s daily limit are the whole of it.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {saveError && (
          <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-md">
            <p className="text-sm text-red-700 dark:text-red-300">{saveError}</p>
          </div>
        )}

        {/*
          Off until somebody turns it on, and worded so that what it does is
          clear before they do. Recording when a recipient opened an email is
          surveillance, however ordinary it has become; some users of this
          product need consent for it and some simply would not want it.

          The second sentence is not a disclaimer to be trimmed. Apple Mail
          pre-fetches every image in every message and has since 2021, so a
          user who turns this on and reads the number as "how many people read
          my email" is being misled by us. Saying it here is cheaper than the
          decision they would otherwise make on it.
        */}
        <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
          <div>
            <Label htmlFor="track-opens">Track opens</Label>
            <p className="text-xs text-muted-foreground">
              Adds an invisible image to bulk and sequence mail so you can see which messages were
              opened. Never added to single sends. Apple Mail and most security scanners load
              images automatically, so the count is an estimate — the screens separate what looks
              automatic from what does not.
            </p>
          </div>
          <Switch
            id="track-opens"
            checked={settings.trackOpens}
            onCheckedChange={(v) => update((s) => ({ ...s, trackOpens: v }))}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
          <div>
            <Label htmlFor="window-enabled">Only send within a window</Label>
            <p className="text-xs text-muted-foreground">Outside it, the queue waits instead of sending.</p>
          </div>
          <Switch
            id="window-enabled"
            checked={settings.window.enabled}
            onCheckedChange={(v) => update((s) => ({ ...s, window: { ...s.window, enabled: v } }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Start hour</Label>
            <Select value={String(settings.window.startHour)} onValueChange={setStartHour}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {startOptions.map((h) => (
                  <SelectItem key={h} value={String(h)}>{formatHour(h)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>End hour</Label>
            <Select value={String(settings.window.endHour)} onValueChange={setEndHour}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {endOptions.map((h) => (
                  <SelectItem key={h} value={String(h)}>{formatHour(h)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Days</Label>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => (
              <Button
                key={d.value}
                type="button"
                size="sm"
                variant={settings.window.days.includes(d.value) ? 'default' : 'outline'}
                onClick={() => toggleDay(d.value)}
              >
                {d.label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            At least one day. With none selected nothing would ever send.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Timezone</Label>
          <Select
            value={settings.window.timezone}
            onValueChange={(v) => update((s) => ({ ...s, window: { ...s.window, timezone: v } }))}
          >
            <SelectTrigger className="w-full sm:w-80"><SelectValue /></SelectTrigger>
            <SelectContent>
              {timezoneOptions.map((tz) => (
                <SelectItem key={tz} value={tz}>{tz}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <Label>Pause between messages</Label>
          <p className="text-xs text-muted-foreground">
            A random pause between messages, drawn fresh each time, keeps sending from looking
            automated. At most {MAX_JITTER_MS / 1000} seconds — a longer pause would push the end
            of a batch past the end of the window instead of pacing it.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="jitter-min" className="text-xs text-muted-foreground">Minimum (seconds)</Label>
              <Input
                id="jitter-min"
                type="number"
                min={0}
                max={MAX_JITTER_MS / 1000}
                value={Math.round(settings.jitterMinMs / 1000)}
                onChange={(e) => setJitterMinSeconds(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="jitter-max" className="text-xs text-muted-foreground">Maximum (seconds)</Label>
              <Input
                id="jitter-max"
                type="number"
                min={0}
                max={MAX_JITTER_MS / 1000}
                value={Math.round(settings.jitterMaxMs / 1000)}
                onChange={(e) => setJitterMaxSeconds(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Save settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default SettingsTab;
