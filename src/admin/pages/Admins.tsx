import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminGet, adminPost, type Role } from '../adminApi';
import { when } from '../format';
import { useMe } from '../AdminLayout';
import ActionDialog from '../ActionDialog';
import { ErrorNote, PageHeader, Panel } from '../ui';

interface AdminRow {
  id: string; email: string; role: Role; status: 'active' | 'disabled'; mfa_enrolled: boolean;
  created_at: string; last_login_at: string | null; signed_in: boolean;
}

type Draft =
  | { op: 'invite'; email: string; role: Role }
  | { op: 'role'; row: AdminRow; role: Role }
  | { op: 'status'; row: AdminRow; status: 'active' | 'disabled' }
  | { op: 'remove'; row: AdminRow };

export default function Admins() {
  const me = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'admins'], queryFn: () => adminGet<AdminRow[]>('/admins') });
  const [draft, setDraft] = useState<Draft | null>(null);
  const done = () => { setDraft(null); qc.invalidateQueries({ queryKey: ['admin', 'admins'] }); };

  const body = (reason: string) => {
    if (!draft) return {};
    switch (draft.op) {
      case 'invite': return { op: 'invite', email: draft.email, role: draft.role, reason };
      case 'role': return { op: 'role', id: draft.row.id, role: draft.role, reason };
      case 'status': return { op: 'status', id: draft.row.id, status: draft.status, reason };
      case 'remove': return { op: 'remove', id: draft.row.id, reason };
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Admins">
        <Button onClick={() => setDraft({ op: 'invite', email: '', role: 'admin' })}>Invite admin</Button>
      </PageHeader>
      <ErrorNote error={q.error} />
      <Panel title="Admin accounts">
        <p className="mb-3 text-xs text-slate-500">
          Invite by email. The person signs up (or signs in) with that confirmed email and enrols an authenticator app
          the first time; the API refuses everything until they have.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr><th className="py-1">Email</th><th>Role</th><th>Status</th><th>MFA</th><th>Last login</th><th /></tr>
            </thead>
            <tbody>
              {q.data?.map((a) => {
                const self = a.email === me.email;
                return (
                  <tr key={a.id} className="border-t">
                    <td className="py-2">{a.email}{self && <span className="ml-2 text-xs text-slate-400">(you)</span>}{!a.signed_in && <span className="ml-2 text-xs text-amber-700">invited</span>}</td>
                    <td className="uppercase">{a.role}</td>
                    <td>{a.status}</td>
                    <td>{a.mfa_enrolled ? 'enrolled' : '—'}</td>
                    <td>{when(a.last_login_at)}</td>
                    <td className="space-x-1 whitespace-nowrap text-right">
                      {!self && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setDraft({ op: 'role', row: a, role: a.role })}>Role</Button>
                          <Button size="sm" variant="ghost" onClick={() => setDraft({ op: 'status', row: a, status: a.status === 'active' ? 'disabled' : 'active' })}>
                            {a.status === 'active' ? 'Disable' : 'Enable'}
                          </Button>
                          <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setDraft({ op: 'remove', row: a })}>Remove</Button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {draft && (
        <ActionDialog
          open onOpenChange={(o) => !o && setDraft(null)} onDone={done}
          title={draft.op === 'invite' ? 'Invite admin' : draft.op === 'role' ? 'Change role' : draft.op === 'status' ? (draft.status === 'disabled' ? 'Disable admin' : 'Enable admin') : 'Remove admin'}
          submitLabel={draft.op === 'invite' ? 'Invite' : draft.op === 'remove' ? 'Remove' : 'Save'}
          destructive={draft.op === 'remove' || (draft.op === 'status' && draft.status === 'disabled')}
          description="You will be asked for a fresh authenticator code. The change is recorded in the audit log."
          successMessage="Admin updated"
          onSubmit={(reason) => adminPost('/admins', body(reason))}
        >
          {draft.op === 'invite' && (
            <div className="space-y-1.5"><Label>Email</Label>
              <Input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></div>
          )}
          {(draft.op === 'invite' || draft.op === 'role') && (
            <div className="space-y-1.5"><Label>Role</Label>
              <Select value={draft.role} onValueChange={(v) => setDraft({ ...draft, role: v as Role })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer — read-only dashboards</SelectItem>
                  <SelectItem value="admin">Admin — manage users and view metrics</SelectItem>
                  <SelectItem value="owner">Owner — everything, including admins and platform settings</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </ActionDialog>
      )}
    </div>
  );
}
