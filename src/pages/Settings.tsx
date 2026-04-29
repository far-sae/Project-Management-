import React, { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useSubscription } from "@/context/SubscriptionContext";
import { Sidebar } from "@/components/sidebar/Sidebar";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  updateUserProfile,
  changePassword,
  setUserCancelAtPeriodEnd,
} from "@/services/supabase/auth";
import { supabase } from "@/services/supabase/config";
import { SUPPORT_EMAIL } from "@/lib/support-email";
import { uploadAvatar } from "@/services/supabase/storage";
import {
  User,
  Bell,
  Shield,
  CreditCard,
  Save,
  Camera,
  Loader2,
  Palette,
  Activity,
} from "lucide-react";
import { toast } from "sonner";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { CapacitySettings } from "@/components/settings/CapacitySettings";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type UserNotificationPreferences,
  normalizeNotificationPreferences,
  invalidateNotificationPreferencesCache,
} from "@/lib/notificationPreferences";

const NOTIFICATIONS_KEY = "user_notification_prefs";

export const Settings: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'profile';
  const { user, refreshUser } = useAuth();
  const {
    subscription,
    trialInfo,
    refreshSubscription,
    loading: subscriptionLoading,
  } = useSubscription();

  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelNowLoading, setCancelNowLoading] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [email] = useState(user?.email || "");
  const [profileLoading, setProfileLoading] = useState(false);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const photoInputRef = useRef<HTMLInputElement>(null);

  const subscriptionFetchedRef = useRef(false);

  const [notifications, setNotifications] = useState<UserNotificationPreferences>({
    ...DEFAULT_NOTIFICATION_PREFERENCES,
  });
  /** "saving" while syncing to Supabase, "saved" briefly after a successful sync, then idle. */
  const [notifSaveState, setNotifSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const notifSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifPendingPrefsRef = useRef<UserNotificationPreferences | null>(null);
  /** Used in unmount flush so prefs sync runs with the latest user id. */
  const notifUserIdRef = useRef<string | undefined>(user?.userId);
  /** Avoid overlapping Supabase writes from cleanup + deferred timer firing. */
  const notifSyncInFlightRef = useRef(false);

  useEffect(() => {
    setDisplayName(user?.displayName || "");
  }, [user?.displayName]);

  useEffect(() => {
    notifUserIdRef.current = user?.userId;
  }, [user?.userId]);

  useEffect(() => {
    return () => {
      if (notifSyncTimerRef.current) {
        clearTimeout(notifSyncTimerRef.current);
        notifSyncTimerRef.current = null;
      }
      if (notifSavedTimerRef.current) {
        clearTimeout(notifSavedTimerRef.current);
        notifSavedTimerRef.current = null;
      }

      const prefs = notifPendingPrefsRef.current;
      const uid = notifUserIdRef.current;
      if (!prefs || !uid || notifSyncInFlightRef.current) return;

      notifSyncInFlightRef.current = true;
      void (async () => {
        try {
          const { error } = await supabase
            .from("user_profiles")
            .update({
              notification_preferences: prefs as unknown as Record<string, boolean>,
            })
            .eq("id", uid);
          if (!error) {
            invalidateNotificationPreferencesCache(uid);
          }
        } finally {
          notifSyncInFlightRef.current = false;
        }
      })();
    };
  }, []);

  /** Load from Supabase (so other users’ actions respect your settings); fall back to localStorage migration. */
  useEffect(() => {
    if (!user?.userId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("user_profiles")
        .select("notification_preferences")
        .eq("id", user.userId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.warn("Failed to load notification preferences:", error.message);
        try {
          const stored = localStorage.getItem(NOTIFICATIONS_KEY);
          if (stored) {
            setNotifications(
              normalizeNotificationPreferences(JSON.parse(stored) as unknown),
            );
          }
        } catch {
          /* ignore */
        }
        return;
      }
      if (data?.notification_preferences != null) {
        setNotifications(
          normalizeNotificationPreferences(data.notification_preferences),
        );
        return;
      }
      try {
        const stored = localStorage.getItem(NOTIFICATIONS_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as unknown;
          const norm = normalizeNotificationPreferences(parsed);
          setNotifications(norm);
          await supabase
            .from("user_profiles")
            .update({ notification_preferences: norm as Record<string, boolean> })
            .eq("id", user.userId);
          invalidateNotificationPreferencesCache(user.userId);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.userId]);

  useEffect(() => {
    if (!subscriptionFetchedRef.current && user?.userId) {
      subscriptionFetchedRef.current = true;
      refreshSubscription();
    }
  }, [user?.userId]);

  // Show loading state
  if (subscriptionLoading && !subscription) {
    return (
      <div className="flex h-screen bg-background">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">Loading settings...</p>
          </div>
        </main>
      </div>
    );
  }

  // ── Profile ───────────────────────────────────────────────
  const handleSaveProfile = async () => {
    if (!user?.userId) return;
    setProfileLoading(true);
    const toastId = toast.loading("Saving profile...");
    try {
      await updateUserProfile(user.userId, { displayName });
      await refreshUser();
      toast.success("Profile updated successfully", { id: toastId });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update profile",
        { id: toastId },
      );
    } finally {
      setProfileLoading(false);
    }
  };

  // ── Photo ─────────────────────────────────────────────────
  const handleChangePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.userId) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    setPhotoLoading(true);
    const toastId = toast.loading("Uploading photo...");
    try {
      await uploadAvatar(file, user.userId);
      await refreshUser();
      toast.success("Photo updated", { id: toastId });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update photo",
        { id: toastId },
      );
    } finally {
      setPhotoLoading(false);
      e.target.value = "";
    }
  };

  // ── Notifications ─────────────────────────────────────────
  /**
   * Optimistic toggle: flip the UI immediately, persist to localStorage right away (so other
   * tabs pick it up even if Supabase is slow), and debounce the Supabase sync so a flurry of
   * clicks compresses into a single network call. Only surface a toast on error.
   */
  const handleNotificationChange = (key: string, checked: boolean) => {
    setNotifications((prev) => {
      const next: UserNotificationPreferences = { ...prev, [key]: checked };
      try {
        localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      notifPendingPrefsRef.current = next;
      return next;
    });

    if (!user?.userId) {
      // Local-only: show "saved" briefly without spamming a toast.
      setNotifSaveState('saved');
      if (notifSavedTimerRef.current) clearTimeout(notifSavedTimerRef.current);
      notifSavedTimerRef.current = setTimeout(() => setNotifSaveState('idle'), 1200);
      return;
    }

    setNotifSaveState('saving');
    if (notifSyncTimerRef.current) clearTimeout(notifSyncTimerRef.current);
    notifSyncTimerRef.current = setTimeout(async () => {
      const prefsToSave = notifPendingPrefsRef.current;
      if (!prefsToSave || !user?.userId) return;
      const { error } = await supabase
        .from("user_profiles")
        .update({
          notification_preferences: prefsToSave as unknown as Record<string, boolean>,
        })
        .eq("id", user.userId);
      if (error) {
        toast.error(
          "Could not sync preferences to your account. " + error.message,
        );
        setNotifSaveState('idle');
        return;
      }
      invalidateNotificationPreferencesCache(user.userId);
      setNotifSaveState('saved');
      if (notifSavedTimerRef.current) clearTimeout(notifSavedTimerRef.current);
      notifSavedTimerRef.current = setTimeout(() => setNotifSaveState('idle'), 1500);
    }, 350);
  };

  /** Toggle the entire group on or off in one click. */
  const handleNotificationsBulk = (checked: boolean) => {
    const next: UserNotificationPreferences = {
      email: checked,
      push: checked,
      taskAssigned: checked,
      taskCompleted: checked,
      projectUpdates: checked,
      projectChatMessage: checked,
    };
    setNotifications(next);
    try {
      localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    notifPendingPrefsRef.current = next;
    if (!user?.userId) {
      setNotifSaveState('saved');
      if (notifSavedTimerRef.current) clearTimeout(notifSavedTimerRef.current);
      notifSavedTimerRef.current = setTimeout(() => setNotifSaveState('idle'), 1200);
      return;
    }
    setNotifSaveState('saving');
    if (notifSyncTimerRef.current) clearTimeout(notifSyncTimerRef.current);
    notifSyncTimerRef.current = setTimeout(async () => {
      const prefsToSave = notifPendingPrefsRef.current;
      if (!prefsToSave || !user?.userId) return;
      const { error } = await supabase
        .from("user_profiles")
        .update({
          notification_preferences: prefsToSave as unknown as Record<string, boolean>,
        })
        .eq("id", user.userId);
      if (error) {
        toast.error("Could not sync preferences. " + error.message);
        setNotifSaveState('idle');
        return;
      }
      invalidateNotificationPreferencesCache(user.userId);
      setNotifSaveState('saved');
      if (notifSavedTimerRef.current) clearTimeout(notifSavedTimerRef.current);
      notifSavedTimerRef.current = setTimeout(() => setNotifSaveState('idle'), 1500);
    }, 250);
  };

  // ── Password ──────────────────────────────────────────────
  const handleUpdatePassword = async () => {
    if (!newPassword || !confirmPassword) {
      toast.error("Please fill in all fields");
      return;
    }
    if (user?.provider === "google") {
      toast.error("Not available for Google sign-in accounts");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setPasswordLoading(true);
    const toastId = toast.loading("Updating password...");
    try {
      await changePassword(newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password updated successfully", { id: toastId });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update password",
        { id: toastId },
      );
    } finally {
      setPasswordLoading(false);
    }
  };

  // ── Delete Account ────────────────────────────────────────
  const handleDeleteAccount = () => {
    toast(`To delete your account, email ${SUPPORT_EMAIL}`, {
      icon: "📧",
      duration: 6000,
    });
  };

  // ── Handle Cancel at Period End ───────────────────────────
  const handleCancelAtPeriodEnd = async (checked: boolean) => {
    if (!user?.userId) return;

    setCancelLoading(true);
    const toastId = toast.loading(
      checked ? "Turning off auto-renew..." : "Turning on auto-renew...",
    );

    try {
      await setUserCancelAtPeriodEnd(user.userId, checked);
      await refreshSubscription();
      toast.success(
        checked ? "Auto-renew turned off" : "Auto-renew turned on",
        { id: toastId },
      );
    } catch (error) {
      toast.error("Failed to update subscription", { id: toastId });
      console.error("Error updating subscription:", error);
    } finally {
      setCancelLoading(false);
    }
  };

  // ── Cancel subscription immediately (right away) ───────────
  const handleCancelNow = async () => {
    if (!user?.userId) return;
    if (!window.confirm("End your subscription now? You’ll lose access to paid features immediately. You can re-subscribe anytime from Pricing.")) return;

    setCancelNowLoading(true);
    const toastId = toast.loading("Cancelling subscription...");

    try {
      const { data: { session }, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        toast.error("Please sign in again", { id: toastId });
        return;
      }
      const token = session?.access_token;
      if (!token) {
        toast.error("Please sign in again", { id: toastId });
        return;
      }
      const { data, error } = await supabase.functions.invoke("cancel-subscription-now", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) {
        const msg = error.message || "Edge function error";
        throw new Error(msg.includes("401") || msg.includes("Unauthorized") ? "Session expired. Please sign in again." : msg);
      }
      if (data?.error) throw new Error(data.error);
      await refreshSubscription();
      toast.success("Subscription cancelled. You’re now on Starter.", { id: toastId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel", { id: toastId });
    } finally {
      setCancelNowLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground">Settings</h1>
          <p className="text-muted-foreground">Manage your account and preferences</p>
        </div>

        <Tabs
          defaultValue={initialTab}
          onValueChange={(v) => {
            const next = new URLSearchParams(searchParams);
            next.set('tab', v);
            setSearchParams(next, { replace: true });
          }}
          className="space-y-6"
        >
          <TabsList>
            <TabsTrigger value="profile" className="gap-2">
              <User className="w-4 h-4" />
              Profile
            </TabsTrigger>
            <TabsTrigger value="appearance" className="gap-2">
              <Palette className="w-4 h-4" />
              Appearance
            </TabsTrigger>
            <TabsTrigger value="notifications" className="gap-2">
              <Bell className="w-4 h-4" />
              Notifications
            </TabsTrigger>
            <TabsTrigger value="subscription" className="gap-2">
              <CreditCard className="w-4 h-4" />
              Subscription
            </TabsTrigger>
            <TabsTrigger value="security" className="gap-2">
              <Shield className="w-4 h-4" />
              Security
            </TabsTrigger>
            <TabsTrigger value="capacity" className="gap-2">
              <Activity className="w-4 h-4" />
              Capacity
            </TabsTrigger>
          </TabsList>

          {/* APPEARANCE TAB */}
          <TabsContent value="appearance">
            <AppearanceSettings />
          </TabsContent>

          {/* CAPACITY TAB */}
          <TabsContent value="capacity">
            <CapacitySettings />
          </TabsContent>

          {/* PROFILE TAB */}
          <TabsContent value="profile">
            <Card>
              <CardHeader>
                <CardTitle>Profile Information</CardTitle>
                <CardDescription>Update your personal details</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center gap-6">
                  <Avatar className="w-20 h-20">
                    <AvatarImage src={user?.photoURL} />
                    <AvatarFallback className="bg-orange-100 text-orange-700 text-2xl">
                      {user?.displayName?.charAt(0).toUpperCase() || "U"}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleChangePhoto}
                    />
                    <Button
                      variant="outline"
                      onClick={() => photoInputRef.current?.click()}
                      disabled={photoLoading}
                    >
                      {photoLoading ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Camera className="w-4 h-4 mr-2" />
                      )}
                      Change Photo
                    </Button>
                  </div>
                </div>
                <Separator />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>Display Name</Label>
                    <Input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={email}
                      disabled
                      className="bg-muted/50 text-muted-foreground"
                    />
                    <p className="text-xs text-muted-foreground">
                      Email cannot be changed
                    </p>
                  </div>
                </div>
                <Button
                  onClick={handleSaveProfile}
                  disabled={profileLoading}
                  className="bg-gradient-to-r from-orange-500 to-red-500"
                >
                  {profileLoading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4 mr-2" />
                  )}
                  Save Changes
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* NOTIFICATIONS TAB */}
          <TabsContent value="notifications">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle>Notification Preferences</CardTitle>
                  <CardDescription>Choose how you want to be notified</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    aria-live="polite"
                    className={`flex items-center gap-1.5 text-xs transition-opacity duration-200 ${
                      notifSaveState === 'idle'
                        ? 'opacity-0 pointer-events-none'
                        : 'opacity-100'
                    } ${notifSaveState === 'saved' ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}
                  >
                    {notifSaveState === 'saving' ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Saving…
                      </>
                    ) : notifSaveState === 'saved' ? (
                      <>
                        <span className="inline-flex w-1.5 h-1.5 rounded-full bg-green-500" />
                        Saved
                      </>
                    ) : null}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      const allOn = Object.values(notifications).every((v) => v !== false);
                      handleNotificationsBulk(!allOn);
                    }}
                  >
                    {Object.values(notifications).every((v) => v !== false)
                      ? 'Pause all'
                      : 'Enable all'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <section>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Channels
                  </p>
                  <div className="rounded-xl border border-border/70 divide-y divide-border/60 overflow-hidden bg-card">
                    {(
                      [
                        {
                          key: 'email',
                          label: 'Email',
                          desc: 'Receive notifications by email',
                        },
                        {
                          key: 'push',
                          label: 'Browser & desktop push',
                          desc: 'In-app banners and (when enabled) browser push',
                        },
                      ] as const
                    ).map(({ key, label, desc }) => {
                      const value = notifications[key] !== false;
                      return (
                        <div
                          key={key}
                          className={`flex items-center justify-between px-4 py-3 transition-colors ${
                            value ? '' : 'bg-muted/30'
                          }`}
                        >
                          <div className="min-w-0 pr-4">
                            <p className="font-medium text-sm">{label}</p>
                            <p className="text-xs text-muted-foreground">{desc}</p>
                          </div>
                          <Switch
                            checked={value}
                            onCheckedChange={(checked) => handleNotificationChange(key, checked)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    What you get notified about
                  </p>
                  <div className="rounded-xl border border-border/70 divide-y divide-border/60 overflow-hidden bg-card">
                    {(
                      [
                        {
                          key: 'taskAssigned',
                          label: 'Task assignments',
                          desc: 'When a task is assigned to you',
                        },
                        {
                          key: 'taskCompleted',
                          label: 'Task completion',
                          desc: 'When tasks you created are completed',
                        },
                        {
                          key: 'projectUpdates',
                          label: 'Project updates',
                          desc: 'Comments, status changes, mentions',
                        },
                        {
                          key: 'projectChatMessage',
                          label: 'Project chat',
                          desc: 'When someone posts in a project chat you belong to',
                        },
                      ] as const
                    ).map(({ key, label, desc }) => {
                      const value = notifications[key] !== false;
                      return (
                        <div
                          key={key}
                          className={`flex items-center justify-between px-4 py-3 transition-colors ${
                            value ? '' : 'bg-muted/30'
                          }`}
                        >
                          <div className="min-w-0 pr-4">
                            <p className="font-medium text-sm">{label}</p>
                            <p className="text-xs text-muted-foreground">{desc}</p>
                          </div>
                          <Switch
                            checked={value}
                            onCheckedChange={(checked) => handleNotificationChange(key, checked)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </section>

                <p className="text-xs text-muted-foreground">
                  Saved to your account so in-app and email notifications follow these choices.
                  Email still requires your project&apos;s mail service (e.g. EmailJS) to be
                  connected.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* SUBSCRIPTION TAB */}
          <TabsContent value="subscription">
            <Card>
              <CardHeader>
                <CardTitle>Subscription</CardTitle>
                <CardDescription>
                  28-day free trial, then subscribe with Stripe. Email
                  confirmation on purchase and renewal.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="p-4 rounded-lg border border-orange-500/30 bg-gradient-to-br from-orange-500/10 to-card">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-lg text-foreground">
                          {subscription?.status === "trial"
                            ? "Free Trial"
                            : subscription?.tier
                              ? `${subscription.tier.charAt(0).toUpperCase()}${subscription.tier.slice(1)} Plan`
                              : "No Plan"}
                        </p>
                        <Badge className="bg-orange-500/15 text-orange-900 dark:text-orange-200 border border-orange-500/30">
                          {subscription?.status || "Unknown"}
                        </Badge>
                      </div>
                      {trialInfo && (
                        <>
                          <p className="text-sm text-orange-800 dark:text-orange-200/90 mt-1">
                            {trialInfo.daysRemaining} days remaining in your
                            free trial.
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Trial ends:{" "}
                            {trialInfo.trialEndDate.toLocaleDateString()}
                          </p>
                        </>
                      )}
                      {subscription?.status === "active" &&
                        subscription.currentPeriodEnd && (
                          <p className="text-sm text-muted-foreground mt-1">
                            Next billing:{" "}
                            {new Date(
                              subscription.currentPeriodEnd,
                            ).toLocaleDateString()}{" "}
                            ({subscription.billingCycle}). Auto-renews unless
                            cancelled.
                          </p>
                        )}
                    </div>
                    <Button
                      className="bg-gradient-to-r from-orange-500 to-red-500"
                      onClick={() => navigate("/pricing")}
                    >
                      {subscription?.status === "active"
                        ? "Change Plan"
                        : "Upgrade Plan"}
                    </Button>
                  </div>
                </div>

                {subscription?.status === "active" && (
                  <>
                    <div className="flex items-center justify-between p-4 border rounded-lg">
                      <div>
                        <p className="font-medium">Cancel at period end</p>
                        <p className="text-sm text-muted-foreground">
                          Turn off auto-renew. Access continues until period ends.
                        </p>
                      </div>
                      <Switch
                        checked={!!subscription?.cancelAtPeriodEnd}
                        disabled={cancelLoading}
                        onCheckedChange={handleCancelAtPeriodEnd}
                      />
                    </div>
                    <div className="flex items-center justify-between p-4 border rounded-lg border-orange-500/30 bg-orange-500/5">
                      <div>
                        <p className="font-medium">Cancel immediately</p>
                        <p className="text-sm text-muted-foreground">
                          End your subscription now. You lose paid access right away. You can re-subscribe anytime from Pricing.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-orange-300 text-orange-700 hover:bg-orange-100"
                        disabled={cancelNowLoading}
                        onClick={handleCancelNow}
                      >
                        {cancelNowLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          "Cancel now"
                        )}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* SECURITY TAB */}
          <TabsContent value="security">
            <Card>
              <CardHeader>
                <CardTitle>Security Settings</CardTitle>
                <CardDescription>Keep your account secure</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <h3 className="font-medium mb-3">Change Password</h3>
                  {user?.provider === "google" ? (
                    <p className="text-sm text-muted-foreground">
                      Not available for Google sign-in accounts.
                    </p>
                  ) : (
                    <div className="space-y-3 max-w-sm">
                      <div className="space-y-1">
                        <Label>Current Password</Label>
                        <Input
                          type="password"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          placeholder="••••••••"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>New Password</Label>
                        <Input
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="••••••••"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Confirm New Password</Label>
                        <Input
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="••••••••"
                        />
                      </div>
                      <Button
                        variant="outline"
                        onClick={handleUpdatePassword}
                        disabled={passwordLoading}
                      >
                        {passwordLoading && (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        )}
                        Update Password
                      </Button>
                    </div>
                  )}
                </div>

                <Separator />

                <div>
                  <h3 className="font-medium mb-2 text-red-600">Danger Zone</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    To delete your account, contact our support team.
                  </p>
                  <Button variant="destructive" onClick={handleDeleteAccount}>
                    Request Account Deletion
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default Settings;
