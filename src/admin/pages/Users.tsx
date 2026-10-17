import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminDownload, adminGet, canWrite } from '../adminApi';
import { day, num, when } from '../format';
import { useMe } from '../AdminLayout';
import BulkDialog from '../BulkDialog';
import { ErrorNote, PageHeader, StatusBadge } from '../ui';

interface UserRow {
  user_id: string; email: string | null; full_name: string | null; signup_at: string; status: string; plan: string;
  unlimited: boolean; balance: number; fills_7d: number; fills_all: number; last_active: string | null; applications: number;
}

const PAGE = 50;

export default function Users() {
  const me = useMe();
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [plan, setPlan] = useState('all');
  const [balanceBelow, setBalanceBelow] = useState('');
  const [inactiveDays, setInactiveDays] = useState('');
  const [sort, setSort] = useState('signup_at');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState<{ ids?: string[]; filter?: Record<string, string>; label: string } | null>(null);

  const filter: Record<string, string> = {};
  if (query.trim()) filter.query = query.trim();
  if (status !== 'all') filter.status = status;
  if (plan !== 'all') filter.plan = plan;
  if (balanceBelow) filter.balance_below = balanceBelow;
  if (inactiveDays) filter.inactive_days = inactiveDays;

  const q = useQuery({
    queryKey: ['admin', 'users', filter, sort, dir, cursor],
    queryFn: () => adminGet<{ total: number; rows: UserRow[]; next_cursor: string | null }>('/users', { ...filter, sort, dir, cursor, limit: PAGE }),
    placeholderData: (prev) => prev,
  });

  const touch = (fn: () => void) => { fn(); setCursor(0); setSelected(new Set()); };
  const toggleSort = (key: string) => {
    if (sort === key) setDir(dir === 'asc' ? 'desc' : 'asc');
    else { setSort(key); setDir(key === 'email' ? 'asc' : 'desc'); }
    setCursor(0);
  };
  const rows = q.data?.rows ?? [];
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.user_id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const th = (key: string, label: string, right = false) => (
    <th className={`px-3 py-2 ${right ? 'text-right' : ''}`}>
      <button className="font-medium hover:text-slate-900" onClick={() => toggleSort(key)}>
        {label}{sort === key ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Users">
        <Button variant="outline" onClick={() => adminDownload('/users', { ...filter, sort, dir }, 'fyllo-users.csv')}>Export CSV</Button>
      </PageHeader>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Input placeholder="Search email, name or id" value={query} onChange={(e) => touch(() => setQuery(e.target.value))} aria-label="Search" />
        <Select value={status} onValueChange={(v) => touch(() => setStatus(v))}>
          <SelectTrigger aria-label="Status"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="SUSPENDED">Suspended</SelectItem>
            <SelectItem value="REVOKED">Revoked</SelectItem>
          </SelectContent>
        </Select>
        <Select value={plan} onValueChange={(v) => touch(() => setPlan(v))}>
          <SelectTrigger aria-label="Plan"><SelectValue placeholder="Plan" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any plan</SelectItem>
            {['FREE', 'BETA', 'PRO', 'CUSTOM'].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="number" min={0} placeholder="Balance below" value={balanceBelow} onChange={(e) => touch(() => setBalanceBelow(e.target.value))} />
        <Input type="number" min={0} placeholder="No activity in N days" value={inactiveDays} onChange={(e) => touch(() => setInactiveDays(e.target.value))} />
      </div>

      <ErrorNote error={q.error} />

      {canWrite(me.role) && (selected.size > 0 || (q.data && q.data.total > 0)) && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm">
          {selected.size > 0 && (
            <Button size="sm" onClick={() => setBulkTarget({ ids: [...selected], label: `${selected.size} selected user(s)` })}>
              Act on {selected.size} selected
            </Button>
          )}
          {q.data && q.data.total > 0 && (
            <Button size="sm" variant="outline" onClick={() => setBulkTarget({ filter, label: `All ${q.data!.total} users matching the current filters` })}>
              Act on all {num(q.data.total)} matching
            </Button>
          )}
          <span className="text-slate-500">Bulk actions preview the affected count and need confirmation.</span>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="w-8 px-3 py-2">
                <Checkbox checked={allSelected} aria-label="Select all on page"
                  onCheckedChange={(c) => setSelected(c ? new Set(rows.map((r) => r.user_id)) : new Set())} />
              </th>
              {th('email', 'User')}
              {th('plan', 'Plan')}
              {th('status', 'Status')}
              {th('balance', 'Balance', true)}
              {th('fills_7d', 'Fills 7d', true)}
              {th('fills_all', 'Fills all', true)}
              {th('applications', 'Apps', true)}
              {th('last_active', 'Last active')}
              {th('signup_at', 'Signed up')}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.user_id} className="border-t hover:bg-slate-50">
                <td className="px-3 py-2"><Checkbox checked={selected.has(r.user_id)} onCheckedChange={() => toggle(r.user_id)} aria-label={`Select ${r.email ?? r.user_id}`} /></td>
                <td className="px-3 py-2">
                  <Link to={`/admin/users/${r.user_id}`} className="font-medium text-brand-dark hover:underline">{r.email ?? r.user_id.slice(0, 8)}</Link>
                  {r.full_name && r.full_name !== r.email && <div className="text-xs text-slate-500">{r.full_name}</div>}
                </td>
                <td className="px-3 py-2">{r.plan}</td>
                <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                <td className="px-3 py-2 text-right">{r.unlimited ? '∞' : num(r.balance)}</td>
                <td className="px-3 py-2 text-right">{num(r.fills_7d)}</td>
                <td className="px-3 py-2 text-right">{num(r.fills_all)}</td>
                <td className="px-3 py-2 text-right">{num(r.applications)}</td>
                <td className="whitespace-nowrap px-3 py-2">{when(r.last_active)}</td>
                <td className="whitespace-nowrap px-3 py-2">{day(r.signup_at)}</td>
              </tr>
            ))}
            {q.data && rows.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-slate-500">No users match.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>{q.data ? `${num(q.data.total)} users` : 'Loading…'}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={cursor === 0} onClick={() => setCursor(Math.max(0, cursor - PAGE))}>Previous</Button>
          <Button variant="outline" size="sm" disabled={!q.data?.next_cursor} onClick={() => setCursor(Number(q.data?.next_cursor))}>Next</Button>
        </div>
      </div>

      {bulkTarget && (
        <BulkDialog
          open
          onOpenChange={(o) => !o && setBulkTarget(null)}
          target={bulkTarget}
          onFinished={() => { setSelected(new Set()); qc.invalidateQueries({ queryKey: ['admin', 'users'] }); }}
        />
      )}
    </div>
  );
}
