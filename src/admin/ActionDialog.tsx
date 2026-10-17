import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { AdminApiError } from './adminApi';
import { useStepUp } from './StepUp';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  submitLabel: string;
  destructive?: boolean;
  /** The user must type this exact text (email, id, ...) before the action can run. */
  typeToConfirm?: string;
  /** Hide the reason box for actions that are not audited with a free-text reason. */
  children?: React.ReactNode;
  onSubmit: (reason: string) => Promise<unknown>;
  onDone?: () => void;
  successMessage?: string;
}

/** Every admin action asks for a reason; the server rejects the request without one. */
export default function ActionDialog(p: Props) {
  const { toast } = useToast();
  const stepUp = useStepUp();
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const ready = reason.trim().length > 0 && (!p.typeToConfirm || typed.trim().toLowerCase() === p.typeToConfirm.toLowerCase());

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await stepUp(() => p.onSubmit(reason.trim()));
      toast({ title: p.successMessage ?? 'Done' });
      setReason('');
      setTyped('');
      p.onOpenChange(false);
      p.onDone?.();
    } catch (e) {
      if (e instanceof Error && e.message === 'Cancelled') return;
      setError(e instanceof AdminApiError || e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{p.title}</DialogTitle>
          {p.description && <DialogDescription>{p.description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-4">
          {p.children}
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason (recorded in the audit log)</Label>
            <Textarea id="reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Support ticket #1234" />
          </div>
          {p.typeToConfirm && (
            <div className="space-y-1.5">
              <Label htmlFor="typed">
                Type <span className="font-mono">{p.typeToConfirm}</span> to confirm
              </Label>
              <Input id="typed" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </div>
          )}
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => p.onOpenChange(false)}>Cancel</Button>
          <Button variant={p.destructive ? 'destructive' : 'default'} onClick={submit} disabled={!ready || busy}>
            {busy ? 'Working…' : p.submitLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
