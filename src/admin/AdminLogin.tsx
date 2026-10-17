import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { adminGet, AdminApiError, type Me } from './adminApi';
import { verifyTotp } from './StepUp';

type Stage = 'loading' | 'credentials' | 'denied' | 'enroll' | 'verify' | 'ready' | 'error';

/** Password sign-in, then TOTP enrolment (first time) or verification. The API refuses every
 * data request below aal2, so this screen is a convenience, not the security boundary. */
export default function AdminLogin() {
  const { user, loading, signIn, signOut } = useAuth();
  const [stage, setStage] = useState<Stage>('loading');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<{ factorId: string; svg: string; secret: string } | null>(null);

  const check = useCallback(async () => {
    try {
      const me = await adminGet<Me>('/me');
      if (me.mfa.verified) return setStage('ready');
      const { data } = await supabase.auth.mfa.listFactors();
      setStage(data?.totp.length ? 'verify' : 'enroll');
    } catch (e) {
      if (e instanceof AdminApiError && (e.status === 403 || e.status === 401)) setStage('denied');
      else {
        setError(e instanceof Error ? e.message : 'Could not load your admin account.');
        setStage('error');
      }
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) setStage('credentials');
    else check();
  }, [user, loading, check]);

  useEffect(() => {
    if (stage !== 'enroll' || qr) return;
    (async () => {
      // Clear any half-finished enrolment from an earlier attempt so we always get a fresh QR.
      const { data: factors } = await supabase.auth.mfa.listFactors();
      for (const f of factors?.all ?? []) if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Fyllo admin' });
      if (err || !data) return setError(err?.message ?? 'Could not start authenticator setup.');
      setQr({ factorId: data.id, svg: data.totp.qr_code, secret: data.totp.secret });
    })();
  }, [stage, qr]);

  const submitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error: err } = await signIn(email.trim(), password);
    setBusy(false);
    if (err) setError('Email or password is incorrect.');
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (stage === 'enroll' && qr) {
        const { data: ch, error: cErr } = await supabase.auth.mfa.challenge({ factorId: qr.factorId });
        if (cErr) throw cErr;
        const { error: vErr } = await supabase.auth.mfa.verify({ factorId: qr.factorId, challengeId: ch.id, code: code.trim() });
        if (vErr) throw vErr;
      } else {
        await verifyTotp(code.trim());
      }
      setStage('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code was not accepted.');
    } finally {
      setBusy(false);
    }
  };

  if (stage === 'ready') return <Navigate to="/admin" replace />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold">Fyllo admin</h1>
        <p className="mt-1 text-sm text-slate-500">Restricted. Sign-in is logged.</p>

        {stage === 'loading' && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

        {stage === 'credentials' && (
          <form onSubmit={submitCredentials} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>Continue</Button>
          </form>
        )}

        {stage === 'denied' && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-slate-700">This account does not have admin access.</p>
            <Button variant="outline" className="w-full" onClick={() => signOut()}>Sign out</Button>
          </div>
        )}

        {stage === 'error' && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-red-600" role="alert">{error}</p>
            <Button variant="outline" className="w-full" onClick={() => { setError(''); setStage('loading'); check(); }}>Try again</Button>
          </div>
        )}

        {(stage === 'enroll' || stage === 'verify') && (
          <form onSubmit={submitCode} className="mt-6 space-y-4">
            {stage === 'enroll' ? (
              <>
                <p className="text-sm text-slate-700">
                  Multi-factor authentication is required. Scan this code with an authenticator app, then enter the 6-digit code.
                </p>
                {qr ? (
                  <div className="space-y-2">
                    <img src={qr.svg} alt="Authenticator QR code" className="mx-auto h-44 w-44" />
                    <p className="break-all text-center font-mono text-xs text-slate-500">{qr.secret}</p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">Preparing…</p>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-700">Enter the 6-digit code from your authenticator app.</p>
            )}
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              aria-label="Authenticator code"
            />
            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6 || (stage === 'enroll' && !qr)}>
              Verify
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => signOut()}>Sign out</Button>
          </form>
        )}
      </div>
    </div>
  );
}
