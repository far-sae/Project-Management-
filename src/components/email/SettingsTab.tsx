import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, Save, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { getEmailSettings, saveEmailSettings } from '@/services/supabase/email';
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
 * 1-24, and requires start < end — the two selects below only ever offer
 * choices that keep that true, so an invalid pair cannot be built here.
 */
export const SettingsTab: React.FC<SettingsTabProps> = ({ orgId, isAdmin, orgTimezone }) => {
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) { setLoading(false); return; }
    setLoading(true);
    getEmailSettings(orgId, orgTimezone)
      .then(setSettings)
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load email settings'))
      .finally(() => setLoading(false));
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

  const toggleDay = (day: number) => {
    update((s) => {
      const has = s.window.days.includes(day);
      const days = has ? s.window.days.filter((d) => d !== day) : [...s.window.days, day].sort((a, b) => a - b);
      return { ...s, window: { ...s.window, days } };
    });
  };

  const handleSave = async () => {
    if (!isAdmin || !settings) return;
    setSaving(true);
    setError(null);
    try {
      await saveEmailSettings(orgId, settings);
      toast.success('Email settings saved');
    } catch (err) {
      // saveEmailSettings throws a readable message for an out-of-order
      // window or jitter range — surfaced as-is rather than a generic failure.
      setError(err instanceof Error ? err.message : 'Failed to save email settings');
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

  if (!settings) return null;

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
          When your organization sends, and how it paces messages between them.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {!isAdmin && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Lock className="w-4 h-4" />Only an organization owner or admin can change these settings.
          </div>
        )}
        {error && (
          <div className="p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-md">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
          <div>
            <Label htmlFor="window-enabled">Only send within a window</Label>
            <p className="text-xs text-muted-foreground">Outside it, the queue waits instead of sending.</p>
          </div>
          <Switch
            id="window-enabled"
            checked={settings.window.enabled}
            disabled={!isAdmin}
            onCheckedChange={(v) => update((s) => ({ ...s, window: { ...s.window, enabled: v } }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Start hour</Label>
            <Select value={String(settings.window.startHour)} onValueChange={setStartHour} disabled={!isAdmin}>
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
            <Select value={String(settings.window.endHour)} onValueChange={setEndHour} disabled={!isAdmin}>
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
                disabled={!isAdmin}
                onClick={() => toggleDay(d.value)}
              >
                {d.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Timezone</Label>
          <Select
            value={settings.window.timezone}
            disabled={!isAdmin}
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
            A random pause between messages, drawn fresh each time, keeps sending from looking automated.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="jitter-min" className="text-xs text-muted-foreground">Minimum (seconds)</Label>
              <Input
                id="jitter-min"
                type="number"
                min={0}
                disabled={!isAdmin}
                value={Math.round(settings.jitterMinMs / 1000)}
                onChange={(e) => update((s) => ({
                  ...s, jitterMinMs: Math.max(0, Number(e.target.value) || 0) * 1000,
                }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="jitter-max" className="text-xs text-muted-foreground">Maximum (seconds)</Label>
              <Input
                id="jitter-max"
                type="number"
                min={0}
                disabled={!isAdmin}
                value={Math.round(settings.jitterMaxMs / 1000)}
                onChange={(e) => update((s) => ({
                  ...s, jitterMaxMs: Math.max(0, Number(e.target.value) || 0) * 1000,
                }))}
              />
            </div>
          </div>
        </div>

        {isAdmin && (
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Save settings
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SettingsTab;
