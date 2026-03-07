import React, { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  CheckCircle,
  XCircle,
  Mail,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import {
  getInvitationByToken,
  declineInvitation,
  acceptInvitation,
} from "@/services/supabase/invitations";
import { ProjectInvitation } from "@/types/invitation";
import { supabase } from "@/services/supabase";
import { toast } from "sonner";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const AcceptInvite: React.FC = () => {
  const { token } = useParams<{ token: string; }>();
  const navigate = useNavigate();
  const { user, signInGoogle } = useAuth();

  const [invitation, setInvitation] = useState<ProjectInvitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const hasAcceptedRef = useRef(false);

  const [showSignupForm, setShowSignupForm] = useState(false);
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signingUp, setSigningUp] = useState(false);
  const [showDeclineDialog, setShowDeclineDialog] = useState(false);

  useEffect(() => {
    if (token) localStorage.setItem("pendingInviteToken", token);
  }, [token]);

  // ✅ True if a different account is logged in than the one invited
  const isEmailMismatch =
    !!user &&
    !!invitation &&
    user.email.toLowerCase().trim() !==
    invitation.inviteeEmail.toLowerCase().trim();

  // ─── Redirect to dashboard when invite is invalid (e.g. first-time login with no invite)
  const redirectToDashboard = useCallback(() => {
    localStorage.removeItem("pendingInviteToken");
    navigate("/dashboard", { replace: true });
  }, [navigate]);

  // ─── Load invitation ───────────────────────────────────────────────────────
  useEffect(() => {
    const loadInvitation = async () => {
      if (!token) {
        setLoading(false);
        redirectToDashboard();
        return;
      }

      let decodedToken = token;
      try {
        decodedToken = decodeURIComponent(token);
      } catch {
        decodedToken = token;
      }

      try {
        const inv = await getInvitationByToken(decodedToken);
        if (!inv) {
          setLoading(false);
          redirectToDashboard();
          return;
        }
        if (inv.status !== "pending") {
          setLoading(false);
          redirectToDashboard();
          return;
        }
        if (new Date(inv.expiresAt) < new Date()) {
          setLoading(false);
          redirectToDashboard();
          return;
        }
        setInvitation(inv);
      } catch (err) {
        console.error("Failed to load invitation:", err);
        setLoading(false);
        redirectToDashboard();
        return;
      } finally {
        setLoading(false);
      }
    };

    loadInvitation();
  }, [token, redirectToDashboard]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleDeclineClick = () => {
    setShowDeclineDialog(true);
  };

  const handleConfirmDecline = async () => {
    if (!invitation) return;
    setProcessing(true);
    setShowDeclineDialog(false);
    try {
      await declineInvitation(
        invitation.invitationId,
        invitation.organizationId || "",
      );
      localStorage.removeItem("pendingInviteToken");
      toast.success("Invitation declined", {
        description: "You can always ask to be invited again later.",
      });
      navigate("/dashboard");
    } catch {
      setError("Failed to decline invitation");
      toast.error("Failed to decline invitation", {
        description: "Please try again or contact support.",
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    localStorage.setItem("pendingInviteToken", token || "");
    navigate(`/login?redirect=/accept-invite/${token}`);
  };

  const handleSignup = async () => {
    if (!signupEmail || !signupPassword || !signupName) return;

    // ✅ Block signup with wrong email
    if (
      invitation &&
      signupEmail.toLowerCase().trim() !==
      invitation.inviteeEmail.toLowerCase().trim()
    ) {
      setError(
        `Please sign up with the invited email: ${invitation.inviteeEmail}`,
      );
      return;
    }

    setSigningUp(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: signupEmail,
        password: signupPassword,
        options: { data: { display_name: signupName } },
      });
      if (error) throw error;
      if (data.user) {
        localStorage.setItem("pendingInviteToken", token || "");
        if (data.session && token) {
          navigate(`/accept-invite/${token}`);
        } else {
          toast.success("Account created. Sign in and we will continue this invite.");
          navigate(`/login?redirect=/accept-invite/${token}`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setSigningUp(false);
    }
  };

  const handleAccept = useCallback(async () => {
    if (!invitation || hasAcceptedRef.current) return;

    // Not logged in → trigger Google sign-in and save token for after redirect
    if (!user) {
      try {
        localStorage.setItem("pendingInviteToken", token || "");
        await signInGoogle();
        return;
      } catch {
        setError("Please sign in to accept the invitation");
        return;
      }
    }

    // ✅ Wrong account logged in → block with clear message
    if (isEmailMismatch) {
      setError(
        `This invitation was sent to ${invitation.inviteeEmail}. ` +
        `You are signed in as ${user.email}. ` +
        `Please sign in with the correct account.`,
      );
      return;
    }

    hasAcceptedRef.current = true;
    setProcessing(true);
    setError(null);

    try {
      const inviteOrgId = invitation.organizationId;
      if (!inviteOrgId) {
        setError("Invalid invitation: missing organization");
        hasAcceptedRef.current = false;
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setError("Session lost. Please sign in again.");
        hasAcceptedRef.current = false;
        return;
      }

      // ✅ userId and userEmail NOT passed — edge function reads from JWT
      await acceptInvitation(
        invitation.invitationId,
        inviteOrgId,
        user.displayName || user.email || "Unknown",
        user.photoURL || "",
      );

      setSuccess(true);
      localStorage.removeItem("pendingInviteToken");
      setTimeout(() => {
        navigate(`/project/${invitation.projectId}`, { replace: true });
      }, 800);
    } catch (err) {
      hasAcceptedRef.current = false;
      setError(
        err instanceof Error ? err.message : "Failed to accept invitation",
      );
    } finally {
      setProcessing(false);
    }
  }, [invitation, user, signInGoogle, isEmailMismatch, token, navigate]);

  // ✅ Auto-accept ONLY when emails match and user just signed in
  useEffect(() => {
    if (
      invitation &&
      user &&
      !processing &&
      !success &&
      !error &&
      !isEmailMismatch &&
      invitation.status === "pending" &&
      !hasAcceptedRef.current
    ) {
      handleAccept();
    }
  }, [user, invitation, isEmailMismatch]);

  // ─── Render: Loading ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center">
            <Loader2 className="w-12 h-12 mx-auto animate-spin text-orange-500" />
            <p className="mt-4 text-gray-600">Loading invitation...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Render: Invalid invitation ────────────────────────────────────────────
  if (error && !invitation) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center">
            <XCircle className="w-16 h-16 mx-auto text-red-500" />
            <h2 className="mt-4 text-xl font-semibold text-gray-900">
              Invalid Invitation
            </h2>
            <p className="mt-2 text-gray-600">{error}</p>
            <Button
              className="mt-6"
              variant="outline"
              onClick={() => navigate("/dashboard")}
            >
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Render: Success ───────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center">
            <CheckCircle className="w-16 h-16 mx-auto text-green-500" />
            <h2 className="mt-4 text-xl font-semibold text-gray-900">
              Welcome to the team!
            </h2>
            <p className="mt-2 text-gray-600">
              You've joined <strong>{invitation?.projectName}</strong>.
              Redirecting...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Render: Main ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-r from-orange-500 to-red-500 flex items-center justify-center">
            <Mail className="w-8 h-8 text-white" />
          </div>
          <CardTitle className="text-2xl">Project Invitation</CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          {invitation && (
            <>
              {/* Invitation summary */}
              <div className="text-center">
                <p className="text-gray-600">
                  <span className="font-semibold">
                    {invitation.inviterName}
                  </span>{" "}
                  has invited you to join
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  {invitation.projectName}
                </p>
              </div>

              {/* Details card */}
              <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Invited email:</span>
                  <span className="font-medium text-orange-600">
                    {invitation.inviteeEmail}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Your role:</span>
                  <span className="font-medium capitalize">
                    {invitation.role}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Invited by:</span>
                  <span className="font-medium">{invitation.inviterEmail}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Expires:
                  </span>
                  <span className="font-medium">
                    {new Date(invitation.expiresAt).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* ✅ Wrong account warning */}
              {isEmailMismatch && (
                <Alert className="bg-yellow-50 border-yellow-200 text-yellow-900">
                  <AlertTriangle className="h-5 w-5 text-yellow-600" />
                  <AlertTitle>Wrong account</AlertTitle>
                  <AlertDescription className="text-yellow-800">
                    This invite was sent to{" "}
                    <strong>{invitation.inviteeEmail}</strong>, but you're
                    signed in as <strong>{user?.email}</strong>.
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 border-yellow-400 text-yellow-800 hover:bg-yellow-100"
                      onClick={handleSignOut}
                    >
                      Switch to correct account
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {/* General error */}
              {error && !isEmailMismatch && (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* Not logged in */}
              {!user ? (
                <>
                  {showSignupForm ? (
                    <div className="space-y-3">
                      <Input
                        placeholder="Your name"
                        value={signupName}
                        onChange={(e) => setSignupName(e.target.value)}
                      />
                      <Input
                        type="email"
                        placeholder="Email address"
                        value={signupEmail}
                        onChange={(e) => setSignupEmail(e.target.value)}
                        className={
                          signupEmail &&
                            signupEmail.toLowerCase() !==
                            invitation.inviteeEmail.toLowerCase()
                            ? "border-red-400"
                            : ""
                        }
                      />
                      {signupEmail &&
                        signupEmail.toLowerCase() !==
                        invitation.inviteeEmail.toLowerCase() && (
                          <p className="text-xs text-red-600">
                            ⚠️ Use the invited email: {invitation.inviteeEmail}
                          </p>
                        )}
                      <Input
                        type="password"
                        placeholder="Create password"
                        value={signupPassword}
                        onChange={(e) => setSignupPassword(e.target.value)}
                      />
                      <Button
                        className="w-full bg-gradient-to-r from-orange-500 to-red-500"
                        onClick={handleSignup}
                        disabled={
                          signingUp ||
                          !signupEmail ||
                          !signupPassword ||
                          !signupName
                        }
                      >
                        {signingUp && (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        )}
                        Create Account & Accept
                      </Button>
                      <Button
                        variant="ghost"
                        className="w-full"
                        onClick={() => setShowSignupForm(false)}
                      >
                        Already have an account? Sign in with Google
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex gap-3">
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={handleDeclineClick}
                          disabled={processing}
                        >
                          Decline
                        </Button>
                        <Button
                          className="flex-1 bg-gradient-to-r from-orange-500 to-red-500"
                          onClick={handleAccept}
                          disabled={processing}
                        >
                          Sign In with Google
                        </Button>
                      </div>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => {
                          setSignupEmail(invitation.inviteeEmail); // ✅ Pre-fill correct email
                          setShowSignupForm(true);
                        }}
                      >
                        New here? Create account with email
                      </Button>
                      <Button
                        variant="ghost"
                        className="w-full"
                        onClick={() => navigate(`/login?redirect=/accept-invite/${token}`)}
                      >
                        Already have account? Sign in with email
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                // ✅ Logged in — Accept disabled if wrong account
                <div className="space-y-2">
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={handleDeclineClick}
                      disabled={processing}
                    >
                      Decline
                    </Button>
                    <Button
                      className="flex-1 bg-gradient-to-r from-orange-500 to-red-500"
                      onClick={handleAccept}
                      disabled={processing || isEmailMismatch}
                      title={
                        isEmailMismatch
                          ? "Sign in with the invited email first"
                          : ""
                      }
                    >
                      {processing ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        "Accept Invitation"
                      )}
                    </Button>
                  </div>
                  {processing && (
                    <p className="text-xs text-gray-500 text-center">
                      Sharing in progress. This can take a few seconds.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Decline Confirmation Dialog */}
      <AlertDialog open={showDeclineDialog} onOpenChange={setShowDeclineDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Decline Invitation?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to decline the invitation to join{" "}
              <strong>{invitation?.projectName}</strong>? You can always ask to be invited again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDecline} className="bg-red-500 hover:bg-red-600">
              Decline
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AcceptInvite;
