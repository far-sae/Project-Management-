import React, { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/AuthContext';
import {
  fetchUserCapacity,
  upsertUserCapacity,
  DEFAULT_HOURS_PER_WEEK,
} from '@/services/supabase/capacity';

export const CapacitySettings: React.FC = () => {
  const { user } = useAuth();
  const [hours, setHours] = useState<number>(DEFAULT_HOURS_PER_WEEK);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!user) return;
    setLoading(true);
    fetchUserCapacity(user.userId)
      .then((cap) => {
        if (cancelled) return;
        setHours(cap?.hoursPerWeek ?? DEFAULT_HOURS_PER_WEEK);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    if (Number.isNaN(hours) || hours < 0 || hours > 168) {
      toast.error('Hours must be between 0 and 168');
      return;
    }
    setSaving(true);
    try {
      await upsertUserCapacity(user.userId, hours);
      toast.success('Capacity updated');
      setDirty(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly capacity</CardTitle>
        <CardDescription>
          Used in the Workload view to compare your assigned task load against
          available hours each week.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Loading…
          </div>
        ) : (
          <>
            <div className="space-y-2 max-w-xs">
              <Label htmlFor="hoursPerWeek">Hours per week</Label>
              <Input
                id="hoursPerWeek"
                type="number"
                min={0}
                max={168}
                step={1}
                value={hours}
                onChange={(e) => {
                  setHours(Number(e.target.value));
                  setDirty(true);
                }}
              />
              <p className="text-xs text-muted-foreground">
                Default is {DEFAULT_HOURS_PER_WEEK} hours. Most teams use 30–40.
              </p>
            </div>
            <Button onClick={handleSave} disabled={!dirty || saving}>
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save capacity
                </>
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default CapacitySettings;
