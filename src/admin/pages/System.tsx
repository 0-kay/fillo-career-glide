import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { adminGet, adminPost, canWrite } from '../adminApi';
import { when, num } from '../format';
import { useMe } from '../AdminLayout';
import { ErrorNote, PageHeader, Panel, Stat } from '../ui';

interface Health {
  ledger_rows_24h: number; fills_24h: number; admin_actions_24h: number; balance_mismatches: number;
  bulk_jobs: Record<string, number>;
  jobs: Array<{ job: string; started_at: string; finished_at: string | null; status: string; detail: Record<string, number>; seconds: number | null }>;
  kill_switch: { enabled: boolean; message: string } | null;
  providers: { stripe: boolean; stripe_webhook: boolean; typesafe: boolean; openai: boolean; ai_provider: string };
}

export default function System() {
  const me = useMe();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const q = useQuery({ queryKey: ['admin', 'health'], queryFn: () => adminGet<Health>('/system/health'), refetchInterval: 30_000 });
  const h = q.data;

  const rerun = async () => {
    setRunning(true);
    try {
      const r = await adminPost<{ checked: number; mismatched: number; fixed: number }>('/system/reconcile', {});
      toast({ title: 'Reconciliation finished', description: `${r.checked} checked, ${r.mismatched} mismatched, ${r.fixed} fixed.` });
      qc.invalidateQueries({ queryKey: ['admin', 'health'] });
    } catch (e) {
      toast({ title: 'Reconciliation failed', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="System health" />
      <ErrorNote error={q.error} />
      {h && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Fills (24h)" value={num(h.fills_24h)} />
            <Stat label="Ledger rows (24h)" value={num(h.ledger_rows_24h)} />
            <Stat label="Admin actions (24h)" value={num(h.admin_actions_24h)} />
            <Stat label="Balance mismatches" value={num(h.balance_mismatches)} hint={h.balance_mismatches ? 'Run reconciliation' : 'Cache matches ledger'} />
          </div>

          <Panel
            title="Background jobs"
            action={canWrite(me.role) && <Button size="sm" onClick={rerun} disabled={running}>{running ? 'Running…' : 'Re-run reconciliation'}</Button>}
          >
            {h.jobs.length === 0 ? (
              <p className="text-sm text-slate-500">No runs recorded yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">Job</th><th>Last run</th><th>Status</th><th>Duration</th><th>Result</th></tr></thead>
                <tbody>
                  {h.jobs.map((j) => (
                    <tr key={j.job} className="border-t">
                      <td className="py-1.5">{j.job}</td>
                      <td>{when(j.started_at)}</td>
                      <td className={j.status === 'ok' ? 'text-emerald-700' : 'text-red-700'}>{j.status}</td>
                      <td>{j.seconds === null ? '—' : `${Number(j.seconds).toFixed(2)}s`}</td>
                      <td className="text-xs text-slate-500">{Object.entries(j.detail ?? {}).map(([k, v]) => `${k}: ${v}`).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Kill switch">
              <p className="text-sm">
                {h.kill_switch?.enabled ? <span className="font-medium text-red-700">Fills are halted platform-wide.</span> : 'Fills are running normally.'}
              </p>
            </Panel>
            <Panel title="Bulk jobs (7 days)">
              {Object.keys(h.bulk_jobs).length === 0 ? <p className="text-sm text-slate-500">None.</p> :
                <p className="text-sm">{Object.entries(h.bulk_jobs).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>}
            </Panel>
          </div>

          <Panel title="Dependencies (configured)">
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              <Row label="AI provider" value={h.providers.ai_provider} ok />
              <Row label="TypeSafe key" value={h.providers.typesafe ? 'set' : 'not set'} ok={h.providers.typesafe} />
              <Row label="OpenAI key" value={h.providers.openai ? 'set' : 'not set'} ok={h.providers.openai || h.providers.ai_provider === 'typesafe'} />
              <Row label="Stripe key" value={h.providers.stripe ? 'set' : 'not set'} ok={h.providers.stripe} />
              <Row label="Stripe webhook secret" value={h.providers.stripe_webhook ? 'set' : 'not set'} ok={h.providers.stripe_webhook} />
            </ul>
            <p className="mt-3 text-xs text-slate-500">
              Ingestion queue lag and API latency are not measured yet; they need the tracking pipeline. This page
              shows configuration, not live provider status.
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <li className="flex justify-between rounded-lg border px-3 py-2">
      <span>{label}</span>
      <span className={ok ? 'text-emerald-700' : 'text-amber-700'}>{value}</span>
    </li>
  );
}
