import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminGet, adminPost, canWrite, isOwner } from '../adminApi';
import { day, newKey, num, when } from '../format';
import { useMe } from '../AdminLayout';
import ActionDialog from '../ActionDialog';
import { ErrorNote, PageHeader, Panel, StatusBadge } from '../ui';

interface Detail {
  user: { id: string; email: string | null; full_name: string | null; signup_at: string; last_active: string | null; applications: number };
  entitlement: {
    status: string; plan: string; effective_plan: string; unlimited: boolean; balance: number;
    suspended_until: string | null; daily_fill_cap: number | null; max_applications_per_day: number | null;
  };
  billing: { plan: string; subscription_status: string; interval: string | null; current_period_end: string | null };
  usage: { fills_7d: number; fills_all: number; daily: Array<{ day: string; fills: number }> };
  applications: Array<{ company_name: string; position_title: string; status: string; applied_at: string }>;
  audit: Array<{ id: string; admin_email: string | null; action: string; reason: string | null; before: unknown; after: unknown; created_at: string }>;
}
interface Ledger {
  total: number;
  rows: Array<{ id: string; delta: number; source: string; units: number; reason: string | null; created_at: string; expires_at: string | null; admin_email: string | null }>;
}

type Dialog =
  | 'grant' | 'remove' | 'set' | 'reset' | 'suspend' | 'revoke' | 'reinstate'
  | 'plan' | 'limits' | 'signout' | 'delete-activity' | 'delete-account' | null;

