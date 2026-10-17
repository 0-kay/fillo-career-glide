import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { adminGet, adminPost } from '../adminApi';
import ActionDialog from '../ActionDialog';
import { ErrorNote, PageHeader, Panel } from '../ui';

interface Plan { name: string; default_fills: number; renewal_period: 'none' | 'monthly'; limits: { unlimited?: boolean }; active: boolean }
interface Flag { key: string; description: string; default_enabled: boolean; overrides: { users?: Record<string, boolean>; plans?: Record<string, boolean> } }
interface Settings {
  kill_switch?: { enabled: boolean; message: string };
  tracking_policy?: { sensitive_field_denylist: string[]; retention_days: number };
}

export default function Platform() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => adminGet<Settings>('/platform/settings') });
  const plans = useQuery({ queryKey: ['admin', 'plans'], queryFn: () => adminGet<Plan[]>('/plans') });
  const flags = useQuery({ queryKey: ['admin', 'flags'], queryFn: () => adminGet<Flag[]>('/flags') });
  const reload = (k: string) => qc.invalidateQueries({ queryKey: ['admin', k] });

  const kill = settings.data?.kill_switch;
  const [killOpen, setKillOpen] = useState(false);
  const [killMessage, setKillMessage] = useState('');
  const killSavedMessage = kill?.message;
  useEffect(() => { if (killSavedMessage !== undefined) setKillMessage(killSavedMessage); }, [killSavedMessage]);

  const policy = settings.data?.tracking_policy;
  const [deny, setDeny] = useState('');
  const [retention, setRetention] = useState('');
  const [policyOpen, setPolicyOpen] = useState(false);
  useEffect(() => {
    if (policy) { setDeny(policy.sensitive_field_denylist.join('\n')); setRetention(String(policy.retention_days)); }
  }, [policy]);

  const [planDraft, setPlanDraft] = useState<Plan | null>(null);
  const [flagDraft, setFlagDraft] = useState<(Flag & { overridesText: string }) | null>(null);
  const [flagDelete, setFlagDelete] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader title="Platform" />
      <ErrorNote error={settings.error ?? plans.error ?? flags.error} />

      <Panel title="Global kill switch">
        <p className="text-sm text-slate-600">
          Halts fills for every user. Use during an incident; the message below is shown to users in the extension.
        </p>
        <div className="mt-3 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="kill-msg">Message shown to users</Label>
            <Textarea id="kill-msg" rows={2} maxLength={300} value={killMessage} onChange={(e) => setKillMessage(e.target.value)} />
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-sm font-medium ${kill?.enabled ? 'text-red-700' : 'text-emerald-700'}`}>
              {kill?.enabled ? 'Fills are HALTED' : 'Fills are running'}
            </span>
            <Button variant={kill?.enabled ? 'default' : 'destructive'} onClick={() => setKillOpen(true)} disabled={!kill}>
              {kill?.enabled ? 'Resume fills' : 'Halt all fills'}
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title="Plans" action={<Button size="sm" variant="outline" onClick={() => setPlanDraft({ name: '', default_fills: 0, renewal_period: 'none', limits: {}, active: true })}>New plan</Button>}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">Plan</th><th>Default fills</th><th>Renewal</th><th>Unlimited</th><th>Active</th><th /></tr></thead>
          <tbody>
            {plans.data?.map((p) => (
              <tr key={p.name} className="border-t">
                <td className="py-1.5 font-medium">{p.name}</td>
                <td>{p.default_fills}</td>
                <td>{p.renewal_period}</td>
                <td>{p.limits?.unlimited ? 'yes' : 'no'}</td>
                <td>{p.active ? 'yes' : 'no'}</td>
                <td className="text-right"><Button size="sm" variant="ghost" onClick={() => setPlanDraft(p)}>Edit</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">Monthly plans issue their allowance as a ledger grant at the start of each UTC month; unspent fills expire.</p>
      </Panel>

      <Panel title="Feature flags" action={<Button size="sm" variant="outline" onClick={() => setFlagDraft({ key: '', description: '', default_enabled: false, overrides: {}, overridesText: '' })}>New flag</Button>}>
        {flags.data?.length === 0 && <p className="text-sm text-slate-500">No flags yet.</p>}
        <ul className="divide-y">
          {flags.data?.map((f) => (
            <li key={f.key} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div>
                <span className="font-mono">{f.key}</span>
                <span className={`ml-2 text-xs ${f.default_enabled ? 'text-emerald-700' : 'text-slate-500'}`}>default {f.default_enabled ? 'on' : 'off'}</span>
                <div className="text-xs text-slate-500">
                  {f.description} {Object.keys(f.overrides.users ?? {}).length > 0 && `· ${Object.keys(f.overrides.users ?? {}).length} user override(s)`}
                  {Object.keys(f.overrides.plans ?? {}).length > 0 && ` · plans: ${Object.entries(f.overrides.plans ?? {}).map(([k, v]) => `${k}=${v ? 'on' : 'off'}`).join(', ')}`}
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setFlagDraft({
                  ...f,
                  overridesText: [
                    ...Object.entries(f.overrides.users ?? {}).map(([k, v]) => `user:${k}:${v ? 'on' : 'off'}`),
                    ...Object.entries(f.overrides.plans ?? {}).map(([k, v]) => `plan:${k}:${v ? 'on' : 'off'}`),
                  ].join('\n'),
                })}>Edit</Button>
                <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setFlagDelete(f.key)}>Delete</Button>
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Tracking policy">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="deny">Sensitive-field denylist (one term per line)</Label>
            <Textarea id="deny" rows={6} value={deny} onChange={(e) => setDeny(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ret">Retention window (days)</Label>
            <Input id="ret" type="number" min={1} max={3650} value={retention} onChange={(e) => setRetention(e.target.value)} />
          </div>
        </div>
        <div className="mt-3"><Button onClick={() => setPolicyOpen(true)}>Save policy</Button></div>
      </Panel>

      <ActionDialog open={killOpen} onOpenChange={setKillOpen} title={kill?.enabled ? 'Resume fills' : 'Halt all fills'}
        destructive={!kill?.enabled} submitLabel={kill?.enabled ? 'Resume' : 'Halt fills for everyone'}
        description="You will be asked for a fresh authenticator code. This is recorded in the audit log."
        successMessage={kill?.enabled ? 'Fills resumed' : 'Fills halted'} onDone={() => reload('settings')}
        onSubmit={(reason) => adminPost('/platform/kill-switch', { enabled: !kill?.enabled, message: killMessage, reason })} />

      <ActionDialog open={policyOpen} onOpenChange={setPolicyOpen} title="Save tracking policy" submitLabel="Save" onDone={() => reload('settings')}
        successMessage="Policy saved"
        onSubmit={(reason) => adminPost('/platform/tracking-policy', {
          sensitive_field_denylist: deny.split('\n').map((s) => s.trim()).filter(Boolean),
          retention_days: Number(retention),
          reason,
        })} />

      {planDraft && (
        <ActionDialog open onOpenChange={(o) => !o && setPlanDraft(null)} title={planDraft.name ? `Edit ${planDraft.name}` : 'New plan'}
          submitLabel="Save plan" successMessage="Plan saved" onDone={() => { setPlanDraft(null); reload('plans'); }}
          onSubmit={(reason) => adminPost('/plans', { ...planDraft, reason })}>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Name</Label>
              <Input value={planDraft.name} onChange={(e) => setPlanDraft({ ...planDraft, name: e.target.value.toUpperCase() })} /></div>
            <div className="space-y-1.5"><Label>Default fills</Label>
              <Input type="number" min={0} value={planDraft.default_fills} onChange={(e) => setPlanDraft({ ...planDraft, default_fills: Number(e.target.value) })} /></div>
            <div className="space-y-1.5"><Label>Renewal</Label>
              <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={planDraft.renewal_period}
                onChange={(e) => setPlanDraft({ ...planDraft, renewal_period: e.target.value as Plan['renewal_period'] })}>
                <option value="none">None</option><option value="monthly">Monthly</option>
              </select></div>
            <div className="flex items-end gap-4 pb-2">
              <label className="flex items-center gap-2 text-sm"><Checkbox checked={!!planDraft.limits?.unlimited} onCheckedChange={(c) => setPlanDraft({ ...planDraft, limits: { unlimited: c === true } })} />Unlimited</label>
              <label className="flex items-center gap-2 text-sm"><Switch checked={planDraft.active} onCheckedChange={(c) => setPlanDraft({ ...planDraft, active: c })} />Active</label>
            </div>
          </div>
        </ActionDialog>
      )}

      {flagDraft && (
        <ActionDialog open onOpenChange={(o) => !o && setFlagDraft(null)} title={flagDraft.key ? `Edit ${flagDraft.key}` : 'New flag'}
          submitLabel="Save flag" successMessage="Flag saved" onDone={() => { setFlagDraft(null); reload('flags'); }}
          onSubmit={(reason) => {
            const overrides = { users: {} as Record<string, boolean>, plans: {} as Record<string, boolean> };
            for (const line of flagDraft.overridesText.split('\n').map((l) => l.trim()).filter(Boolean)) {
              const [kind, target, state] = line.split(':');
              if ((kind !== 'user' && kind !== 'plan') || !target || (state !== 'on' && state !== 'off')) {
                throw new Error(`Bad override line "${line}". Use user:<id>:on or plan:<NAME>:off`);
              }
              overrides[kind === 'user' ? 'users' : 'plans'][target] = state === 'on';
            }
            return adminPost('/flags', { key: flagDraft.key, description: flagDraft.description, default_enabled: flagDraft.default_enabled, overrides, reason });
          }}>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Key</Label>
              <Input value={flagDraft.key} disabled={!!flags.data?.some((f) => f.key === flagDraft.key)} onChange={(e) => setFlagDraft({ ...flagDraft, key: e.target.value })} placeholder="new_ats_beta" /></div>
            <div className="space-y-1.5"><Label>Description</Label>
              <Input value={flagDraft.description} onChange={(e) => setFlagDraft({ ...flagDraft, description: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm"><Switch checked={flagDraft.default_enabled} onCheckedChange={(c) => setFlagDraft({ ...flagDraft, default_enabled: c })} />Enabled by default</label>
            <div className="space-y-1.5"><Label>Overrides (one per line)</Label>
              <Textarea rows={4} value={flagDraft.overridesText} onChange={(e) => setFlagDraft({ ...flagDraft, overridesText: e.target.value })}
                placeholder={'user:<user id>:on\nplan:FREE:off'} />
              <p className="text-xs text-slate-500">A user override beats a plan override, which beats the default.</p></div>
          </div>
        </ActionDialog>
      )}

      {flagDelete && (
        <ActionDialog open onOpenChange={(o) => !o && setFlagDelete(null)} title={`Delete ${flagDelete}`} submitLabel="Delete flag" destructive
          typeToConfirm={flagDelete} successMessage="Flag deleted" onDone={() => { setFlagDelete(null); reload('flags'); }}
          onSubmit={(reason) => adminPost('/flags', { key: flagDelete, delete: true, reason })} />
      )}
    </div>
  );
}
