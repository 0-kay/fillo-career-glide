import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import '@/components/fyllo/fyllo.css';

const AUTH_FIELDS = [
  { k: 'Legal first name', v: 'Alexandra' },
  { k: 'Email address', v: 'alex.chen@gmail.com' },
  { k: 'Require sponsorship?', v: 'No' },
  { k: 'LinkedIn URL', v: 'linkedin.com/in/alexandrachen' },
];

const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 7 };
const labelText: React.CSSProperties = { fontSize: 13, fontWeight: 500 };
const inputStyle: React.CSSProperties = { height: 48, borderRadius: 12, padding: '0 14px' };
const oauthBtn: React.CSSProperties = { height: 48, borderRadius: 12, gap: 10, fontSize: 14 };

const Auth = () => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });

  const { signIn, signUp, resendConfirmation, signInWithOAuth, user } = useAuth();
  const [sentTo, setSentTo] = useState('');
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const { toast } = useToast();
  const navigate = useNavigate();

  // Redirect if already authenticated
  useEffect(() => {
    if (user) {
      navigate('/dashboard');
    }
  }, [user, navigate]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
    if (e.target.name !== 'name') setAuthError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    let err = '';
    if (isSignUp && !formData.name.trim()) err = 'Add your name so we can put it on your applications.';
    else if (!/^\S+@\S+\.\S+$/.test(formData.email)) err = 'That email address doesn’t look right.';
    else if (formData.password.length < (isSignUp ? 8 : 1)) err = isSignUp ? 'Use at least 8 characters for your password.' : 'Enter your password.';
    if (err) {
      setAuthError(err);
      return;
    }

    setAuthError('');
    setLoading(true);

    try {
      if (isSignUp) {
        const { error, needsConfirmation } = await signUp(formData.email, formData.password, formData.name);

        if (error) {
          setAuthError(error.message);
          toast({
            title: "Sign Up Error",
            description: error.message,
            variant: "destructive"
          });
        } else if (needsConfirmation) {
          setSentTo(formData.email);
        }
      } else {
        const { error } = await signIn(formData.email, formData.password);

        if (error) {
          setAuthError(error.message);
          toast({
            title: "Sign In Error",
            description: error.message,
            variant: "destructive"
          });
        } else {
          navigate('/dashboard');
        }
      }
    } catch (error) {
      console.error('Auth error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthLogin = async (provider: 'google' | 'apple') => {
    setAuthError('');
    const { error } = await signInWithOAuth(provider);
    if (error) setAuthError(error.message);
  };

  const handleResend = async () => {
    setResendState('sending');
    const { error } = await resendConfirmation(sentTo);
    if (error) {
      setResendState('idle');
      toast({ title: 'Could not resend', description: error.message, variant: 'destructive' });
    } else {
      setResendState('sent');
    }
  };

  const emailErr = /email/.test(authError);
  const pwErr = /password/i.test(authError);
  const cta = loading ? (isSignUp ? 'Creating account…' : 'Signing in…') : isSignUp ? 'Create account' : 'Sign in';

  return (
    <div className="fy">
      <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,460px),1fr))' }}>
        <div style={{ display: 'flex', flexDirection: 'column', padding: '28px clamp(24px,5vw,64px)' }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#171321', alignSelf: 'flex-start' }}>
            <img src="/fyllo-mark.png" alt="" style={{ width: 30, height: 30 }} />
            <span className="sg" style={{ fontWeight: 600, fontSize: 21, letterSpacing: '-0.02em' }}>Fyllo</span>
          </Link>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 0' }}>
            {sentTo ? (
              <div role="status" style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 22 }}>
                <h1 className="sg" style={{ margin: 0, fontWeight: 500, fontSize: 40, lineHeight: 1.05, letterSpacing: '-0.035em' }}>Check your email</h1>
                <p style={{ margin: 0, fontSize: 16, color: '#6C6577' }}>
                  We sent a confirmation link to <strong style={{ color: '#171321' }}>{sentTo}</strong>. Click it to finish creating your account and land on your dashboard.
                </p>
                <p style={{ margin: 0, fontSize: 14, color: '#6C6577' }}>Nothing there? Check spam, or resend it.</p>
                <button type="button" className="fy-btn fy-outline" disabled={resendState !== 'idle'} onClick={handleResend} style={{ height: 48, borderRadius: 999, fontSize: 15 }}>
                  {resendState === 'sending' ? 'Sending…' : resendState === 'sent' ? 'Sent — check your inbox' : 'Resend email'}
                </button>
                <button type="button" onClick={() => { setSentTo(''); setResendState('idle'); setFormData((f) => ({ ...f, password: '' })); }} style={{ border: 0, background: 'none', padding: 0, fontSize: 14, fontWeight: 500, color: '#4B0082', cursor: 'pointer', alignSelf: 'flex-start' }}>
                  Use a different email
                </button>
              </div>
            ) : (
            <form onSubmit={handleSubmit} noValidate style={{ width: '100%', maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 22 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <h1 className="sg" style={{ margin: 0, fontWeight: 500, fontSize: 40, lineHeight: 1.05, letterSpacing: '-0.035em' }}>
                  {isSignUp ? 'Create your account' : 'Welcome back'}
                </h1>
                <p style={{ margin: 0, fontSize: 16, color: '#6C6577' }}>
                  {isSignUp ? 'Free to start. Takes about five minutes to set up.' : 'Sign in to your profiles and extension.'}
                </p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <button type="button" className="fy-btn fy-outline" style={oauthBtn} onClick={() => handleOAuthLogin('google')} disabled={loading}>
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>Google
                </button>
                <button type="button" className="fy-btn fy-outline" style={oauthBtn} onClick={() => handleOAuthLogin('apple')} disabled={loading}>
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" /></svg>Apple
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 13, color: '#9C97A6' }}>
                <span style={{ flex: 1, height: 1, background: 'rgba(23,19,33,.1)' }} />or with email<span style={{ flex: 1, height: 1, background: 'rgba(23,19,33,.1)' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {isSignUp && (
                  <label style={label}>
                    <span style={labelText}>Full name</span>
                    <input className="fy-input" style={inputStyle} name="name" value={formData.name} onChange={handleInputChange} placeholder="Alexandra Chen" autoComplete="name" disabled={loading} />
                  </label>
                )}
                <label style={label}>
                  <span style={labelText}>Email</span>
                  <input className="fy-input" style={inputStyle} type="email" name="email" value={formData.email} onChange={handleInputChange} placeholder="you@example.com" autoComplete="email" aria-invalid={emailErr} disabled={loading} />
                </label>
                <label style={label}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 500 }}>
                    Password
                    {!isSignUp && <a href="#" onClick={(e) => e.preventDefault()} style={{ fontWeight: 500, color: '#4B0082' }}>Forgot password?</a>}
                  </span>
                  <input className="fy-input" style={inputStyle} type="password" name="password" value={formData.password} onChange={handleInputChange} placeholder={isSignUp ? 'At least 8 characters' : 'Your password'} autoComplete={isSignUp ? 'new-password' : 'current-password'} aria-invalid={pwErr} disabled={loading} />
                </label>
                {authError && (
                  <p role="alert" style={{ margin: 0, padding: '12px 14px', borderRadius: 12, background: '#FEF3F2', color: '#B42318', fontSize: 14 }}>{authError}</p>
                )}
              </div>
              <button type="submit" className="fy-btn fy-primary" disabled={loading} style={{ height: 52, borderRadius: 999, fontSize: 16, gap: 10 }}>
                {loading && <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(255,255,255,.4)', borderTopColor: '#FFFFFF', animation: 'fySpin .7s linear infinite' }} />}
                {cta}
              </button>
              <p style={{ margin: 0, textAlign: 'center', fontSize: 14, color: '#6C6577' }}>
                {isSignUp ? 'Already have an account?' : 'New to Fyllo?'}{' '}
                <button type="button" disabled={loading} onClick={() => { setIsSignUp(!isSignUp); setAuthError(''); }} style={{ border: 0, background: 'none', padding: 0, fontSize: 14, fontWeight: 500, color: '#4B0082', cursor: 'pointer' }}>
                  {isSignUp ? 'Sign in' : 'Create an account'}
                </button>
              </p>
              {isSignUp && (
                <p style={{ margin: 0, textAlign: 'center', fontSize: 12, color: '#6C6577' }}>
                  By creating an account you agree to our Terms of Service and <Link to="/privacy" style={{ textDecoration: 'underline' }}>Privacy Policy</Link>.
                </p>
              )}
            </form>
            )}
          </div>
        </div>
        <div style={{ background: '#171321', color: '#FCFBFE', padding: 'clamp(32px,6vw,80px)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 40, minHeight: 560 }}>
          <h2 className="sg" style={{ margin: 0, maxWidth: 440, fontWeight: 500, fontSize: 'clamp(30px,3.2vw,44px)', lineHeight: 1.05, letterSpacing: '-0.035em' }}>
            Set up once. Every application after that takes seconds.
          </h2>
          <div style={{ maxWidth: 420, borderRadius: 20, background: '#FFFFFF', color: '#171321', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {AUTH_FIELDS.map((f) => (
              <div key={f.k} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, color: '#6C6577' }}>{f.k}</span>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 40, padding: '0 12px', borderRadius: 10, border: '1px solid rgba(138,43,226,.38)', background: '#F7F2FD', fontSize: 14 }}>
                  {f.v}
                  <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: '50%', background: '#8A2BE2', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  </span>
                </span>
              </div>
            ))}
          </div>
          <p style={{ margin: 0, fontSize: 14, color: '#BEB6CB', maxWidth: 420 }}>Nothing is filled until you click Fill. Your data is never sold.</p>
        </div>
      </div>
    </div>
  );
};

export default Auth;
