
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import Logo from '@/components/Logo';

// supabase.functions.invoke() surfaces any non-2xx response as a generic
// FunctionsHttpError and discards the response body — our functions put the
// real reason in `{ error }` on that body, so read it back from the error's
// `context` (the raw Response) instead of trusting error.message.
async function extractFunctionErrorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: Response })?.context;
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.clone().json();
      if (body?.error) return String(body.error);
    } catch {
      // response body wasn't JSON — fall through to the generic message
    }
  }
  return error instanceof Error ? error.message : 'Please try again.';
}

const freeFeatures = [
  '1 saved profile',
  '5 autofills per month',
  'Limited AI assistance',
  'Chrome extension access',
];

const proFeatures = [
  'Unlimited profiles',
  'Unlimited autofills',
  'Full AI assistance',
  'Priority support',
];

const Pricing = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState<'month' | 'year' | null>(null);

  const handleUpgrade = async (interval: 'month' | 'year') => {
    setLoading(interval);
    try {
      const { data, error } = await supabase.functions.invoke('stripe-checkout', { body: { interval } });
      if (error) throw new Error(await extractFunctionErrorMessage(error));
      if (!data?.url) throw new Error(data?.error || 'Could not start checkout');
      window.location.href = data.url;
    } catch (error) {
      toast({
        title: 'Could not start checkout',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
      setLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Navigation */}
      <nav className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="flex items-center space-x-3">
              <Logo className="w-8 h-8" />
              <span className="text-2xl font-bold text-gray-900">Fyllo</span>
            </Link>
            <div className="flex items-center space-x-4">
              <Link to={user ? '/dashboard' : '/auth'}>
                <Button variant="ghost" className="text-gray-600 hover:text-gray-900">
                  {user ? 'Dashboard' : 'Sign In'}
                </Button>
              </Link>
              {!user && (
                <Link to="/auth">
                  <Button className="bg-brand hover:bg-brand-dark text-white">Get Started</Button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Header */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-5xl font-display text-gray-900 mb-6 leading-tight">
            Simple, honest pricing
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Start free. Upgrade when you're ready to apply without limits.
          </p>
        </div>
      </section>

      {/* Plans */}
      <section className="px-4 sm:px-6 lg:px-8 pb-24">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
          {/* Free */}
          <Card className="p-8 border-0 shadow-lg">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Free</h3>
            <p className="text-gray-500 mb-6">Get started with the essentials</p>
            <div className="mb-6">
              <span className="text-4xl font-display text-gray-900">$0</span>
              <span className="text-gray-500"> / forever</span>
            </div>
            <ul className="space-y-3 mb-8">
              {freeFeatures.map((feature) => (
                <li key={feature} className="flex items-center space-x-3">
                  <Check className="h-5 w-5 text-gray-400 flex-shrink-0" />
                  <span className="text-gray-700">{feature}</span>
                </li>
              ))}
            </ul>
            <Link to={user ? '/dashboard' : '/auth'} className="block">
              <Button variant="outline" className="w-full">
                {user ? 'Go to Dashboard' : 'Get Started Free'}
              </Button>
            </Link>
          </Card>

          {/* Pro */}
          <Card className="p-8 border-2 border-brand shadow-xl relative">
            <Badge className="absolute -top-3 left-8 bg-brand text-white border-0">Most Popular</Badge>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Pro</h3>
            <p className="text-gray-500 mb-6">For active job seekers applying at scale</p>
            <div className="mb-1">
              <span className="text-4xl font-display text-gray-900">$9</span>
              <span className="text-gray-500"> / month</span>
            </div>
            <p className="text-sm text-gray-500 mb-6">or $90/year — save ~17%</p>
            <ul className="space-y-3 mb-8">
              {proFeatures.map((feature) => (
                <li key={feature} className="flex items-center space-x-3">
                  <Check className="h-5 w-5 text-brand flex-shrink-0" />
                  <span className="text-gray-700">{feature}</span>
                </li>
              ))}
            </ul>
            {user ? (
              <div className="flex flex-col gap-3">
                <Button
                  className="w-full bg-brand hover:bg-brand-dark"
                  onClick={() => handleUpgrade('month')}
                  disabled={loading !== null}
                >
                  {loading === 'month' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Upgrade — $9/month
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleUpgrade('year')}
                  disabled={loading !== null}
                >
                  {loading === 'year' && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Upgrade — $90/year
                </Button>
              </div>
            ) : (
              <Link to="/auth" className="block">
                <Button className="w-full bg-brand hover:bg-brand-dark">Start Free, Upgrade Anytime</Button>
              </Link>
            )}
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <Logo className="w-8 h-8" />
              <span className="text-xl font-bold text-gray-900">Fyllo</span>
            </div>
            <div className="flex items-center space-x-6">
              <Link to="/privacy" className="text-gray-500 hover:text-gray-900">Privacy Policy</Link>
              <p className="text-gray-500">© {new Date().getFullYear()} Fyllo. All rights reserved.</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Pricing;
