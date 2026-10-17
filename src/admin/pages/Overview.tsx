import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminGet } from '../adminApi';
import { num, pct } from '../format';
import { ErrorNote, PageHeader, Panel, Stat } from '../ui';

interface Period {
  total_users: number; new_users: number; weekly_active_users: number; active_users: number;
  activated_users: number; activation_rate: number | null; fills_consumed: number; fills_granted: number;
  applications_logged: number;
  plan_mix: Record<string, number>; status_mix: Record<string, number>;
  daily: Array<{ day: string; fills: number; active_users: number; new_users: number; granted: number }>;
}
interface Quality {
  by_platform: Array<{ platform: string; mappings: number; success: number; override: number; missing: number; evidence: number; override_rate: number | null; miss_rate: number | null }>;
  top_unmatched: Array<{ label: string; field_name: string; canonical_key: string; platform: string; missing: number; override: number; success: number }>;
}

const UNAVAILABLE = 'Needs usage tracking';

export default function Overview() {
  const [range, setRange] = useState('7d');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const custom = range === 'custom';
  const enabled = !custom || (!!from && !!to);

  const overview = useQuery({
    queryKey: ['admin', 'overview', range, from, to],
    enabled,
    queryFn: () => adminGet<{ current: Period; previous: Period }>('/metrics/overview', { range, from, to }),
  });
  const quality = useQuery({ queryKey: ['admin', 'quality', ''], queryFn: () => adminGet<Quality>('/metrics/quality') });

  const c = overview.data?.current;
  const p = overview.data?.previous;
  const totals = (quality.data?.by_platform ?? []).reduce(
    (a, r) => ({ success: a.success + r.success, override: a.override + r.override, missing: a.missing + r.missing }),
    { success: 0, override: 0, missing: 0 },
  );
  const filledOrOverridden = totals.success + totals.override;
  const evidence = filledOrOverridden + totals.missing;

  return (
    <div>
      <PageHeader title="Overview">
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-36" aria-label="Date range"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="custom">Custom…</SelectItem>
          </SelectContent>
        </Select>
        {custom && (
          <>
            <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
            <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
          </>
        )}
      </PageHeader>

      <ErrorNote error={overview.error} />

      {c && p && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Total users" value={num(c.total_users)} current={c.total_users} previous={p.total_users} />
            <Stat label="New users" value={num(c.new_users)} current={c.new_users} previous={p.new_users} />
            <Stat label="Weekly active users" value={num(c.weekly_active_users)} current={c.weekly_active_users} previous={p.weekly_active_users} />
            <Stat label="Activation rate" value={pct(c.activation_rate)} current={c.activation_rate} previous={p.activation_rate}
              hint={`${num(c.activated_users)} of ${num(c.new_users)} new users filled`} />
            <Stat label="Fills consumed" value={num(c.fills_consumed)} current={c.fills_consumed} previous={p.fills_consumed} />
            <Stat label="Fills granted" value={num(c.fills_granted)} current={c.fills_granted} previous={p.fills_granted}
              hint={`${pct(c.fills_granted ? c.fills_consumed / c.fills_granted : null)} of granted consumed`} />
            <Stat label="Applications logged" value={num(c.applications_logged)} current={c.applications_logged} previous={p.applications_logged}
              hint="Tracked by users in the app" />
            <Stat label="Override rate (all-time)" value={pct(filledOrOverridden ? totals.override / filledOrOverridden : null)}
              hint="Shared form mappings" />
            <Stat label="Applications submitted" value="" unavailable hint={UNAVAILABLE} />
            <Stat label="Pages / fields filled" value="" unavailable hint={UNAVAILABLE} />
            <Stat label="Failure rate" value="" unavailable hint={UNAVAILABLE} />
            <Stat label="Miss rate (all-time)" value={pct(evidence ? totals.missing / evidence : null)} hint="Fields with no matching profile value" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Fills per day">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={c.daily}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} fontSize={12} />
                    <YAxis allowDecimals={false} fontSize={12} width={32} />
                    <Tooltip />
                    <Bar dataKey="fills" name="Fills" fill="#8A2BE2" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel title="New vs active users per day">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={c.daily}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} fontSize={12} />
                    <YAxis allowDecimals={false} fontSize={12} width={32} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="new_users" name="New" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="active_users" name="Active" stroke="#8A2BE2" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Plan mix">
              <KeyValues data={c.plan_mix} />
            </Panel>
            <Panel title="Access status">
              <KeyValues data={c.status_mix} />
            </Panel>
            <Panel title="ATS mix (form evidence)">
              <KeyValues data={Object.fromEntries((quality.data?.by_platform ?? []).map((r) => [r.platform, r.evidence]))} />
            </Panel>
          </div>

          <Panel title="Top unmatched field labels">
            {(quality.data?.top_unmatched ?? []).length === 0 ? (
              <p className="text-sm text-slate-500">No unmatched fields recorded.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr><th className="py-1">Label</th><th>ATS</th><th className="text-right">Missed</th><th className="text-right">Overridden</th></tr>
                </thead>
                <tbody>
                  {quality.data!.top_unmatched.slice(0, 10).map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1.5">{r.label || r.field_name || '(unlabelled)'}</td>
                      <td>{r.platform}</td>
                      <td className="text-right">{num(r.missing)}</td>
                      <td className="text-right">{num(r.override)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>
      )}
      {overview.isLoading && enabled && <p className="text-sm text-slate-500">Loading…</p>}
    </div>
  );
}

function KeyValues({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return <p className="text-sm text-slate-500">No data.</p>;
  const total = entries.reduce((s, [, v]) => s + v, 0);
  return (
    <ul className="space-y-2">
      {entries.map(([k, v]) => (
        <li key={k} className="text-sm">
          <div className="flex justify-between"><span>{k}</span><span className="text-slate-500">{num(v)}</span></div>
          <div className="mt-1 h-1.5 rounded bg-slate-100"><div className="h-1.5 rounded bg-brand" style={{ width: `${(v / total) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}
