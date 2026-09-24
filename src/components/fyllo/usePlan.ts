import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

// supabase.functions.invoke() hides the response body on non-2xx; our functions put the
// real reason in `{ error }`, so read it back from the error's `context` (raw Response).
export async function extractFunctionErrorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: Response })?.context;
  if (context && typeof context.json === 'function') {
    try {
      const body = await context.clone().json();
      if (body?.error) return String(body.error);
    } catch {
      // not JSON — fall through
    }
  }
  return error instanceof Error ? error.message : 'Please try again.';
}

export type Interval = 'month' | 'year';

/** Plan, monthly autofill usage and Stripe checkout/portal actions for the signed-in user. */
export function usePlan() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [plan, setPlan] = useState<'free' | 'pro'>('free');
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ used: number; cap: number | null }>({ used: 0, cap: 5 });
  const [billingLoading, setBillingLoading] = useState<Interval | 'portal' | null>(null);

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

  const upgrade = useCallback(async (interval: Interval) => {
    setBillingLoading(interval);
    try {
      const { data, error } = await supabase.functions.invoke('stripe-checkout', { body: { interval } });
      if (error) throw new Error(await extractFunctionErrorMessage(error));
      if (!data?.url) throw new Error(data?.error || 'Could not start checkout');
      window.location.href = data.url;
    } catch (error) {
      toast({ title: 'Could not start checkout', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
      setBillingLoading(null);
    }
  }, [toast]);

  const openPortal = useCallback(async () => {
    setBillingLoading('portal');
    try {
      const { data, error } = await supabase.functions.invoke('stripe-portal');
      if (error) throw new Error(await extractFunctionErrorMessage(error));
      if (!data?.url) throw new Error(data?.error || 'Could not open billing portal');
      window.location.href = data.url;
    } catch (error) {
      toast({ title: 'Could not open billing portal', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
      setBillingLoading(null);
    }
  }, [toast]);

  return { plan, isPro: plan === 'pro', currentPeriodEnd, usage, billingLoading, upgrade, openPortal };
}
