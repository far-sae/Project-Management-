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

  const [notifications, setNotifications] = useState({
    email: true,
    push: true,
    taskAssigned: true,
    taskCompleted: true,
    projectUpdates: true,
    projectChatMessage: true,
  });

  useEffect(() => {
    setDisplayName(user?.displayName || "");
  }, [user?.displayName]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(NOTIFICATIONS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, boolean>;
        setNotifications((prev) => ({
          ...prev,
          ...parsed,
          projectChatMessage: parsed.projectChatMessage !== false,
        }));
      }
    } catch {}
  }, []);

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
  const handleNotificationChange = (key: string, checked: boolean) => {
    const next = { ...notifications, [key]: checked };
    setNotifications(next);
    try {
      localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(next));
    } catch {}
    toast.success("Notification preferences saved");
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
    toast("To delete your account, email smtkur31@gmail.com", {
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
                      className="bg-gray-50"
                    />
                    <p className="text-xs text-gray-500">
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
              <CardHeader>
                <CardTitle>Notification Preferences</CardTitle>
                <CardDescription>
                  Choose how you want to be notified
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {(
                  [
                    {
                      key: "email",
                      label: "Email Notifications",
                      desc: "Receive notifications via email",
                    },
                    {
                      key: "push",
                      label: "Push Notifications",
                      desc: "Receive push notifications",
                    },
                    {
                      key: "taskAssigned",
                      label: "Task Assignments",
                      desc: "When a task is assigned to you",
                    },
                    {
                      key: "taskCompleted",
                      label: "Task Completion",
                      desc: "When tasks you created are completed",
                    },
                    {
                      key: "projectUpdates",
                      label: "Project Updates",
                      desc: "Updates about your projects",
                    },
                    {
                      key: "projectChatMessage",
                      label: "Project chat",
                      desc: "When someone posts in a project chat you belong to",
                    },
                  ] as const
                ).map(({ key, label, desc }, i, arr) => (
                  <React.Fragment key={key}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{label}</p>
                        <p className="text-sm text-muted-foreground">{desc}</p>
                      </div>
                      <Switch
                        checked={notifications[key as keyof typeof notifications] !== false}
                        onCheckedChange={(checked) =>
                          handleNotificationChange(key, checked)
                        }
                      />
                    </div>
                    {i < arr.length - 1 && <Separator />}
                  </React.Fragment>
                ))}
                <p className="text-sm text-muted-foreground">
                  Your preferences are saved automatically.
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
                <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-lg">
                          {subscription?.status === "trial"
                            ? "Free Trial"
                            : subscription?.tier
                              ? `${subscription.tier.charAt(0).toUpperCase()}${subscription.tier.slice(1)} Plan`
                              : "No Plan"}
                        </p>
                        <Badge className="bg-orange-100 text-orange-800">
                          {subscription?.status || "Unknown"}
                        </Badge>
                      </div>
                      {trialInfo && (
                        <>
                          <p className="text-sm text-orange-700 mt-1">
                            {trialInfo.daysRemaining} days remaining in your
                            free trial.
                          </p>
                          <p className="text-xs text-gray-600 mt-1">
                            Trial ends:{" "}
                            {trialInfo.trialEndDate.toLocaleDateString()}
                          </p>
                        </>
                      )}
                      {subscription?.status === "active" &&
                        subscription.currentPeriodEnd && (
                          <p className="text-sm text-gray-600 mt-1">
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
                        <p className="text-sm text-gray-500">
                          Turn off auto-renew. Access continues until period ends.
                        </p>
                      </div>
                      <Switch
                        checked={!!subscription?.cancelAtPeriodEnd}
                        disabled={cancelLoading}
                        onCheckedChange={handleCancelAtPeriodEnd}
                      />
                    </div>
                    <div className="flex items-center justify-between p-4 border rounded-lg border-orange-200 bg-orange-50/50">
                      <div>
                        <p className="font-medium">Cancel immediately</p>
                        <p className="text-sm text-gray-500">
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
                    <p className="text-sm text-gray-500">
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
                  <p className="text-sm text-gray-500 mb-3">
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
