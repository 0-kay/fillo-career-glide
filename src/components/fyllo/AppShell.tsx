import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { usePlan } from './usePlan';
import { BillingModal, UpgradeModal } from './PlanModals';
import './fyllo.css';

export type ShellPlan = ReturnType<typeof usePlan>;

/** Signed-in app chrome from the Fyllo design: sticky header, tabs, usage pill, account menu, plan modals. */
export default function AppShell({ children, plan: planProp, upgradeRef }: {
  children: React.ReactNode | ((ctx: { openUpgrade: () => void; openBilling: () => void; plan: ShellPlan }) => React.ReactNode);
  plan?: ShellPlan;
  upgradeRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const own = usePlan();
  const plan = planProp ?? own;
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menu, setMenu] = useState(false);
  const [modal, setModal] = useState<'upgrade' | 'billing' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const name = (user?.user_metadata?.full_name as string | undefined) || '';
  const initials = (name || user?.email || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
  const openUpgrade = () => { setMenu(false); setModal('upgrade'); };
  if (upgradeRef) upgradeRef.current = openUpgrade;

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [menu]);

  const tabs: [string, string, boolean][] = [
    ['/dashboard', 'Profiles', pathname.startsWith('/dashboard') || pathname.startsWith('/profile')],
    ['/settings', 'Settings', pathname.startsWith('/settings')],
  ];
  const item = { textAlign: 'left' as const, height: 40, padding: '0 12px', borderRadius: 10, fontSize: 14 };
  const usageShort = plan.usage.cap != null ? `${plan.usage.used}/${plan.usage.cap} autofills` : `${plan.usage.used} autofills`;

  return (
    <div className="fy" style={{ display: 'flex', flexDirection: 'column' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 40, background: 'rgba(252,251,254,.9)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(23,19,33,.07)' }}>
        <nav aria-label="App" style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', height: 64, display: 'flex', alignItems: 'center', gap: 20 }}>
          <Link to="/dashboard" aria-label="Fyllo — your dashboard" style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
            <img src="/fyllo-mark.png" alt="" style={{ width: 28, height: 28 }} />
            <span className="sg" style={{ fontWeight: 600, fontSize: 19, letterSpacing: '-0.02em' }}>Fyllo</span>
          </Link>
          <div style={{ flex: 1, display: 'flex', gap: 4, height: 40, overflow: 'hidden', flexWrap: 'wrap' }}>
            {tabs.map(([to, label, cur]) => (
              <Link key={to} to={to} aria-current={cur ? 'page' : undefined} style={{ height: 40, padding: '0 14px', display: 'flex', alignItems: 'center', borderRadius: 999, background: cur ? '#F5F1FB' : 'transparent', color: cur ? '#171321' : '#6C6577', fontSize: 14, fontWeight: 500 }}>{label}</Link>
            ))}
          </div>
          {!plan.isPro && (
            <button type="button" onClick={openUpgrade} style={{ flex: 'none', height: 34, padding: '0 12px', border: '1px solid rgba(23,19,33,.12)', borderRadius: 999, background: '#fff', fontSize: 13, color: '#171321', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
              <span style={{ color: '#6C6577' }}>{usageShort}</span><span style={{ fontWeight: 500, color: '#8A2BE2' }}>Upgrade</span>
            </button>
          )}
          <div ref={menuRef} style={{ position: 'relative', flex: 'none' }}>
            <button type="button" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label="Account menu" style={{ width: 38, height: 38, borderRadius: '50%', border: 0, background: '#171321', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>{initials}</button>
            {menu && (
              <div role="menu" style={{ position: 'absolute', right: 0, top: 48, width: 240, borderRadius: 16, background: '#fff', border: '1px solid rgba(23,19,33,.08)', boxShadow: '0 20px 48px -16px rgba(23,19,33,.25)', padding: 8, display: 'flex', flexDirection: 'column', animation: 'fyIn .15s ease-out' }}>
                <div style={{ padding: '10px 12px 12px', borderBottom: '1px solid rgba(23,19,33,.06)', marginBottom: 6 }}>
                  {name && <div style={{ fontSize: 14, fontWeight: 500 }}>{name}</div>}
                  <div style={{ fontSize: 12, color: '#6C6577', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</div>
                </div>
                <button type="button" role="menuitem" className="fy-btn fy-ghost" style={{ ...item, justifyContent: 'flex-start' }} onClick={() => navigate('/settings')}>Settings</button>
                <button type="button" role="menuitem" className="fy-btn fy-ghost" style={{ ...item, justifyContent: 'flex-start' }} onClick={() => { setMenu(false); setModal(plan.isPro ? 'billing' : 'upgrade'); }}>Plans &amp; billing</button>
                <button type="button" role="menuitem" className="fy-btn fy-ghost" style={{ ...item, justifyContent: 'flex-start' }} onClick={async () => { await signOut(); navigate('/'); }}>Sign out</button>
              </div>
            )}
          </div>
        </nav>
      </header>
      {typeof children === 'function' ? (children as any)({ openUpgrade, openBilling: () => setModal('billing'), plan }) : children}
      {modal === 'upgrade' && <UpgradeModal onClose={() => setModal(null)} plan={plan} />}
      {modal === 'billing' && <BillingModal onClose={() => setModal(null)} plan={plan} />}
    </div>
  );
}
