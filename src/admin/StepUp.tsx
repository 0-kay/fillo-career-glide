import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AdminApiError } from './adminApi';

type Runner = <T>(fn: () => Promise<T>) => Promise<T>;
const StepUpContext = createContext<Runner | null>(null);

/** Re-verifies the signed-in admin's authenticator code. */
export async function verifyTotp(code: string): Promise<void> {
  const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors();
  if (fErr) throw fErr;
  const factor = factors.totp[0];
  if (!factor) throw new Error('No authenticator is enrolled for this account.');
  const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId: factor.id });
  if (cErr) throw cErr;
  const { error } = await supabase.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code });
  if (error) throw error;
}

/**
 * Wraps sensitive calls: if the API answers "re-enter your authenticator code", the dialog asks
 * for one, verifies it (which refreshes the session's MFA timestamp) and retries the call.
 */
export function StepUpProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ resolve: () => void; reject: (e: unknown) => void } | null>(null);

  const ask = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        pending.current = { resolve, reject };
        setCode('');
        setError('');
        setOpen(true);
      }),
    [],
  );

  const run: Runner = useCallback(
    async (fn) => {
      try {
        return await fn();
      } catch (e) {
        if (e instanceof AdminApiError && e.code === 'mfa_recent_required') {
          await ask();
          return fn();
        }
        throw e;
      }
    },
    [ask],
  );

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await verifyTotp(code.trim());
      setOpen(false);
      pending.current?.resolve();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code was not accepted.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setOpen(false);
    pending.current?.reject(new Error('Cancelled'));
  };

  return (
    <StepUpContext.Provider value={run}>
      {children}
      <Dialog open={open} onOpenChange={(o) => !o && cancel()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm it's you</DialogTitle>
            <DialogDescription>
              This action needs a fresh code from your authenticator app.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && submit()}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={cancel}>Cancel</Button>
            <Button onClick={submit} disabled={busy || code.length !== 6}>Verify</Button>
          </div>
        </DialogContent>
      </Dialog>
    </StepUpContext.Provider>
  );
}

export function useStepUp(): Runner {
  const ctx = useContext(StepUpContext);
  if (!ctx) throw new Error('useStepUp must be used inside StepUpProvider');
  return ctx;
}
