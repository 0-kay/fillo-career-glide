import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { adminGet, adminPost } from './adminApi';
import { useStepUp } from './StepUp';
import { ErrorNote } from './ui';

type Action = 'grant' | 'suspend' | 'revoke' | 'reinstate' | 'plan';

interface Job {
  job: { id: string; status: 'queued' | 'running' | 'done' | 'failed'; total: number; succeeded: number; failed: number };
  items: Array<{ user_id: string; status: string; error: string | null }>;
}

export interface BulkTarget {
  /** Explicit user ids, or a filter describing the segment. */
  ids?: string[];
  filter?: Record<string, string>;
  label: string;
}

/** Preview ("this will affect N users") -> confirm -> async run with live progress and a
 * per-user result list. */
export default function BulkDialog({ open, onOpenChange, target, onFinished }: {
  open: boolean; onOpenChange: (o: boolean) => void; target: BulkTarget; onFinished?: () => void;
}) {
  const stepUp = useStepUp();
  const [action, setAction] = useState<Action>('grant');
  const [amount, setAmount] = useState('10');
  const [expires, setExpires] = useState('');
  const [plan, setPlan] = useState('BETA');
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [preview, setPreview] = useState<{ will_affect: number; skipped_admins: number } | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number>();

  useEffect(() => () => window.clearInterval(timer.current), []);
  useEffect(() => {
    if (open) { setPreview(null); setJob(null); setError(null); setTyped(''); }
  }, [open, action]);

  const body = (dryRun: boolean) => ({
    action,
    reason: reason.trim(),
    ...(target.ids ? { ids: target.ids } : { filter: target.filter ?? {} }),
    params: action === 'grant' ? { amount: Number(amount), expires_at: expires || null } : action === 'plan' ? { plan } : {},
    dry_run: dryRun,
    confirm: !dryRun,
  });

  const doPreview = async () => {
    setBusy(true); setError(null);
    try { setPreview(await adminPost('/bulk', body(true))); }
    catch (e) { setError(e); setPreview(null); }
    finally { setBusy(false); }
  };

  const doRun = async () => {
    setBusy(true); setError(null);
    try {
      const started = await stepUp(() => adminPost<{ job_id: string }>('/bulk', body(false)));
      const poll = async () => {
        const j = await adminGet<Job>(`/bulk/${started.job_id}`);
        setJob(j);
        if (j.job.status === 'done' || j.job.status === 'failed') {
          window.clearInterval(timer.current);
          onFinished?.();
        }
      };
      await poll();
      timer.current = window.setInterval(() => poll().catch(() => undefined), 1000);
    } catch (e) { setError(e); }
    finally { setBusy(false); }
  };

  const reasonOk = reason.trim().length > 0;
  const destructive = action === 'revoke' || action === 'suspend';
  const needsTyped = action === 'revoke';
  const confirmWord = String(preview?.will_affect ?? '');
  const finished = job && (job.job.status === 'done' || job.job.status === 'failed');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk action</DialogTitle>
          <DialogDescription>{target.label}</DialogDescription>
        </DialogHeader>

        {!job && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Action</Label>
              <Select value={action} onValueChange={(v) => setAction(v as Action)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="grant">Grant fills</SelectItem>
                  <SelectItem value="suspend">Suspend</SelectItem>
                  <SelectItem value="revoke">Revoke access</SelectItem>
                  <SelectItem value="reinstate">Reinstate</SelectItem>
                  <SelectItem value="plan">Change plan</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {action === 'grant' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Fills each</Label><Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Expires (optional)</Label><Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></div>
              </div>
            )}
            {action === 'plan' && (
              <div className="space-y-1.5"><Label>Plan</Label><Input value={plan} onChange={(e) => setPlan(e.target.value.toUpperCase())} /></div>
            )}
            <div className="space-y-1.5">
              <Label>Reason (recorded for every user)</Label>
              <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => { setReason(e.target.value); setPreview(null); }} />
            </div>

            {preview && (
              <div className="rounded-lg border bg-slate-50 p-3 text-sm">
                This will affect <strong>{preview.will_affect}</strong> user{preview.will_affect === 1 ? '' : 's'}.
                {preview.skipped_admins > 0 && <> {preview.skipped_admins} admin account(s) are skipped.</>}
              </div>
            )}
            {preview && needsTyped && preview.will_affect > 0 && (
              <div className="space-y-1.5">
                <Label>Type <span className="font-mono">{confirmWord}</span> to confirm</Label>
                <Input value={typed} onChange={(e) => setTyped(e.target.value)} />
              </div>
            )}
            <ErrorNote error={error} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              {!preview ? (
                <Button onClick={doPreview} disabled={!reasonOk || busy}>Preview</Button>
              ) : (
                <Button
                  variant={destructive ? 'destructive' : 'default'}
                  onClick={doRun}
                  disabled={busy || preview.will_affect === 0 || (needsTyped && typed.trim() !== confirmWord)}
                >
                  {busy ? 'Starting…' : `Run on ${preview.will_affect} user${preview.will_affect === 1 ? '' : 's'}`}
                </Button>
              )}
            </div>
          </div>
        )}

        {job && (
          <div className="space-y-3">
            <div className="h-2 rounded bg-slate-100">
              <div className="h-2 rounded bg-brand transition-all" style={{ width: `${job.job.total ? ((job.job.succeeded + job.job.failed) / job.job.total) * 100 : 0}%` }} />
            </div>
            <p className="text-sm">
              {finished ? (job.job.status === 'done' ? 'Finished.' : 'The job stopped unexpectedly.') : 'Running…'}{' '}
              {job.job.succeeded} succeeded, {job.job.failed} failed of {job.job.total}.
            </p>
            {finished && job.job.failed > 0 && (
              <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                {job.items.filter((i) => i.status === 'error').map((i) => (
                  <li key={i.user_id} className="rounded border border-red-200 bg-red-50 px-2 py-1">
                    <span className="font-mono">{i.user_id.slice(0, 8)}</span>: {i.error}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end"><Button onClick={() => onOpenChange(false)}>Close</Button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
