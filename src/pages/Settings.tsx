import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useFilloExtension } from '@/hooks/useFilloExtension';
import AppShell from '@/components/fyllo/AppShell';
import { usePlan } from '@/components/fyllo/usePlan';
import '@/components/fyllo/fyllo.css';

const card: React.CSSProperties = { borderRadius: 20, background: '#FFFFFF', border: '1px solid rgba(23,19,33,.08)', padding: 'clamp(22px,3vw,32px)' };
const h2: React.CSSProperties = { margin: 0, fontSize: 18, fontWeight: 500 };
const muted: React.CSSProperties = { fontSize: 14, color: '#6C6577' };
const rowLabel: React.CSSProperties = { fontSize: 15, fontWeight: 500 };
const lbl: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 7 };
const lblText: React.CSSProperties = { fontSize: 13, fontWeight: 500 };

const Settings = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { extensionAvailable } = useFilloExtension();
  const plan = usePlan();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [savingAccount, setSavingAccount] = useState(false);

  const [pwOpen, setPwOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFullName((user.user_metadata?.full_name as string | undefined) ?? '');
    setEmail(user.email ?? '');
  }, [user]);

  // Stripe Checkout redirects back here with ?checkout=success|cancelled.
  useEffect(() => {
    const checkout = new URLSearchParams(window.location.search).get('checkout');
    if (!checkout) return;
    if (checkout === 'success') toast({ title: 'Welcome to Pro!', description: 'Your subscription is active.' });
    else if (checkout === 'cancelled') toast({ title: 'Checkout cancelled', description: 'No changes were made to your plan.' });
    window.history.replaceState({}, '', '/settings');
  }, [toast]);

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
      toast({ title: 'Could not save changes', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
    } finally {
      setSavingAccount(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 8) {
      toast({ title: 'Password too short', description: 'Use at least 8 characters.', variant: 'destructive' });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", description: 'Re-enter the new password in both fields.', variant: 'destructive' });
      return;
    }
    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword('');
      setConfirmPassword('');
      setPwOpen(false);
      toast({ title: 'Password updated' });
    } catch (error) {
      toast({ title: 'Could not update password', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
    } finally {
      setSavingPassword(false);
    }
  };

  const planMeta = plan.usage.cap != null
    ? `${plan.usage.used} of ${plan.usage.cap} autofills used this month · 1 profile`
    : `${plan.usage.used} autofills this month`;
  const proMeta = `Fyllo Pro${plan.currentPeriodEnd ? ` · renews ${new Date(plan.currentPeriodEnd).toLocaleDateString()}` : ''}`;
  const pill = { height: 40, padding: '0 16px', borderRadius: 999, fontSize: 14 } as const;

  return (
    <AppShell plan={plan}>
      {({ openUpgrade, openBilling }) => (
        <main style={{ maxWidth: 820, width: '100%', margin: '0 auto', padding: 'clamp(36px,5vw,64px) 24px 120px', display: 'flex', flexDirection: 'column', gap: 28 }}>
          <h1 className="fy-h1" style={{ margin: '0 0 8px', fontSize: 'clamp(34px,4vw,48px)' }}>Settings</h1>

          {!plan.isPro && (
            <section aria-labelledby="plan-h" style={{ borderRadius: 20, background: '#F5F1FB', padding: '20px clamp(20px,3vw,28px)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px 24px' }}>
              <div style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h2 id="plan-h" style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>Free plan</h2>
                <span style={{ fontSize: 14, color: '#4B0082' }}>{planMeta}</span>
              </div>
              <button type="button" className="fy-btn fy-primary" onClick={openUpgrade} style={{ height: 42, padding: '0 18px', borderRadius: 999, fontSize: 14 }}>See Pro</button>
            </section>
          )}

          <section aria-labelledby="acct-h" style={{ ...card, display: 'flex', flexDirection: 'column', gap: 20 }}>
            <h2 id="acct-h" style={h2}>Account</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '16px 18px' }}>
              <label style={lbl}><span style={lblText}>Full name</span>
                <input className="fy-input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" />
              </label>
              <label style={lbl}><span style={lblText}>Email</span>
                <input className="fy-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </label>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: '#6C6577' }}>Changing your email sends a confirmation link to the new address.</p>
            <div>
              <button type="button" className="fy-btn fy-dark" onClick={handleSaveAccount} disabled={savingAccount || !user} style={{ height: 42, padding: '0 18px', borderRadius: 999, fontSize: 14 }}>
                {savingAccount ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </section>

          <section aria-labelledby="ext-h" style={{ ...card, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px 24px' }}>
            <img src="/icon128.png" alt="" style={{ width: 44, height: 44, borderRadius: 12 }} />
            <div style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <h2 id="ext-h" style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>Chrome extension</h2>
              <span style={muted}>{extensionAvailable ? 'Installed and connected to your account.' : 'Not detected in this browser.'}</span>
            </div>
            {!extensionAvailable && (
              <Link to="/" className="fy-btn fy-dark" style={{ height: 42, padding: '0 18px', borderRadius: 999, fontSize: 14 }}>Add to Chrome</Link>
            )}
          </section>

          <section aria-labelledby="priv-h" style={{ ...card, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <h2 id="priv-h" style={h2}>Privacy &amp; security</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px 24px', paddingTop: 4 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={rowLabel}>Password</span>
                <span style={muted}>At least 8 characters.</span>
              </div>
              <button type="button" className="fy-btn fy-outline" onClick={() => setPwOpen((o) => !o)} aria-expanded={pwOpen} style={pill}>
                {pwOpen ? 'Cancel' : 'Change password'}
              </button>
            </div>
            {pwOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'fyIn .15s ease-out' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '16px 18px' }}>
                  <label style={lbl}><span style={lblText}>New password</span>
                    <input className="fy-input" type="password" autoComplete="new-password" placeholder="At least 8 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                  </label>
                  <label style={lbl}><span style={lblText}>Confirm new password</span>
                    <input className="fy-input" type="password" autoComplete="new-password" placeholder="Re-enter password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                  </label>
                </div>
                <div>
                  <button type="button" className="fy-btn fy-dark" onClick={handleChangePassword} disabled={savingPassword || !newPassword} style={{ height: 42, padding: '0 18px', borderRadius: 999, fontSize: 14 }}>
                    {savingPassword ? 'Updating…' : 'Update password'}
                  </button>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px 24px', paddingTop: 18, borderTop: '1px solid rgba(23,19,33,.06)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 460 }}>
                <span style={rowLabel}>Delete account</span>
                <span style={{ ...muted, lineHeight: 1.5 }}>Permanently removes your account, profiles, résumé files and saved answers.</span>
              </div>
              <button type="button" className="fy-btn fy-outline" disabled title="Coming soon" style={{ ...pill, color: '#B42318', border: '1px solid rgba(180,35,24,.3)' }}>Delete account</button>
            </div>
          </section>

          {plan.isPro && (
            <section aria-labelledby="bill-h" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px 24px', padding: '20px 4px', borderTop: '1px solid rgba(23,19,33,.08)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <h2 id="bill-h" style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>Plan &amp; billing</h2>
                <span style={muted}>{proMeta}</span>
              </div>
              <button type="button" className="fy-btn fy-outline" onClick={openBilling} style={pill}>Manage billing</button>
            </section>
          )}
        </main>
      )}
    </AppShell>
  );
};

export default Settings;
