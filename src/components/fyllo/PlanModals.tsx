import { useState } from 'react';
import { Interval, usePlan } from './usePlan';
import './fyllo.css';

const COMPARE = [
  ['Saved profiles', '1', 'Unlimited'],
  ['Autofills', '5 / month', 'Unlimited'],
  ['AI assistance', 'Limited', 'Full'],
  ['Support', 'Standard', 'Priority'],
];

export function UsageDots({ used, cap }: { used: number; cap: number | null }) {
  const n = cap ?? 5;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${n},1fr)`, gap: 6 }} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => <span key={i} style={{ height: 6, borderRadius: 6, background: i < used ? '#8A2BE2' : 'rgba(138,43,226,.18)' }} />)}
    </div>
  );
}

function Modal({ onClose, labelId, children }: { onClose: () => void; labelId: string; children: React.ReactNode }) {
  return (
    <div className="fy" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, minHeight: 0, background: 'rgba(23,19,33,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, animation: 'fyIn .15s ease-out' }}>
      <div role="dialog" aria-modal="true" aria-labelledby={labelId} onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, maxHeight: 'calc(100vh - 40px)', overflow: 'auto', borderRadius: 24, background: '#fff', boxShadow: '0 40px 80px -24px rgba(23,19,33,.45)', padding: 'clamp(22px,4vw,32px)', display: 'flex', flexDirection: 'column', gap: 22, position: 'relative' }}>
        <button type="button" onClick={onClose} aria-label="Close" className="fy-btn fy-ghost" style={{ position: 'absolute', top: 14, right: 14, width: 36, height: 36, borderRadius: '50%', color: '#6C6577', fontSize: 20 }}>×</button>
        {children}
      </div>
    </div>
  );
}

export function UpgradeModal({ onClose, plan }: { onClose: () => void; plan: ReturnType<typeof usePlan> }) {
  const [interval, setInterval] = useState<Interval>('month');
  const { usage, billingLoading, upgrade } = plan;
  const opts: { k: Interval; label: string; sub: string }[] = [
    { k: 'month', label: 'Monthly', sub: '$9 per month' },
    { k: 'year', label: 'Yearly', sub: '$90 per year · save 17%' },
  ];
  return (
    <Modal onClose={onClose} labelId="modal-title">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 32 }}>
          <h2 id="modal-title" className="sg" style={{ margin: 0, fontWeight: 500, fontSize: 30, lineHeight: 1.05, letterSpacing: '-0.03em' }}>Apply without limits.</h2>
          <p style={{ margin: 0, fontSize: 15, color: '#6C6577' }}>{usage.cap != null ? `${usage.used} of ${usage.cap} autofills used this month` : `${usage.used} autofills this month`}</p>
        </div>
        {usage.cap != null && <UsageDots used={usage.used} cap={usage.cap} />}
        <div style={{ borderRadius: 16, border: '1px solid rgba(23,19,33,.08)', overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px', gap: 8, padding: '10px 16px', background: '#FAF8FC', fontSize: 12, fontWeight: 500, color: '#6C6577' }}><span /><span>Free</span><span style={{ color: '#4B0082' }}>Pro</span></div>
          {COMPARE.map(([k, f, p]) => (
            <div key={k} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 90px', gap: 8, padding: '12px 16px', borderTop: '1px solid rgba(23,19,33,.06)', fontSize: 14 }}><span>{k}</span><span style={{ color: '#6C6577' }}>{f}</span><span style={{ fontWeight: 500 }}>{p}</span></div>
          ))}
        </div>
        <div role="radiogroup" aria-label="Billing period" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {opts.map((o) => {
            const sel = interval === o.k;
            return (
              <button key={o.k} type="button" role="radio" aria-checked={sel} onClick={() => setInterval(o.k)} style={{ textAlign: 'left', padding: '14px 16px', borderRadius: 14, border: `1.5px solid ${sel ? '#8A2BE2' : 'rgba(23,19,33,.14)'}`, background: sel ? '#FBF8FE' : '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2, color: '#171321' }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{o.label}</span><span style={{ fontSize: 13, color: '#6C6577' }}>{o.sub}</span>
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button type="button" className="fy-btn fy-primary" disabled={billingLoading !== null} onClick={() => upgrade(interval)} style={{ height: 52, borderRadius: 999, fontSize: 16 }}>
            {billingLoading === interval ? 'Redirecting to checkout…' : `Upgrade to Pro — ${interval === 'month' ? '$9/month' : '$90/year'}`}
          </button>
          <span style={{ textAlign: 'center', fontSize: 13, color: '#6C6577' }}>Secure checkout with Stripe. Cancel anytime.</span>
        </div>
      </div>
    </Modal>
  );
}

export function BillingModal({ onClose, plan }: { onClose: () => void; plan: ReturnType<typeof usePlan> }) {
  const { currentPeriodEnd, billingLoading, openPortal } = plan;
  const next = currentPeriodEnd ? new Date(currentPeriodEnd).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
  const busy = billingLoading === 'portal';
  return (
    <Modal onClose={onClose} labelId="modal-title">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        <h2 id="modal-title" className="sg" style={{ margin: 0, paddingRight: 32, fontWeight: 500, fontSize: 28, letterSpacing: '-0.03em' }}>Plan &amp; billing</h2>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '14px 0', borderTop: '1px solid rgba(23,19,33,.07)', fontSize: 14 }}><span style={{ color: '#6C6577' }}>Plan</span><span style={{ fontWeight: 500 }}>Pro</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '14px 0', borderTop: '1px solid rgba(23,19,33,.07)', fontSize: 14 }}><span style={{ color: '#6C6577' }}>Current period ends</span><span style={{ fontWeight: 500 }}>{next}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '14px 0', borderTop: '1px solid rgba(23,19,33,.07)', borderBottom: '1px solid rgba(23,19,33,.07)', fontSize: 14 }}>
            <span style={{ color: '#6C6577' }}>Payment method, invoices &amp; cancellation</span>
            <button type="button" disabled={busy} onClick={openPortal} style={{ border: 0, background: 'none', padding: 0, fontSize: 14, fontWeight: 500, color: '#4B0082', cursor: 'pointer' }}>{busy ? 'Opening…' : 'Open Stripe portal'}</button>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="fy-btn fy-dark" onClick={onClose} style={{ height: 44, padding: '0 22px', borderRadius: 999, fontSize: 14 }}>Done</button>
        </div>
      </div>
    </Modal>
  );
}
