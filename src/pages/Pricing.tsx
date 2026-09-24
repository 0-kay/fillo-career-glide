
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { extractFunctionErrorMessage } from '@/components/fyllo/usePlan';
import '@/components/fyllo/fyllo.css';

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

  const card = { borderRadius: 20, background: '#fff', border: '1px solid rgba(23,19,33,.08)', padding: 'clamp(24px,3vw,36px)', display: 'flex', flexDirection: 'column' as const };
  const btn = { height: 46, padding: '0 20px', borderRadius: 999, fontSize: 15, width: '100%' };
  const list = (items: string[], c: string) => (
    <ul style={{ listStyle: 'none', margin: '24px 0 28px', padding: 0, display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
      {items.map((f) => (
        <li key={f} style={{ display: 'flex', gap: 10, fontSize: 15, alignItems: 'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          {f}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="fy">
      <header style={{ position: 'sticky', top: 0, zIndex: 40, background: 'rgba(252,251,254,.9)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(23,19,33,.07)' }}>
        <nav style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/fyllo-mark.png" alt="" style={{ width: 28, height: 28 }} />
            <span className="sg" style={{ fontWeight: 600, fontSize: 19, letterSpacing: '-0.02em' }}>Fyllo</span>
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link to={user ? '/dashboard' : '/auth'} className="fy-btn fy-ghost" style={{ height: 40, padding: '0 16px', borderRadius: 999, fontSize: 14 }}>{user ? 'Dashboard' : 'Sign in'}</Link>
            {!user && <Link to="/auth" className="fy-btn fy-primary" style={{ height: 40, padding: '0 18px', borderRadius: 999, fontSize: 14 }}>Get started</Link>}
          </div>
        </nav>
      </header>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: 'clamp(48px,7vw,96px) 24px 120px' }}>
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <h1 className="fy-h1" style={{ fontSize: 'clamp(38px,5vw,60px)', marginBottom: 16 }}>Simple, honest pricing</h1>
          <p style={{ margin: '0 auto', maxWidth: 520, fontSize: 18, lineHeight: 1.5, color: '#6C6577' }}>Start free. Upgrade when you're ready to apply without limits.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 24, alignItems: 'stretch' }}>
          <section style={card}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>Free</h2>
            <p style={{ margin: '4px 0 20px', fontSize: 14, color: '#6C6577' }}>Get started with the essentials</p>
            <div><span className="sg" style={{ fontSize: 44, fontWeight: 500, letterSpacing: '-0.03em' }}>$0</span><span style={{ color: '#6C6577' }}> / forever</span></div>
            {list(freeFeatures, '#9C97A6')}
            <Link to={user ? '/dashboard' : '/auth'} className="fy-btn fy-outline" style={btn}>{user ? 'Go to Dashboard' : 'Get started free'}</Link>
          </section>
          <section style={{ ...card, background: '#F5F1FB', border: '2px solid #8A2BE2', position: 'relative' }}>
            <span style={{ position: 'absolute', top: -13, left: 28, height: 26, padding: '0 12px', borderRadius: 999, background: '#8A2BE2', color: '#fff', fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center' }}>Most popular</span>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>Pro</h2>
            <p style={{ margin: '4px 0 20px', fontSize: 14, color: '#4B0082' }}>For active job seekers applying at scale</p>
            <div><span className="sg" style={{ fontSize: 44, fontWeight: 500, letterSpacing: '-0.03em' }}>$9</span><span style={{ color: '#6C6577' }}> / month</span></div>
            <p style={{ margin: '4px 0 0', fontSize: 14, color: '#6C6577' }}>or $90/year — save ~17%</p>
            {list(proFeatures, '#8A2BE2')}
            {user ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button type="button" className="fy-btn fy-primary" style={btn} onClick={() => handleUpgrade('month')} disabled={loading !== null}>{loading === 'month' ? 'Redirecting…' : 'Upgrade — $9/month'}</button>
                <button type="button" className="fy-btn fy-outline" style={btn} onClick={() => handleUpgrade('year')} disabled={loading !== null}>{loading === 'year' ? 'Redirecting…' : 'Upgrade — $90/year'}</button>
              </div>
            ) : (
              <Link to="/auth" className="fy-btn fy-primary" style={btn}>Start free, upgrade anytime</Link>
            )}
          </section>
        </div>
      </main>

      <footer style={{ borderTop: '1px solid rgba(23,19,33,.07)', padding: '28px 24px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, fontSize: 14, color: '#6C6577' }}>
          <span className="sg" style={{ fontWeight: 600, fontSize: 16, color: '#171321' }}>Fyllo</span>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <Link to="/privacy">Privacy Policy</Link>
            <span>© {new Date().getFullYear()} Fyllo. All rights reserved.</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Pricing;
