import { createContext, useContext, useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { adminGet, AdminApiError, isOwner, type Me } from './adminApi';
import { StepUpProvider } from './StepUp';

const MeContext = createContext<Me | null>(null);
export const useMe = () => {
  const me = useContext(MeContext);
  if (!me) throw new Error('useMe outside AdminLayout');
  return me;
};

const NAV: Array<{ to: string; label: string; end?: boolean; owner?: boolean }> = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/quality', label: 'Quality & matching' },
  { to: '/admin/audit', label: 'Audit log' },
  { to: '/admin/system', label: 'System health' },
  { to: '/admin/platform', label: 'Platform', owner: true },
  { to: '/admin/admins', label: 'Admins', owner: true },
];

export default function AdminLayout() {
  const { user, loading, signOut } = useAuth();
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'login' | 'error'>('loading');

  useEffect(() => {
    if (loading) return;
    if (!user) return setState('login');
    adminGet<Me>('/me')
      .then((m) => {
        if (!m.mfa.verified) return setState('login');
        setMe(m);
        setState('ok');
      })
      .catch((e) => setState(e instanceof AdminApiError && (e.status === 401 || e.status === 403) ? 'login' : 'error'));
  }, [user, loading]);

  if (state === 'loading') return <div className="p-8 text-sm text-slate-500">Loading…</div>;
  if (state === 'login') return <Navigate to="/admin/login" replace />;
  if (state === 'error' || !me) return <div className="p-8 text-sm text-red-600">The admin API is unreachable. Try again shortly.</div>;

  return (
    <MeContext.Provider value={me}>
      <StepUpProvider>
        <div className="min-h-screen bg-slate-50 text-slate-900 md:flex">
          <aside className="border-b bg-white md:min-h-screen md:w-60 md:border-b-0 md:border-r">
            <div className="px-5 py-4">
              <div className="text-lg font-semibold">Fyllo admin</div>
              <div className="mt-0.5 text-xs text-slate-500">
                {me.email} · <span className="uppercase tracking-wide">{me.role}</span>
              </div>
            </div>
            <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible">
              {NAV.filter((n) => !n.owner || isOwner(me.role)).map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) =>
                    `whitespace-nowrap rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`
                  }
                >
                  {n.label}
                </NavLink>
              ))}
            </nav>
            <div className="hidden px-3 pt-4 md:block">
              <Button variant="outline" size="sm" className="w-full" onClick={() => signOut()}>Sign out</Button>
            </div>
          </aside>
          <main className="min-w-0 flex-1 p-4 md:p-8">
            <Outlet />
          </main>
        </div>
      </StepUpProvider>
    </MeContext.Provider>
  );
}
