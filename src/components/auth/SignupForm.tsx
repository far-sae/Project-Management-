import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/services/supabase/config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card, CardContent, CardDescription,
  CardFooter, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Loader2, Mail, Lock, User, Check, Eye, EyeOff } from 'lucide-react';
import { FcGoogle } from 'react-icons/fc';
import { toast } from 'sonner';

export const SignupForm: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signUp, signInGoogle, loading, error, clearError } = useAuth();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const redirectParam = new URLSearchParams(location.search).get('redirect');

  const getPostAuthRedirect = () => {
    const pendingInviteToken = localStorage.getItem('pendingInviteToken');
    if (redirectParam) return redirectParam;
    if (pendingInviteToken) return `/accept-invite/${pendingInviteToken}`;
    return '/dashboard';
  };

  const loginLink = redirectParam
    ? `/login?redirect=${encodeURIComponent(redirectParam)}`
    : '/login';

  // Show auth context errors
  useEffect(() => {
    if (error) {
      toast.error(error);
      clearError();
    }
  }, [error, clearError]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    const trimmedName = displayName.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName || !trimmedEmail || !password || !confirmPassword) {
      toast.error('Please fill in all fields');
      return;
    }

    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    const toastId = toast.loading('Creating your account...');
    try {
      await signUp(trimmedEmail, password, trimmedName);
      const { data: { session } } = await supabase.auth.getSession();

      if (session) {
        toast.success('Welcome! Your 28-day trial has started 🎉', { id: toastId });
        navigate(getPostAuthRedirect());
      } else {
        toast.success(
          'Account created. Please check your email and confirm your account before signing in.',
          { id: toastId }
        );
        navigate(loginLink);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Sign up failed',
        { id: toastId }
      );
    }
  };

  const handleGoogleSignIn = async () => {
    clearError();
    const toastId = toast.loading('Signing up with Google...');
    try {
      await signInGoogle();
      toast.success('Welcome! Your 28-day trial has started 🎉', { id: toastId });
      navigate(getPostAuthRedirect());
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Google sign-up failed',
        { id: toastId }
      );
    }
  };

  // Blur validation for confirm password
  const handleConfirmPasswordBlur = () => {
    if (confirmPassword && password !== confirmPassword) {
      toast.error('Passwords do not match');
    }
  };

  const isFormEmpty = !displayName || !email || !password || !confirmPassword;

  const trialFeatures = [
    '28 days free trial',
    'No credit card required',
    'Full access to all features',
    'Cancel anytime',
  ];

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border border-border bg-card">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">Create an account</CardTitle>
          <CardDescription className="text-center">
            Start your free 28-day trial today
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border bg-primary/10 p-3">
            <ul className="space-y-1">
              {trialFeatures.map((feature, index) => (
                <li key={index} className="flex items-center text-sm text-muted-foreground">
                  <Check className="mr-2 h-4 w-4 shrink-0 text-primary" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Full Name</Label>
              <div className="relative">
                <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="displayName"
                  type="text"
                  placeholder="John Doe"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="pl-10"
                  disabled={loading}
                  autoComplete="name"
                  aria-required="true"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  disabled={loading}
                  autoComplete="email"
                  aria-required="true"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Create a password (min 8 chars)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10"
                  disabled={loading}
                  autoComplete="new-password"
                  aria-required="true"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-muted-foreground hover:text-foreground focus:outline-none"
                  disabled={loading}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  onBlur={handleConfirmPasswordBlur}
                  className="pl-10 pr-10"
                  disabled={loading}
                  autoComplete="new-password"
                  aria-required="true"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-3 text-muted-foreground hover:text-foreground focus:outline-none"
                  disabled={loading}
                  aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600"
              disabled={loading || isFormEmpty}
            >
              {loading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating account...</>
              ) : (
                'Start free trial'
              )}
            </Button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white px-2 text-gray-500">Or continue with</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleGoogleSignIn}
            disabled={loading}
          >
            <FcGoogle className="mr-2 h-4 w-4" />
            Google
          </Button>
        </CardContent>

        <CardFooter className="flex flex-col space-y-2">
          <div className="text-sm text-center text-muted-foreground">
            Already have an account?{' '}
            <Link to={loginLink} className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  );
};

export default SignupForm;