export default function UserDetail() {
  const { id = '' } = useParams();
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [ledgerPage, setLedgerPage] = useState(0);

  const q = useQuery({ queryKey: ['admin', 'user', id], queryFn: () => adminGet<Detail>(`/users/${id}`), retry: false });
  const ledger = useQuery({
    queryKey: ['admin', 'ledger', id, ledgerPage],
    queryFn: () => adminGet<Ledger>(`/users/${id}/ledger`, { limit: 25, cursor: ledgerPage * 25 }),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'user', id] });
    qc.invalidateQueries({ queryKey: ['admin', 'ledger', id] });
  };

  if (q.error) return <div className="space-y-4"><Link to="/admin/users" className="text-sm text-brand-dark">← Users</Link><ErrorNote error={q.error} /></div>;
  const d = q.data;
  if (!d) return <p className="text-sm text-slate-500">Loading…</p>;

  const e = d.entitlement;
  const write = canWrite(me.role);
  const label = d.user.email ?? d.user.id;

  return (
    <div className="space-y-6">
      <Link to="/admin/users" className="text-sm text-brand-dark hover:underline">← Users</Link>
      <PageHeader title={label}>
        <StatusBadge status={e.status} />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Profile">
          <dl className="space-y-1.5 text-sm">
            <Item k="User id" v={<span className="font-mono text-xs">{d.user.id}</span>} />
            <Item k="Name" v={d.user.full_name ?? '—'} />
            <Item k="Signed up" v={day(d.user.signup_at)} />
            <Item k="Last active" v={when(d.user.last_active)} />
            <Item k="Plan" v={`${e.effective_plan}${d.billing.plan === 'pro' ? ` (Stripe: ${d.billing.subscription_status})` : ''}`} />
            <Item k="Extension version" v="Not reported yet" />
          </dl>
        </Panel>

        <Panel title="Entitlement">
          <div className="text-3xl font-semibold">{e.unlimited ? '∞' : num(e.balance)}</div>
          <div className="text-xs text-slate-500">{e.unlimited ? 'Unlimited plan' : 'fills remaining'}</div>
          <dl className="mt-3 space-y-1.5 text-sm">
            {e.suspended_until && <Item k="Suspended until" v={when(e.suspended_until)} />}
            <Item k="Daily cap" v={e.daily_fill_cap === null ? 'None' : String(e.daily_fill_cap)} />
            <Item k="Max applications / day" v={e.max_applications_per_day === null ? 'None' : String(e.max_applications_per_day)} />
          </dl>
        </Panel>

        <Panel title="Usage">
          <dl className="space-y-1.5 text-sm">
            <Item k="Fills, last 7 days" v={num(d.usage.fills_7d)} />
            <Item k="Fills, all time" v={num(d.usage.fills_all)} />
            <Item k="Applications logged" v={num(d.user.applications)} />
          </dl>
          <div className="mt-3 h-24">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.usage.daily}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="day" hide />
                <YAxis hide allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="fills" fill="#8A2BE2" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {write && (
        <Panel title="Actions">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setDialog('grant')}>Grant fills</Button>
            <Button size="sm" variant="outline" onClick={() => setDialog('remove')}>Remove fills</Button>
            <Button size="sm" variant="outline" onClick={() => setDialog('set')}>Set balance</Button>
            <Button size="sm" variant="outline" onClick={() => setDialog('reset')}>Reset to plan default</Button>
            <Button size="sm" variant="outline" onClick={() => setDialog('plan')}>Change plan</Button>
            <Button size="sm" variant="outline" onClick={() => setDialog('limits')}>Limits</Button>
            {e.status === 'ACTIVE' ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setDialog('suspend')}>Suspend</Button>
                <Button size="sm" variant="outline" className="text-red-700" onClick={() => setDialog('revoke')}>Revoke access</Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setDialog('reinstate')}>Reinstate</Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setDialog('signout')}>Force sign-out</Button>
            <Button size="sm" variant="outline" className="text-red-700" onClick={() => setDialog('delete-activity')}>Delete activity data</Button>
            {isOwner(me.role) && (
              <Button size="sm" variant="destructive" onClick={() => setDialog('delete-account')}>Delete account</Button>
            )}
          </div>
        </Panel>
      )}

      <Panel title="Fill ledger" action={<span className="text-xs text-slate-500">{ledger.data ? `${num(ledger.data.total)} entries` : ''}</span>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">When</th><th>Source</th><th className="text-right">Change</th><th>Reason</th><th>By</th><th>Expires</th></tr>
            </thead>
            <tbody>
              {ledger.data?.rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="whitespace-nowrap py-1.5">{when(r.created_at)}</td>
                  <td className="font-mono text-xs">{r.source}</td>
                  <td className={`text-right font-medium ${r.delta > 0 ? 'text-emerald-700' : r.delta < 0 ? 'text-red-700' : 'text-slate-400'}`}>
                    {r.delta > 0 ? `+${r.delta}` : r.delta}{r.source === 'USAGE' && r.delta === 0 ? ' (unmetered)' : ''}
                  </td>
                  <td>{r.reason ?? '—'}</td>
                  <td>{r.admin_email ?? (r.source === 'USAGE' || r.source === 'PLAN_GRANT' || r.source === 'EXPIRY' ? 'system' : '—')}</td>
                  <td className="whitespace-nowrap">{r.expires_at ? day(r.expires_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={ledgerPage === 0} onClick={() => setLedgerPage(ledgerPage - 1)}>Newer</Button>
          <Button size="sm" variant="outline" disabled={!ledger.data || (ledgerPage + 1) * 25 >= ledger.data.total} onClick={() => setLedgerPage(ledgerPage + 1)}>Older</Button>
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Applications">
          {d.applications.length === 0 ? <p className="text-sm text-slate-500">No applications logged.</p> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">Company</th><th>Role</th><th>Status</th><th>Date</th></tr></thead>
              <tbody>
                {d.applications.map((a, i) => (
                  <tr key={i} className="border-t"><td className="py-1.5">{a.company_name}</td><td>{a.position_title}</td><td>{a.status}</td><td>{day(a.applied_at)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-xs text-slate-400">Company, role and status only. Links, notes and profile data are not shown to admins.</p>
        </Panel>

        <Panel title="Admin actions on this user">
          {d.audit.length === 0 ? <p className="text-sm text-slate-500">None yet.</p> : (
            <ul className="space-y-2 text-sm">
              {d.audit.map((a) => (
                <li key={a.id} className="border-t pt-2 first:border-t-0 first:pt-0">
                  <div className="flex justify-between gap-2"><span className="font-mono text-xs">{a.action}</span><span className="text-xs text-slate-500">{when(a.created_at)}</span></div>
                  <div className="text-xs text-slate-500">{a.admin_email ?? 'system'}{a.reason ? ` — ${a.reason}` : ''}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Dialogs
        which={dialog}
        close={() => setDialog(null)}
        id={id}
        label={label}
        detail={d}
        done={refresh}
        onDeleted={() => navigate('/admin/users')}
      />
    </div>
  );
}

function Item({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="text-right">{v}</dd></div>;
}

function Dialogs({ which, close, id, label, detail, done, onDeleted }: {
  which: Dialog; close: () => void; id: string; label: string; detail: Detail; done: () => void; onDeleted: () => void;
}) {
  const [amount, setAmount] = useState('10');
  const [expires, setExpires] = useState('');
  const [until, setUntil] = useState('');
  const [balance, setBalance] = useState('');
  const [plan, setPlan] = useState('FREE');
  const [dailyCap, setDailyCap] = useState('');
  const [maxApps, setMaxApps] = useState('');
  const [key] = useState(newKey);
  const open = (n: Dialog) => which === n;
  const onOpenChange = (o: boolean) => !o && close();
  const plans = useQuery({ queryKey: ['admin', 'plans'], queryFn: () => adminGet<Array<{ name: string; active: boolean }>>('/plans') });

  return (
    <>
      <ActionDialog open={open('grant')} onOpenChange={onOpenChange} title="Grant fills" submitLabel="Grant" onDone={done}
        successMessage="Fills granted"
        onSubmit={(reason) => adminPost(`/users/${id}/fills`, {
          op: 'grant', amount: Number(amount), reason, expires_at: expires || null, idempotency_key: `${key}:${amount}:${expires}`,
        })}>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>Fills</Label><Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Expires (optional)</Label><Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></div>
        </div>
      </ActionDialog>

      <ActionDialog open={open('remove')} onOpenChange={onOpenChange} title="Remove fills" submitLabel="Remove" onDone={done}
        description={`Current balance: ${detail.entitlement.balance}. Use this for corrections.`} successMessage="Fills removed"
        onSubmit={(reason) => adminPost(`/users/${id}/fills`, { op: 'remove', amount: Number(amount), reason })}>
        <div className="space-y-1.5"><Label>Fills to remove</Label><Input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      </ActionDialog>

      <ActionDialog open={open('set')} onOpenChange={onOpenChange} title="Set balance" submitLabel="Set balance" onDone={done}
        description="Recorded as a corrective ledger entry; history is never overwritten." successMessage="Balance updated"
        onSubmit={(reason) => adminPost(`/users/${id}/fills`, { op: 'set', amount: Number(balance), reason })}>
        <div className="space-y-1.5"><Label>New balance</Label><Input type="number" min={0} value={balance} onChange={(e) => setBalance(e.target.value)} /></div>
      </ActionDialog>

      <ActionDialog open={open('reset')} onOpenChange={onOpenChange} title="Reset to plan default" submitLabel="Reset" onDone={done}
        description={`Sets the balance to the ${detail.entitlement.plan} plan's default allowance.`} successMessage="Balance reset"
        onSubmit={(reason) => adminPost(`/users/${id}/fills`, { op: 'reset', reason })} />

      <ActionDialog open={open('suspend')} onOpenChange={onOpenChange} title="Suspend access" submitLabel="Suspend" onDone={done}
        description="Blocks fills. The user can still sign in and see their data." successMessage="User suspended"
        onSubmit={(reason) => adminPost(`/users/${id}/status`, { action: 'suspend', reason, until: until ? new Date(until).toISOString() : null })}>
        <div className="space-y-1.5"><Label>Until (optional, otherwise until reinstated)</Label>
          <Input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} /></div>
      </ActionDialog>

      <ActionDialog open={open('revoke')} onOpenChange={onOpenChange} title="Revoke access" submitLabel="Revoke access" destructive onDone={done}
        typeToConfirm={detail.user.email ?? id}
        description="Removes access entirely and signs the user out everywhere. An admin can reinstate later." successMessage="Access revoked"
        onSubmit={(reason) => adminPost(`/users/${id}/status`, { action: 'revoke', reason, confirm: true })} />

      <ActionDialog open={open('reinstate')} onOpenChange={onOpenChange} title="Reinstate" submitLabel="Reinstate" onDone={done}
        description="Returns the user to ACTIVE. Leave the balance blank to keep the previous one." successMessage="User reinstated"
        onSubmit={(reason) => adminPost(`/users/${id}/status`, { action: 'reinstate', reason, balance: balance === '' ? null : Number(balance) })}>
        <div className="space-y-1.5"><Label>Balance (optional)</Label><Input type="number" min={0} value={balance} onChange={(e) => setBalance(e.target.value)} /></div>
      </ActionDialog>

      <ActionDialog open={open('plan')} onOpenChange={onOpenChange} title="Change plan" submitLabel="Change plan" onDone={done}
        successMessage="Plan changed"
        onSubmit={(reason) => adminPost(`/users/${id}/plan`, { plan, reason })}>
        <div className="space-y-1.5"><Label>Plan</Label>
          <Select value={plan} onValueChange={setPlan}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(plans.data ?? [{ name: 'FREE', active: true }]).filter((p) => p.active).map((p) => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </ActionDialog>

      <ActionDialog open={open('limits')} onOpenChange={onOpenChange} title="Per-user limits" submitLabel="Save limits" onDone={done}
        description="Leave a field blank to remove that limit." successMessage="Limits saved"
        onSubmit={(reason) => adminPost(`/users/${id}/limits`, {
          reason,
          limits: {
            daily_fill_cap: dailyCap === '' ? null : Number(dailyCap),
            max_applications_per_day: maxApps === '' ? null : Number(maxApps),
          },
        })}>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>Daily fill cap</Label><Input type="number" min={0} value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} placeholder={String(detail.entitlement.daily_fill_cap ?? '')} /></div>
          <div className="space-y-1.5"><Label>Max applications / day</Label><Input type="number" min={0} value={maxApps} onChange={(e) => setMaxApps(e.target.value)} placeholder={String(detail.entitlement.max_applications_per_day ?? '')} /></div>
        </div>
      </ActionDialog>

      <ActionDialog open={open('signout')} onOpenChange={onOpenChange} title="Force sign-out" submitLabel="Sign out everywhere" onDone={done}
        description="Ends all of this user's sessions. They can sign in again." successMessage="Sessions ended"
        onSubmit={(reason) => adminPost(`/users/${id}/signout`, { reason })} />

      <ActionDialog open={open('delete-activity')} onOpenChange={onOpenChange} title="Delete activity data" submitLabel="Delete activity" destructive onDone={done}
        description="Deletes this user's usage events and missed-field reports. Their profile and the fill ledger (counts only) are kept."
        successMessage="Activity data deleted"
        onSubmit={(reason) => adminPost(`/users/${id}/delete-activity`, { reason, confirm: true })} />

      <ActionDialog open={open('delete-account')} onOpenChange={onOpenChange} title="Delete account" submitLabel="Delete account permanently" destructive
        typeToConfirm={detail.user.email ?? id}
        description={`Permanently deletes ${label} and all of their data. This cannot be undone. You will be asked for a fresh authenticator code.`}
        successMessage="Account deleted" onDone={onDeleted}
        onSubmit={(reason) => adminPost(`/users/${id}/delete-account`, { reason, confirm: detail.user.email ?? id })} />
    </>
  );
}
