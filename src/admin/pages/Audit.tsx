import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { adminDownload, adminGet } from '../adminApi';
import { when } from '../format';
import { ErrorNote, PageHeader } from '../ui';

interface Row {
  id: string; admin_email: string | null; action: string; target_user_id: string | null;
  before: unknown; after: unknown; reason: string | null; ip: string | null; created_at: string;
}

export default function Audit() {
  const [admin, setAdmin] = useState('');
  const [action, setAction] = useState('');
  const [target, setTarget] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cursor, setCursor] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  const params = { admin, action, target, from, to };
  const q = useQuery({
    queryKey: ['admin', 'audit', params, cursor],
    queryFn: () => adminGet<{ total: number; rows: Row[]; next_cursor: string | null }>('/audit', { ...params, cursor, limit: 50 }),
    retry: false,
  });
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setCursor(0); };

  return (
    <div className="space-y-4">
      <PageHeader title="Audit log">
        <Button variant="outline" onClick={() => adminDownload('/audit', params, 'fyllo-audit.csv')}>Export CSV</Button>
      </PageHeader>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Input placeholder="Admin email" value={admin} onChange={(e) => reset(setAdmin)(e.target.value)} />
        <Input placeholder="Action (e.g. fills.)" value={action} onChange={(e) => reset(setAction)(e.target.value)} />
        <Input placeholder="Target user id" value={target} onChange={(e) => reset(setTarget)(e.target.value)} />
        <Input type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} aria-label="From" />
        <Input type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} aria-label="To" />
      </div>
      <ErrorNote error={q.error} />
      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr><th className="px-3 py-2">When</th><th>Admin</th><th>Action</th><th>Target</th><th>Reason</th><th>IP</th></tr>
          </thead>
          <tbody>
            {q.data?.rows.map((r) => (
              <Fragment key={r.id}>
                <tr className="cursor-pointer border-t hover:bg-slate-50" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <td className="whitespace-nowrap px-3 py-2">{when(r.created_at)}</td>
                  <td>{r.admin_email ?? 'system'}</td>
                  <td className="font-mono text-xs">{r.action}</td>
                  <td className="font-mono text-xs">{r.target_user_id ? r.target_user_id.slice(0, 8) : '—'}</td>
                  <td className="max-w-xs truncate">{r.reason ?? '—'}</td>
                  <td className="font-mono text-xs">{r.ip ?? '—'}</td>
                </tr>
                {open === r.id && (
                  <tr className="border-t bg-slate-50">
                    <td colSpan={6} className="px-3 py-2">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div><div className="text-xs font-medium text-slate-500">Before</div><pre className="overflow-x-auto text-xs">{JSON.stringify(r.before, null, 2) ?? 'null'}</pre></div>
                        <div><div className="text-xs font-medium text-slate-500">After</div><pre className="overflow-x-auto text-xs">{JSON.stringify(r.after, null, 2) ?? 'null'}</pre></div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {q.data?.rows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No matching entries.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-sm text-slate-500">
        <span>{q.data ? `${q.data.total.toLocaleString()} entries` : ''}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={cursor === 0} onClick={() => setCursor(Math.max(0, cursor - 50))}>Previous</Button>
          <Button variant="outline" size="sm" disabled={!q.data?.next_cursor} onClick={() => setCursor(Number(q.data?.next_cursor))}>Next</Button>
        </div>
      </div>
    </div>
  );
}
