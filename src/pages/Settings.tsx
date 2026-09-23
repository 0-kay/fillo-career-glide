
import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ArrowLeft, User, Bell, Shield, Chrome, Loader2, CreditCard } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import Logo from '@/components/Logo';

const Settings = () => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [savingAccount, setSavingAccount] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [plan, setPlan] = useState<'free' | 'pro'>('free');
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ used: number; cap: number | null }>({ used: 0, cap: 5 });
  const [billingLoading, setBillingLoading] = useState<'month' | 'year' | 'portal' | null>(null);

  useEffect(() => {
    if (!user) return;
    setFullName((user.user_metadata?.full_name as string | undefined) ?? '');
    setEmail(user.email ?? '');
  }, [user]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [{ data: profileRow }, { data: usageRow }] = await Promise.all([
        supabase.from('profiles').select('plan, current_period_end').eq('id', user.id).single(),
        supabase.rpc('get_fill_usage').single(),
      ]);
      if (profileRow) {
        setPlan(profileRow.plan === 'pro' ? 'pro' : 'free');
        setCurrentPeriodEnd(profileRow.current_period_end);
      }
      if (usageRow) setUsage({ used: usageRow.used ?? 0, cap: usageRow.cap ?? null });
    })();
  }, [user]);

  // Stripe Checkout redirects back here with ?checkout=success|cancelled.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    if (!checkout) return;
    if (checkout === 'success') {
      toast({ title: 'Welcome to Pro!', description: 'Your subscription is active.' });
    } else if (checkout === 'cancelled') {
      toast({ title: 'Checkout cancelled', description: 'No changes were made to your plan.' });
    }
    window.history.replaceState({}, '', '/settings');
  }, [toast]);

  const handleUpgrade = async (interval: 'month' | 'year') => {
    setBillingLoading(interval);
    try {
      const { data, error } = await supabase.functions.invoke('stripe-checkout', { body: { interval } });
      if (error) throw error;
      if (!data?.url) throw new Error(data?.error || 'Could not start checkout');
      window.location.href = data.url;
    } catch (error) {
      toast({
        title: 'Could not start checkout',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
      setBillingLoading(null);
    }
  };

  const handleManageBilling = async () => {
    setBillingLoading('portal');
    try {
      const { data, error } = await supabase.functions.invoke('stripe-portal');
      if (error) throw error;
      if (!data?.url) throw new Error(data?.error || 'Could not open billing portal');
      window.location.href = data.url;
    } catch (error) {
      toast({
        title: 'Could not open billing portal',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
      setBillingLoading(null);
    }
  };

  const handleSaveAccount = async () => {
    if (!user) return;
    setSavingAccount(true);
    try {
      const emailChanged = email.trim() !== '' && email.trim() !== user.email;
      const { error } = await supabase.auth.updateUser({
        ...(emailChanged ? { email: email.trim() } : {}),
        data: { full_name: fullName.trim() },
      });
      if (error) throw error;
      toast({
        title: 'Account updated',
        description: emailChanged
          ? 'Your name was saved. Check your new email address for a link to confirm the change.'
          : 'Your name was saved.',
      });
    } catch (error) {
      toast({
        title: 'Could not save changes',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSavingAccount(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 8) {
      toast({
        title: 'Password too short',
        description: 'Use at least 8 characters.',
        variant: 'destructive',
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({
        title: "Passwords don't match",
        description: 'Re-enter the new password in both fields.',
        variant: 'destructive',
      });
      return;
    }
    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword('');
      setConfirmPassword('');
      toast({ title: 'Password updated' });
    } catch (error) {
      toast({
        title: 'Could not update password',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <Link to="/dashboard">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Dashboard
                </Button>
              </Link>
            </div>
            <div className="flex items-center space-x-3">
              <Logo className="w-8 h-8" />
              <span className="text-2xl font-bold text-gray-900">Fyllo</span>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Settings</h1>
          <p className="text-gray-600">Manage your account preferences and extension settings.</p>
        </div>

        <div className="space-y-6">
          {/* Account Settings */}
          <Card className="p-6">
            <div className="flex items-center space-x-3 mb-6">
              <User className="h-5 w-5 text-brand" />
              <h3 className="text-lg font-semibold text-gray-900">Account Settings</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  placeholder="John Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="john@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-6">
              <Button
                className="bg-brand hover:bg-brand-dark"
                onClick={handleSaveAccount}
                disabled={savingAccount || !user}
              >
                {savingAccount && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </div>
          </Card>

          {/* Billing & Plan */}
          <Card className="p-6">
            <div className="flex items-center space-x-3 mb-6">
              <CreditCard className="h-5 w-5 text-brand" />
              <h3 className="text-lg font-semibold text-gray-900">Billing & Plan</h3>
              <span
                className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                  plan === 'pro' ? 'bg-brand/10 text-brand-dark' : 'bg-gray-100 text-gray-600'
                }`}
              >
                {plan === 'pro' ? 'Pro' : 'Free'}
              </span>
            </div>

            {plan === 'pro' ? (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  You're on the Pro plan
                  {currentPeriodEnd ? ` — renews ${new Date(currentPeriodEnd).toLocaleDateString()}` : ''}.
                  Unlimited profiles, unlimited autofills, full AI assistance.
                </p>
                <Button variant="outline" onClick={handleManageBilling} disabled={billingLoading === 'portal'}>
                  {billingLoading === 'portal' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Manage Billing
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-600 mb-1">
                    {usage.cap != null
                      ? `${usage.used} of ${usage.cap} autofills used this month`
                      : `${usage.used} autofills this month`}
                  </p>
                  {usage.cap != null && (
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand"
                        style={{ width: `${Math.min(100, (usage.used / usage.cap) * 100)}%` }}
                      />
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mt-2">
                    Free plan: 1 profile, 5 autofills/month, limited AI assistance.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    className="bg-brand hover:bg-brand-dark"
                    onClick={() => handleUpgrade('month')}
                    disabled={billingLoading !== null}
                  >
                    {billingLoading === 'month' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Upgrade — $9/month
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleUpgrade('year')}
                    disabled={billingLoading !== null}
                  >
                    {billingLoading === 'year' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Upgrade — $90/year
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* Notification Settings */}
          <Card className="p-6">
            <div className="flex items-center space-x-3 mb-6">
              <Bell className="h-5 w-5 text-brand" />
              <h3 className="text-lg font-semibold text-gray-900">Notifications</h3>
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Coming soon</span>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Extension Updates</p>
                  <p className="text-sm text-gray-600">Get notified when new features are available</p>
                </div>
                <Switch disabled />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Application Tips</p>
                  <p className="text-sm text-gray-600">Receive helpful tips for job applications</p>
                </div>
                <Switch disabled />
              </div>
            </div>
          </Card>

          {/* Extension Settings */}
          <Card className="p-6">
            <div className="flex items-center space-x-3 mb-6">
              <Chrome className="h-5 w-5 text-brand" />
              <h3 className="text-lg font-semibold text-gray-900">Extension Settings</h3>
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Coming soon</span>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Auto-fill on page load</p>
                  <p className="text-sm text-gray-600">Automatically suggest profile when forms are detected</p>
                </div>
                <Switch disabled />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Show success notifications</p>
                  <p className="text-sm text-gray-600">Display notifications when forms are filled successfully</p>
                </div>
                <Switch disabled />
              </div>
            </div>
          </Card>

          {/* Privacy & Security */}
          <Card className="p-6">
            <div className="flex items-center space-x-3 mb-6">
              <Shield className="h-5 w-5 text-brand" />
              <h3 className="text-lg font-semibold text-gray-900">Privacy & Security</h3>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="new-password">New Password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="At least 8 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="confirm-password">Confirm New Password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="Re-enter password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
              </div>
              <Button
                variant="outline"
                onClick={handleChangePassword}
                disabled={savingPassword || !newPassword}
              >
                {savingPassword && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Change Password
              </Button>

              <div className="pt-2 border-t space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-600">Export a copy of your account data</p>
                  <Button variant="outline" disabled title="Coming soon">
                    Download My Data
                  </Button>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-600">Permanently delete your account and all profiles</p>
                  <Button variant="destructive" disabled title="Coming soon">
                    Delete Account
                  </Button>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Settings;
