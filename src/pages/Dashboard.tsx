import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useProfiles } from '@/hooks/useProfiles';
import { useFilloExtension } from '@/hooks/useFilloExtension';
import Onboarding from '@/components/Onboarding';
import ProfileList from '@/components/ProfileList';
import AppShell from '@/components/fyllo/AppShell';
import MissedFields from '@/components/fyllo/MissedFields';
import { UsageDots } from '@/components/fyllo/PlanModals';
import '@/components/fyllo/fyllo.css';

// TODO: swap for the real Chrome Web Store listing URL once published.
const CHROME_STORE_URL = 'https://chromewebstore.google.com/';

const Dashboard = () => {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const { user, loading: authLoading } = useAuth();
  const { profiles, loading } = useProfiles();
  const { extensionAvailable } = useFilloExtension();
  const navigate = useNavigate();

  useEffect(() => {
    // Wait for the session to load (e.g. reading it from the OAuth redirect) before deciding.
    if (authLoading) return;

    // Redirect to auth if not logged in
    if (!user) {
      navigate('/auth');
      return;
    }

    // Show onboarding if no profiles exist
    const onboardingComplete = localStorage.getItem('fillo_onboarding_complete');
    if (!onboardingComplete && profiles.length === 0 && !loading) {
      setShowOnboarding(true);
    }
  }, [user, authLoading, profiles.length, loading, navigate]);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    localStorage.setItem('fillo_onboarding_complete', 'true');
  };

  if (authLoading || !user) {
    return null; // Still loading the session, or redirecting to auth
  }

  if (showOnboarding) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  const meta = user.user_metadata as Record<string, string> | undefined;
  const fullName = meta?.full_name || meta?.name || '';
  const emailName = user.email ? user.email.split('@')[0] : '';
  const firstName = (fullName.split(' ')[0] || emailName.charAt(0).toUpperCase() + emailName.slice(1)).trim();
  const hr = new Date().getHours();
  const tod = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';

  const readyProfiles = profiles.filter(p => p.completeness >= 75);
  const profileName = (p: (typeof profiles)[number]) =>
    ((p.resume_metadata as Record<string, string>)?.profile_name) || [p.first_name, p.last_name].filter(Boolean).join(' ');
  const sub = profiles.length === 0
    ? "Let's build your first profile. Upload a résumé to get started."
    : readyProfiles.length === 0
      ? 'Your profile needs a little more detail before Fyllo can fill with it.'
      : extensionAvailable
        ? `Your ${profileName(readyProfiles[0]) || 'first'} profile is ready to fill.`
        : 'Your profile is ready. Add the extension to start filling.';

  // Screening answers summary (from the most recently updated profile)
  const answers: any[] = ((profiles[0]?.job_preferences as any)?.screening_answers || []).filter((a: any) => a?.enabled !== false);
  const answered = answers.filter(a => String(a.answer ?? '').trim() !== '').length;
  const blank = answers.length - answered;
  const answeredPct = answers.length ? Math.round((answered / answers.length) * 100) : 0;

  return (
    <AppShell>
      {({ openUpgrade, plan }) => (
        <main data-screen-label="Dashboard" style={{ maxWidth: 1200, width: '100%', margin: '0 auto', padding: 'clamp(36px,5vw,64px) 24px 120px', display: 'flex', flexDirection: 'column', gap: 'clamp(40px,5vw,56px)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'end', gap: '20px 40px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h1 className="fy-h1" style={{ fontSize: 'clamp(34px,4vw,52px)' }}>{tod}{firstName ? `, ${firstName}` : ''}.</h1>
              <p style={{ margin: 0, fontSize: 17, color: '#6C6577' }}>{sub}</p>
            </div>
            {extensionAvailable && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 40, padding: '0 16px', borderRadius: 999, background: '#fff', border: '1px solid rgba(23,19,33,.08)', fontSize: 14, whiteSpace: 'nowrap', flex: 'none' }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: '#8A2BE2' }} />Extension connected
              </div>
            )}
          </div>

          {!extensionAvailable && profiles.length > 0 && (
            <div style={{ borderRadius: 24, background: '#171321', color: '#FCFBFE', padding: 'clamp(24px,4vw,40px)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '24px 40px' }}>
              <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <h2 className="sg" style={{ margin: 0, fontWeight: 500, fontSize: 28, letterSpacing: '-0.03em' }}>One step left: add the extension.</h2>
                <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: '#BEB6CB' }}>Your profile is ready. The extension is what fills applications — it connects to this account automatically.</p>
              </div>
              <a href={CHROME_STORE_URL} target="_blank" rel="noreferrer" className="fy-btn fy-primary" style={{ height: 50, padding: '0 24px', borderRadius: 999, fontSize: 15, color: '#fff' }}>Add to Chrome</a>
            </div>
          )}

          <ProfileList isPro={plan.isPro} onUpgrade={openUpgrade} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: 24, alignItems: 'start' }}>
            <MissedFields />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {profiles.length > 0 && (
                <section aria-labelledby="ans-h" className="fy-card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                    <h2 id="ans-h" style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>Screening answers</h2>
                    <span style={{ fontSize: 13, color: '#6C6577' }}>{answers.length ? `${answered} of ${answers.length} answered` : 'Not started'}</span>
                  </div>
                  <div className="fy-bar"><div style={{ width: `${answeredPct}%` }} /></div>
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: '#6C6577' }}>
                    {answers.length === 0
                      ? 'Answer the common screening questions once and Fyllo will reuse them on every application.'
                      : blank > 0
                        ? `${blank} question${blank === 1 ? ' is' : 's are'} still blank — Fyllo will leave ${blank === 1 ? 'it' : 'those'} for you.`
                        : 'Everything is answered. Fyllo can fill these for you.'}
                  </p>
                  {blank > 0 || answers.length === 0 ? (
                    <button type="button" className="fy-btn fy-outline" onClick={() => navigate(`/profile/edit/${profiles[0].id}`)} style={{ alignSelf: 'flex-start', height: 38, padding: '0 16px', borderRadius: 999, fontSize: 14 }}>Finish answers</button>
                  ) : null}
                </section>
              )}
              {!plan.isPro && (
                <section aria-labelledby="use-h" style={{ borderRadius: 20, background: '#F5F1FB', padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                    <h2 id="use-h" style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>Free plan</h2>
                    <span style={{ fontSize: 13, color: '#4B0082' }}>{plan.usage.used} of {plan.usage.cap ?? 5} autofills used</span>
                  </div>
                  <UsageDots used={plan.usage.used} cap={plan.usage.cap} />
                  <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: '#4B0082' }}>Pro is $9 a month for unlimited autofills and profiles.</p>
                  <button type="button" className="fy-btn fy-primary" onClick={openUpgrade} style={{ alignSelf: 'flex-start', height: 40, padding: '0 18px', borderRadius: 999, fontSize: 14 }}>Upgrade to Pro</button>
                </section>
              )}
            </div>
          </div>
        </main>
      )}
    </AppShell>
  );
};

export default Dashboard;
