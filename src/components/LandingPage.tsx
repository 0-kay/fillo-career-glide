import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import './landing.css';

const P = '#8A2BE2';
const MUTED = '#6C6577';
const INK = '#171321';

const TEXT = [
  { label: 'First name', value: 'Alexandra' },
  { label: 'Last name', value: 'Chen' },
  { label: 'Email', value: 'alex.chen@gmail.com' },
  { label: 'Phone', value: '(415) 555-0148' },
  { label: 'Location (city)', value: 'San Francisco, CA' },
  { label: 'LinkedIn profile', value: 'linkedin.com/in/alexandrachen' },
  { label: 'Website or portfolio', value: 'github.com/alexchen', full: true },
];
const QS = [
  { q: 'Are you legally authorized to work in the United States?', opts: ['Yes', 'No'], a: 'Yes' },
  { q: 'Will you now or in the future require visa sponsorship?', opts: ['Yes', 'No'], a: 'No' },
];
const VET = 'I am not a protected veteran';
const TOTAL = 11, START = 120, GAP = 150, DUR = 300, END = START + (TOTAL - 1) * GAP + DUR;
const NAMES = [
  { label: 'First name *', value: 'Alexandra' },
  { label: 'Legal first name', value: 'Alexandra' },
  { label: 'Given name(s)', value: 'Alexandra' },
  { label: 'Full name', value: 'Alexandra Chen' },
  { label: 'Name as it appears on your ID', value: 'Alexandra Chen' },
  { label: 'Preferred name', value: 'Alex' },
];
const STEPS = [
  { n: '01', title: 'Upload your résumé once', body: 'Fyllo parses it into a structured profile — contact details, links, experience, education. Fix anything it got wrong, and it stays fixed.' },
  { n: '02', title: 'Keep a profile for each kind of role', body: 'Applying for design and research roles? Keep a profile for each and pick the right one per application.' },
  { n: '03', title: 'Open an application. Click Fill.', body: 'The extension finds the fields, matches them to your profile and fills them in. You check it over, then submit.' },
];
const PARSED = [
  ['Name', 'Alexandra Chen'], ['Email', 'alex.chen@gmail.com'], ['Phone', '(415) 555-0148'],
  ['LinkedIn', 'linkedin.com/in/alexandrachen'], ['Experience', 'Product Designer · 6 years'], ['Education', 'B.Des, Interaction Design'],
];
const SCREENING = [
  ['Are you authorized to work lawfully in the United States?', 'Yes'],
  ['Do you now or in the future require visa sponsorship?', 'No'],
  ['Please select your protected veteran status.', 'Not a protected veteran'],
  ['Are you willing to undergo a background check?', 'Yes'],
  ['What are your salary expectations?', '$150,000'],
];
const TRUST = [
  ['You press Fill', 'Fyllo never fills silently or in the background. Nothing is written to a page until you ask.'],
  ['Preview first', 'Detect Fields shows exactly what Fyllo recognizes on a page before anything is filled.'],
  ['The form, not the page', 'Fyllo reads field labels and types — not full page content or your browsing history.'],
  ['Never sold', "Your data isn't sold or shared with advertisers or data brokers."],
  ['Yours to delete', 'Remove your account and everything in it from Settings, any time.'],
];
const DETECTED = [
  ['Legal first name', 'First name'], ['Surname', 'Last name'], ['Email address', 'Email'],
  ['Mobile number', 'Phone'], ['Require sponsorship?', 'Screening answer · No'], ['Expected graduation', 'Not in profile'],
];
const FREE = ['1 saved profile', '5 autofills per month', 'Limited AI assistance', 'Chrome extension access'];
const PRO = ['Unlimited profiles', 'Unlimited autofills', 'Full AI assistance', 'Priority support'];

const Arrow = ({ s = 18 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
);
const Check = ({ s = 10, w = 3.5 }: { s?: number; w?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
);
const Dot = ({ on, size = 18 }: { on: boolean; size?: number }) => (
  <span aria-hidden="true" style={{ position: 'absolute', right: 12, width: size, height: size, borderRadius: '50%', background: P, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: on ? 1 : 0, transform: `scale(${on ? 1 : 0.4})`, transition: 'opacity .3s,transform .35s cubic-bezier(.3,1.6,.5,1)' }}><Check /></span>
);
const label12: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: MUTED };
const eyebrow: React.CSSProperties = { fontSize: 13, fontWeight: 500, color: P };
const lead: React.CSSProperties = { margin: 0, fontSize: 17, lineHeight: 1.65, color: MUTED, textWrap: 'pretty' };

const look = (p: number) => ({
  border: p > 0 && p < 1 ? P : p >= 1 ? 'rgba(138,43,226,.38)' : 'rgba(23,19,33,.13)',
  bg: p > 0 ? '#F7F2FD' : '#FFFFFF',
  done: p >= 1,
});

const LandingPage = () => {
  const { user } = useAuth();
  const [phase, setPhase] = useState<'idle' | 'filling' | 'done'>('idle');
  const [t, setT] = useState(0);
  const [step, setStep] = useState(0);
  const [manual, setManual] = useState(false);
  const [nameK, setNameK] = useState(0);
  const [missed, setMissed] = useState(true);
  const [yearly, setYearly] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const raf = useRef(0);
  const namesRef = useRef<HTMLDivElement>(null);
  const namesVisible = useRef(false);
  const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const mt = setTimeout(() => setMounted(true), 200);
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    const io = new IntersectionObserver((es) => es.forEach((e) => { namesVisible.current = e.isIntersecting; }), { threshold: 0.35 });
    if (namesRef.current) io.observe(namesRef.current);
    const iv = setInterval(() => {
      if (!namesVisible.current) return;
      setNameK((k) => (reduced ? 6 : (k + 1) % 11));
    }, 380);
    return () => { clearTimeout(mt); clearInterval(iv); io.disconnect(); window.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf.current); };
  }, [reduced]);

  const startFill = () => {
    if (phase !== 'idle') return;
    if (reduced) { setPhase('done'); setT(END); return; }
    const t0 = performance.now();
    setPhase('filling'); setT(0);
    const tick = (now: number) => {
      const el = now - t0;
      if (el >= END) { setPhase('done'); setT(END); return; }
      setT(el);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  const reset = () => { cancelAnimationFrame(raf.current); setPhase('idle'); setT(0); };
  const prog = (i: number) => phase === 'idle' ? 0 : phase === 'done' ? 1 : Math.max(0, Math.min(1, (t - (START + i * GAP)) / DUR));
  const filledCount = Array.from({ length: TOTAL }, (_, i) => prog(i)).filter((p) => p >= 1).length;
  const pf = prog(7);
  const pv = prog(10);
  const vet = look(pv);
  const idle = phase === 'idle', done = phase === 'done';
  const signup = '/auth';
  const proPrice = yearly ? '$90' : '$9';

  const navCtas = user ? (
    <Link to="/dashboard" className="dark-btn" style={{ fontSize: 14, fontWeight: 500, padding: '10px 18px', borderRadius: 999, whiteSpace: 'nowrap', textAlign: 'center', transition: 'background .2s' }}>Open dashboard</Link>
  ) : (
    <>
      <Link to="/auth" className="pill" style={{ fontSize: 14, fontWeight: 500, padding: '10px 14px', borderRadius: 999, textAlign: 'center' }}>Sign in</Link>
      <Link to={signup} className="dark-btn" style={{ fontSize: 14, fontWeight: 500, padding: '10px 18px', borderRadius: 999, whiteSpace: 'nowrap', textAlign: 'center', transition: 'background .2s' }}>Get started free</Link>
    </>
  );

  return (
    <div className="fy" id="top">
      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(252,251,254,.88)', backdropFilter: 'saturate(1.4) blur(12px)', WebkitBackdropFilter: 'saturate(1.4) blur(12px)', borderBottom: `1px solid ${scrolled || navOpen ? 'rgba(23,19,33,.08)' : 'rgba(23,19,33,0)'}`, transition: 'border-color .2s' }}>
        <nav aria-label="Main" style={{ maxWidth: 1240, margin: '0 auto', padding: '0 24px', height: 68, display: 'flex', alignItems: 'center', gap: 24 }}>
          <a href="#top" aria-label="Fyllo home" style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
            <img src="/fyllo-mark.png" alt="" style={{ width: 30, height: 30 }} />
            <span className="sg" style={{ fontWeight: 600, fontSize: 21, letterSpacing: '-0.02em' }}>Fyllo</span>
          </a>
          <div className="fy-desk" style={{ flex: 1, justifyContent: 'center', gap: '4px 28px', fontSize: 14, fontWeight: 500 }}>
            <a className="lnk" href="#how">How it works</a>
            <a className="lnk" href="#privacy">Privacy</a>
            <a className="lnk" href="#pricing">Pricing</a>
          </div>
          <div className="fy-desk" style={{ alignItems: 'center', gap: 6, flex: 'none' }}>
            {navCtas}
          </div>
          <button type="button" className="fy-burger" aria-label={navOpen ? 'Close menu' : 'Open menu'} aria-expanded={navOpen} aria-controls="fy-mobile-nav" onClick={() => setNavOpen((o) => !o)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {navOpen ? <><path d="M6 6l12 12" /><path d="M18 6L6 18" /></> : <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>}
            </svg>
          </button>
        </nav>
        {navOpen && (
          <div id="fy-mobile-nav" className="fy-mobile-panel" onClick={() => setNavOpen(false)}>
            <a href="#how">How it works</a>
            <a href="#privacy">Privacy</a>
            <a href="#pricing">Pricing</a>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 12, borderTop: '1px solid rgba(23,19,33,.08)' }}>{navCtas}</div>
          </div>
        )}
      </header>

      <main>
        {/* Hero */}
        <section aria-labelledby="hero-title" style={{ padding: 'clamp(56px,9vw,112px) 24px 0' }}>
          <div style={{ maxWidth: 1240, margin: '0 auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,480px),1fr))', gap: '32px 64px', alignItems: 'end' }}>
              <h1 id="hero-title" className="sg" style={{ margin: 0, fontWeight: 500, fontSize: 'clamp(46px,6.6vw,92px)', lineHeight: 0.98, letterSpacing: '-0.045em', textWrap: 'balance' }}>
                <span>Never type your résumé into a form </span>
                <span style={{ position: 'relative', display: 'inline-block', padding: '0 0.12em', marginLeft: '-0.04em', color: '#fff', whiteSpace: 'nowrap' }}>
                  <span aria-hidden="true" style={{ position: 'absolute', inset: '0.1em -0.02em 0.02em', background: P, transform: `skewX(-14deg) scaleX(${mounted ? 1 : 0})`, transformOrigin: 'left center', transition: 'transform .7s cubic-bezier(.2,.8,.2,1)', borderRadius: 4 }} />
                  <span style={{ position: 'relative' }}>again.</span>
                </span>
              </h1>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 470, paddingBottom: 8 }}>
                <p style={{ margin: 0, fontSize: 'clamp(17px,1.4vw,19px)', lineHeight: 1.6, color: MUTED, textWrap: 'pretty' }}>Fyllo reads the job application in front of you and fills it from your profile — contact details, links, résumé, even the screening questions. You review. You submit.</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px' }}>
                  <Link to={signup} className="btn-p" style={{ height: 52, padding: '0 26px', fontSize: 16 }}>Get started free<Arrow /></Link>
                  <span style={{ fontSize: 14, color: MUTED }}>Chrome extension · No card needed</span>
                </div>
              </div>
            </div>

            {/* Demo */}
            <div style={{ marginTop: 'clamp(48px,7vw,88px)' }}>
              <div role="region" aria-label="Interactive Fyllo demo" style={{ borderRadius: 20, border: '1px solid rgba(23,19,33,.09)', background: '#fff', overflow: 'hidden', boxShadow: '0 1px 2px rgba(23,19,33,.04),0 32px 72px -32px rgba(75,0,130,.22)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', background: '#F6F4F9', borderBottom: '1px solid rgba(23,19,33,.07)' }}>
                  <div style={{ display: 'flex', gap: 7, flex: 'none' }} aria-hidden="true">
                    {[0, 1, 2].map((i) => <span key={i} style={{ width: 11, height: 11, borderRadius: '50%', background: '#DCD7E2' }} />)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 14px', borderRadius: 999, background: '#fff', border: '1px solid rgba(23,19,33,.06)', fontSize: 13, color: MUTED, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>jobs.greenhouse.io/northwind/apply/senior-product-designer</span>
                  </div>
                  <div aria-hidden="true" style={{ flex: 'none', width: 32, height: 32, borderRadius: 9, background: '#fff', border: '1px solid rgba(138,43,226,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 3px rgba(138,43,226,.10)' }}>
                    <img src="/fyllo-mark.png" alt="" style={{ width: 20, height: 20 }} />
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'row-reverse', flexWrap: 'wrap', alignItems: 'flex-start', background: '#fff' }}>
                  <div style={{ flex: '1 1 260px', maxWidth: '100%', padding: '16px 16px 0' }}>
                    <div style={{ borderRadius: 16, border: '1px solid rgba(23,19,33,.08)', background: '#fff', boxShadow: '0 18px 40px -18px rgba(23,19,33,.22)', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <img src="/fyllo-mark.png" alt="" style={{ width: 24, height: 24 }} />
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span className="sg" style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.1 }}>Fyllo</span>
                          <span style={{ fontSize: 11, color: MUTED }}>Auto-Fill Assistant</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 500, color: MUTED }}>Profile</span>
                        <div style={{ display: 'flex', alignItems: 'center', height: 38, padding: '0 12px', borderRadius: 10, border: '1px solid rgba(23,19,33,.12)', fontSize: 13, fontWeight: 500 }}>Product Design</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, background: '#F5F1FB' }}>
                        <div style={{ width: 34, height: 34, flex: 'none', borderRadius: '50%', background: '#fff', color: '#4B0082', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>AC</div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>Alexandra Chen</div>
                          <div style={{ fontSize: 11, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>alex.chen@gmail.com</div>
                        </div>
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#4B0082', background: '#fff', padding: '3px 8px', borderRadius: 999 }}>92%</span>
                      </div>
                      <button type="button" onClick={() => (done ? reset() : startFill())} aria-live="polite" style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, border: 0, borderRadius: 12, background: done ? INK : P, color: '#fff', fontSize: 14, fontWeight: 500, cursor: 'pointer', transition: 'background .25s' }}>
                        {idle && <span aria-hidden="true" style={{ position: 'absolute', inset: 0, borderRadius: 12, animation: 'fyPulse 1.8s ease-out infinite' }} />}
                        {done ? <Check s={16} w={2.5} /> : <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>}
                        <span>{idle ? 'Fill application form' : phase === 'filling' ? `Filling ${Math.max(filledCount, 1)} of ${TOTAL}…` : `Filled ${TOTAL} of ${TOTAL}`}</span>
                      </button>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: MUTED }}>
                        <span>{done ? 'Review, then submit.' : phase === 'filling' ? 'Matching to your profile' : '11 fields detected'}</span>
                        {done && <button type="button" onClick={reset} style={{ border: 0, background: 'none', padding: '4px 0', fontSize: 12, fontWeight: 500, color: '#4B0082', cursor: 'pointer' }}>Reset</button>}
                      </div>
                    </div>
                  </div>

                  <form onSubmit={(e) => e.preventDefault()} style={{ flex: '999 1 420px', minWidth: 0, padding: 'clamp(20px,3.4vw,40px)', display: 'flex', flexDirection: 'column', gap: 28 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div aria-hidden="true" className="sg" style={{ width: 44, height: 44, borderRadius: 12, background: INK, color: '#fff', fontWeight: 600, fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>N</div>
                      <div>
                        <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}>Senior Product Designer</div>
                        <div style={{ fontSize: 13, color: MUTED }}>Northwind · San Francisco · Full-time</div>
                      </div>
                    </div>
                    <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '16px 18px' }}>
                      <legend style={{ ...label12, padding: 0, marginBottom: 14 }}>Personal information</legend>
                      {TEXT.map((f, i) => {
                        const p = prog(i); const l = look(p);
                        return (
                          <label key={f.label} style={{ display: 'flex', flexDirection: 'column', gap: 7, gridColumn: f.full ? '1 / -1' : 'auto' }}>
                            <span style={{ fontSize: 13, fontWeight: 500 }}>{f.label}</span>
                            <span style={{ position: 'relative', display: 'flex', alignItems: 'center', height: 44, padding: '0 38px 0 14px', borderRadius: 10, border: `1px solid ${l.border}`, background: l.bg, fontSize: 14, transition: 'background .35s,border-color .35s', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.value.slice(0, Math.round(p * f.value.length))}</span>
                              {p > 0 && p < 1 && <span aria-hidden="true" style={{ width: 1.5, height: 18, background: P, marginLeft: 1, animation: 'fyBlink .8s steps(1) infinite' }} />}
                              <Dot on={l.done} />
                            </span>
                          </label>
                        );
                      })}
                    </fieldset>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <span style={label12}>Résumé / CV</span>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '10px 14px', borderRadius: 12, border: `1px ${pf > 0 ? 'solid' : 'dashed'} ${pf > 0 ? 'rgba(138,43,226,.38)' : 'rgba(23,19,33,.2)'}`, background: look(pf).bg, transition: 'background .35s,border-color .35s' }}>
                        <div aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 8, background: '#fff', border: '1px solid rgba(23,19,33,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4B0082', flex: 'none', fontSize: 9, fontWeight: 600 }}>PDF</div>
                        <div style={{ flex: 1, minWidth: 0, fontSize: 14, color: pf > 0.3 ? INK : MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pf > 0.3 ? 'Alexandra_Chen_Resume.pdf' : 'Attach résumé'}</div>
                        <span style={{ position: 'relative', width: 18, height: 18, flex: 'none' }}><Dot on={pf >= 1} /></span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                      <span style={label12}>Application questions</span>
                      {QS.map((q, qi) => {
                        const p = prog(8 + qi);
                        return (
                          <div key={q.q} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <span style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.45 }}>{q.q}</span>
                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                              {q.opts.map((o) => {
                                const sel = p > 0.4 && o === q.a;
                                return (
                                  <span key={o} style={{ display: 'flex', alignItems: 'center', gap: 9, height: 40, padding: '0 16px 0 12px', borderRadius: 999, border: `1px solid ${sel ? P : 'rgba(23,19,33,.14)'}`, background: sel ? '#F7F2FD' : '#fff', fontSize: 14, transition: 'background .3s,border-color .3s' }}>
                                    <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: '50%', border: `1.5px solid ${sel ? P : 'rgba(23,19,33,.3)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: P, opacity: sel ? 1 : 0, transition: 'opacity .25s' }} /></span>
                                    {o}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 7, maxWidth: 420 }}>
                        <span style={{ fontSize: 14, fontWeight: 500 }}>Protected veteran status</span>
                        <span style={{ display: 'flex', alignItems: 'center', height: 44, padding: '0 14px', borderRadius: 10, border: `1px solid ${vet.border}`, background: vet.bg, fontSize: 14, color: pv > 0.3 ? INK : MUTED, transition: 'background .35s,border-color .35s' }}>{pv > 0.3 ? VET : 'Select…'}</span>
                      </label>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', paddingTop: 20, borderTop: '1px solid rgba(23,19,33,.07)' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', height: 44, padding: '0 20px', borderRadius: 10, background: INK, color: '#fff', fontSize: 14, fontWeight: 500 }}>Submit application</span>
                      <span style={{ fontSize: 13, color: MUTED }}>Fyllo never presses this. You do.</span>
                    </div>
                  </form>
                </div>
              </div>
              <p aria-live="polite" style={{ margin: '18px 0 0', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, textAlign: 'center', fontSize: 14, color: MUTED, minHeight: 22 }}>
                <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: P, flex: 'none' }} />
                {idle ? 'Try it — press Fill in the Fyllo panel.' : phase === 'filling' ? 'Reading each field and matching it to your profile…' : `11 fields, résumé and screening questions filled in ${(END / 1000).toFixed(1)} seconds.`}
              </p>
            </div>

            <div className="sg" style={{ margin: 'clamp(40px,6vw,64px) auto 0', maxWidth: 980, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'baseline', gap: '10px 28px', fontSize: 'clamp(17px,1.8vw,22px)', fontWeight: 500, letterSpacing: '-0.02em', color: '#9C97A6' }}>
              <span style={{ fontFamily: 'Poppins,sans-serif', fontSize: 13, letterSpacing: 0, color: MUTED }}>Works where you apply</span>
              {['Workday', 'Greenhouse', 'Lever', 'iCIMS', 'Ashby', 'SmartRecruiters', 'Jobvite', 'Company career sites'].map((n) => <span key={n}>{n}</span>)}
            </div>
          </div>
        </section>

        {/* Problem */}
        <section aria-labelledby="same-q" style={{ padding: 'clamp(96px,14vw,176px) 24px' }}>
          <div style={{ maxWidth: 1240, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: '56px 88px', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 500 }}>
              <span style={eyebrow}>The problem</span>
              <h2 id="same-q" className="h2">Six ways to ask your name. One of you.</h2>
              <p style={lead}>Every application platform words the same question a little differently, so you end up answering it again and again. Fyllo reads what each field is actually asking — and answers from a single profile.</p>
            </div>
            <div ref={namesRef} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: '22px 20px' }}>
              {NAMES.map((n, i) => {
                const on = i < Math.min(nameK, 6);
                return (
                  <div key={n.label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{n.label}</span>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 48, padding: '0 14px', borderRadius: 12, border: `1px solid ${on ? 'rgba(138,43,226,.38)' : 'rgba(23,19,33,.13)'}`, background: on ? '#F7F2FD' : '#fff', fontSize: 15, transition: 'background .35s,border-color .35s' }}>
                      <span style={{ opacity: on ? 1 : 0, transform: `translateY(${on ? 0 : 4}px)`, transition: 'opacity .3s,transform .35s' }}>{n.value}</span>
                      <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: '50%', background: P, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: on ? 1 : 0, transition: 'opacity .3s' }}><Check /></span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" aria-labelledby="how-title" style={{ padding: 'clamp(88px,12vw,152px) 24px', background: '#F5F1FB' }}>
          <div style={{ maxWidth: 1240, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'clamp(40px,6vw,72px)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'end', gap: '20px 48px' }}>
              <h2 id="how-title" className="h2" style={{ maxWidth: 640 }}>Set up once. Then it's one click, forever.</h2>
              <p style={{ margin: 0, maxWidth: 360, fontSize: 17, lineHeight: 1.6, color: MUTED }}>About five minutes of setup. Every application after that takes seconds.</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))', gap: '40px 72px', alignItems: 'center' }}>
              <ol aria-label="How Fyllo works" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
                {STEPS.map((s, i) => {
                  const active = i === step;
                  return (
                    <li key={s.n} style={{ borderTop: '1px solid rgba(23,19,33,.10)', position: 'relative' }}>
                      <button type="button" aria-current={active} onClick={() => { setStep(i); setManual(true); }} style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, padding: '26px 0 28px', cursor: 'pointer', display: 'grid', gridTemplateColumns: '44px 1fr', gap: '4px 12px', color: active ? INK : MUTED, transition: 'color .3s' }}>
                        <span className="sg" style={{ fontSize: 15, fontWeight: 500, paddingTop: 5 }}>{s.n}</span>
                        <span className="sg" style={{ fontSize: 'clamp(22px,2.2vw,28px)', fontWeight: 500, letterSpacing: '-0.025em', lineHeight: 1.2 }}>{s.title}</span>
                        {active && <span style={{ gridColumn: 2, fontSize: 16, lineHeight: 1.6, color: MUTED, maxWidth: 440, textWrap: 'pretty' }}>{s.body}</span>}
                      </button>
                      {active && !manual && !reduced && (
                        <span aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, top: -1, height: 2, background: P, transformOrigin: 'left', animation: 'fyProgress 5.5s linear forwards' }} onAnimationEnd={() => setStep((x) => (x + 1) % 3)} />
                      )}
                    </li>
                  );
                })}
              </ol>

              <div style={{ minHeight: 420, borderRadius: 24, background: '#fff', border: '1px solid rgba(23,19,33,.07)', padding: 'clamp(20px,3.5vw,40px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {step === 0 && (
                  <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, border: '1px dashed rgba(138,43,226,.45)', background: '#FBF8FE' }}>
                      <div style={{ width: 40, height: 48, borderRadius: 6, background: '#fff', border: '1px solid rgba(23,19,33,.1)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 6, fontSize: 9, fontWeight: 600, color: '#4B0082', flex: 'none' }}>PDF</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Alexandra_Chen_Resume.pdf</div>
                        <div style={{ fontSize: 12, color: MUTED }}>Parsed into your profile</div>
                      </div>
                    </div>
                    <div style={{ borderRadius: 14, border: '1px solid rgba(23,19,33,.08)', overflow: 'hidden' }}>
                      {PARSED.map(([k, v]) => (
                        <div key={k} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 18px', gap: 12, alignItems: 'center', padding: '12px 16px', borderTop: '1px solid rgba(23,19,33,.06)', fontSize: 14 }}>
                          <span style={{ color: MUTED, fontSize: 13 }}>{k}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v}</span>
                          <span style={{ color: P }}><Check s={16} w={2.5} /></span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {step === 1 && (
                  <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[{ name: 'Product Design', pct: '92%', initial: 'P', chip: P, border: 'rgba(138,43,226,.45)', bg: '#FBF8FE' }, { name: 'UX Research', pct: '78%', initial: 'U', chip: INK, border: 'rgba(23,19,33,.08)', bg: '#fff' }].map((pr) => (
                      <div key={pr.name} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 18, borderRadius: 16, border: `1px solid ${pr.border}`, background: pr.bg }}>
                        <div className="sg" style={{ width: 42, height: 42, borderRadius: 12, background: pr.chip, color: '#fff', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{pr.initial}</div>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 15, fontWeight: 500 }}><span>{pr.name}</span><span style={{ fontSize: 13, color: MUTED, fontWeight: 400 }}>{pr.pct} complete</span></div>
                          <div style={{ height: 4, borderRadius: 4, background: 'rgba(23,19,33,.07)', overflow: 'hidden' }}><div style={{ height: '100%', width: pr.pct, background: P, borderRadius: 4 }} /></div>
                        </div>
                      </div>
                    ))}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 56, borderRadius: 16, border: '1px dashed rgba(23,19,33,.18)', fontSize: 14, color: MUTED }}>+ New profile</div>
                  </div>
                )}
                {step === 2 && (
                  <div style={{ width: '100%', maxWidth: 440, display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
                    <div style={{ borderRadius: 16, border: '1px solid rgba(23,19,33,.08)', padding: 18, display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12 }}>
                      {[['First name', 'Alexandra'], ['Last name', 'Chen'], ['Email', 'alex.chen@gmail.com'], ['Sponsorship', 'No']].map(([k, v]) => (
                        <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <span style={{ fontSize: 11, color: MUTED }}>{k}</span>
                          <span style={{ height: 34, borderRadius: 8, border: '1px solid rgba(138,43,226,.35)', background: '#F7F2FD', fontSize: 12, display: 'flex', alignItems: 'center', padding: '0 10px', overflow: 'hidden', whiteSpace: 'nowrap' }}>{v}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 16, background: INK, color: '#fff' }}>
                      <img src="/fyllo-mark.png" alt="" style={{ width: 26, height: 26, background: '#fff', borderRadius: 7, padding: 3 }} />
                      <div style={{ flex: 1, fontSize: 14 }}>Filled 11 of 11 fields</div>
                      <span style={{ fontSize: 12, color: '#CFC8DA' }}>Ready to review</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Screening */}
        <section aria-labelledby="dread" style={{ padding: 'clamp(96px,14vw,176px) 24px' }}>
          <div style={{ maxWidth: 1240, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: '56px 88px', alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 480 }} className="fy-sticky">
              <span style={eyebrow}>Beyond name and email</span>
              <h2 id="dread" className="h2">Answers the questions you dread, too.</h2>
              <p style={lead}>Work authorization, sponsorship, veteran and disability status, salary expectations. Save your answers once — Fyllo recognizes the question however it's phrased.</p>
              <p style={lead}>And when a form asks for something your profile doesn't have, Fyllo tells you, so you only ever type it once.</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ borderRadius: 20, border: '1px solid rgba(23,19,33,.08)', background: '#fff', overflow: 'hidden' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', borderBottom: '1px solid rgba(23,19,33,.06)' }}>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>Screening answers</span>
                  <span style={{ fontSize: 12, color: MUTED }}>Used on every application</span>
                </div>
                {SCREENING.map(([q, a]) => (
                  <div key={q} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, padding: '16px 22px', borderTop: '1px solid rgba(23,19,33,.05)' }}>
                    <span style={{ fontSize: 14, lineHeight: 1.45, textWrap: 'pretty' }}>{q}</span>
                    <span style={{ flex: 'none', fontSize: 13, fontWeight: 500, color: '#4B0082', background: '#F5F1FB', padding: '6px 12px', borderRadius: 999, maxWidth: '45%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a}</span>
                  </div>
                ))}
              </div>
              <div role="status" style={{ borderRadius: 20, border: '1px solid rgba(23,19,33,.08)', background: '#fff', padding: 22 }}>
                {missed ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                      <img src="/fyllo-mark.png" alt="" style={{ width: 28, height: 28, flex: 'none' }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: 15, fontWeight: 500 }}>One field wasn't in your profile</span>
                        <span style={{ fontSize: 14, lineHeight: 1.55, color: MUTED }}>“Expected graduation date” on jobs.lever.co. Add it once and Fyllo fills it next time.</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingLeft: 42 }}>
                      <div style={{ flex: '1 1 180px', height: 42, borderRadius: 10, border: '1px solid rgba(23,19,33,.14)', display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 14 }}>May 2019</div>
                      <button type="button" className="btn-p" onClick={() => setMissed(false)} style={{ height: 42, padding: '0 18px', border: 0, borderRadius: 10, fontSize: 14, cursor: 'pointer' }}>Add to profile</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: '50%', background: P, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Check s={14} w={3} /></span>
                    <span style={{ flex: 1, fontSize: 15 }}>Saved to your Product Design profile. <span style={{ color: MUTED }}>Nothing to type next time.</span></span>
                    <button type="button" onClick={() => setMissed(true)} style={{ border: 0, background: 'none', fontSize: 13, fontWeight: 500, color: '#4B0082', cursor: 'pointer' }}>Undo</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Privacy */}
        <section id="privacy" aria-labelledby="trust" style={{ padding: 'clamp(96px,13vw,168px) 24px', background: INK, color: '#FCFBFE' }}>
          <div style={{ maxWidth: 1240, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', gap: '56px 88px', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                <span style={{ ...eyebrow, color: '#C9A6F4' }}>Privacy and control</span>
                <h2 id="trust" className="h2">Nothing happens until you click.</h2>
              </div>
              <dl style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
                {TRUST.map(([tt, d]) => (
                  <div key={tt} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,180px) 1fr', gap: '6px 28px', padding: '18px 0', borderTop: '1px solid rgba(252,251,254,.12)' }}>
                    <dt style={{ fontSize: 15, fontWeight: 500 }}>{tt}</dt>
                    <dd style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: '#BEB6CB', textWrap: 'pretty' }}>{d}</dd>
                  </div>
                ))}
              </dl>
              <Link to="/privacy" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 500, alignSelf: 'flex-start', borderBottom: '1px solid rgba(252,251,254,.35)', paddingBottom: 3 }}>Read the privacy policy<Arrow s={16} /></Link>
            </div>
            <div style={{ borderRadius: 20, background: '#fff', color: INK, overflow: 'hidden', boxShadow: '0 40px 80px -40px rgba(0,0,0,.6)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 20px', borderBottom: '1px solid rgba(23,19,33,.07)' }}>
                <span style={{ fontSize: 15, fontWeight: 500, flex: 1 }}>Detect fields</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: '#4B0082', background: '#F5F1FB', padding: '4px 10px', borderRadius: 999 }}>10 matched</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: MUTED, background: '#F3F2F5', padding: '4px 10px', borderRadius: 999 }}>1 unmatched</span>
              </div>
              <div style={{ padding: '6px 0' }}>
                {DETECTED.map(([f, to]) => (
                  <div key={f} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 16px minmax(0,1fr)', gap: 12, alignItems: 'center', padding: '11px 20px', fontSize: 13 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f}</span>
                    <span style={{ color: '#9C97A6' }}><Arrow s={14} /></span>
                    <span style={{ color: to === 'Not in profile' ? MUTED : INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{to}</span>
                  </div>
                ))}
              </div>
              <div style={{ padding: '14px 20px', background: '#FAF8FC', borderTop: '1px solid rgba(23,19,33,.06)', fontSize: 13, color: MUTED }}>Preview only — nothing has been written to the page.</div>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" aria-labelledby="price-title" style={{ padding: 'clamp(96px,13vw,168px) 24px' }}>
          <div style={{ maxWidth: 1040, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 56 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'end', gap: 24 }}>
              <h2 id="price-title" className="h2" style={{ maxWidth: 560 }}>Free to start. Simple after that.</h2>
              <div role="group" aria-label="Billing period" style={{ display: 'flex', padding: 4, borderRadius: 999, background: '#F5F1FB' }}>
                {[{ l: 'Monthly', y: false }, { l: 'Yearly · save 17%', y: true }].map((o) => (
                  <button key={o.l} type="button" aria-pressed={yearly === o.y} onClick={() => setYearly(o.y)} style={{ height: 36, padding: '0 16px', border: 0, borderRadius: 999, fontSize: 14, fontWeight: 500, cursor: 'pointer', color: INK, background: yearly === o.y ? '#fff' : 'transparent', boxShadow: yearly === o.y ? '0 1px 3px rgba(23,19,33,.12)' : 'none' }}>{o.l}</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 20 }}>
              <div style={{ borderRadius: 24, border: '1px solid rgba(23,19,33,.09)', background: '#fff', padding: 'clamp(24px,3.4vw,36px)', display: 'flex', flexDirection: 'column', gap: 28 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>Free</span>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><span className="sg" style={{ fontSize: 52, fontWeight: 500, letterSpacing: '-0.04em' }}>$0</span><span style={{ color: MUTED, fontSize: 15 }}>forever</span></div>
                  <span style={{ fontSize: 15, color: MUTED }}>Everything you need to try it properly.</span>
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 15 }}>
                  {FREE.map((f) => <li key={f} style={{ display: 'flex', gap: 12, alignItems: 'center' }}><span style={{ color: MUTED, display: 'flex' }}><Check s={16} w={2.5} /></span>{f}</li>)}
                </ul>
                <Link to={signup} className="pill" style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 50, borderRadius: 999, border: '1px solid rgba(23,19,33,.16)', fontSize: 15, fontWeight: 500 }}>Get started free</Link>
              </div>
              <div style={{ borderRadius: 24, background: INK, color: '#FCFBFE', padding: 'clamp(24px,3.4vw,36px)', display: 'flex', flexDirection: 'column', gap: 28 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>Pro</span>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><span className="sg" style={{ fontSize: 52, fontWeight: 500, letterSpacing: '-0.04em' }}>{proPrice}</span><span style={{ color: '#BEB6CB', fontSize: 15 }}>{yearly ? 'per year' : 'per month'}</span></div>
                  <span style={{ fontSize: 15, color: '#BEB6CB' }}>For when you're applying in earnest.</span>
                </div>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 15 }}>
                  {PRO.map((f) => <li key={f} style={{ display: 'flex', gap: 12, alignItems: 'center' }}><span style={{ color: '#C9A6F4', display: 'flex' }}><Check s={16} w={2.5} /></span>{f}</li>)}
                </ul>
                <Link to={signup} className="btn-p" style={{ marginTop: 'auto', height: 50, fontSize: 15 }}>Start free, upgrade anytime</Link>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section aria-labelledby="final" style={{ padding: '0 24px clamp(96px,12vw,152px)' }}>
          <div style={{ maxWidth: 1240, margin: '0 auto', borderRadius: 32, background: '#F5F1FB', padding: 'clamp(56px,9vw,120px) clamp(24px,6vw,96px)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 32 }}>
            <img src="/fyllo-mark.png" alt="" style={{ width: 56, height: 56 }} />
            <h2 id="final" className="sg" style={{ margin: 0, maxWidth: 820, fontWeight: 500, fontSize: 'clamp(38px,5.2vw,72px)', lineHeight: 1, letterSpacing: '-0.045em', textWrap: 'balance' }}>Your next application is one click away.</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 12 }}>
              <Link to={signup} className="btn-p" style={{ height: 54, padding: '0 28px', fontSize: 16 }}>Get started free<Arrow /></Link>
              {!user && <Link to="/auth" style={{ display: 'inline-flex', alignItems: 'center', height: 54, padding: '0 24px', borderRadius: 999, fontWeight: 500, fontSize: 16 }}>I already have an account</Link>}
            </div>
            <span style={{ fontSize: 14, color: MUTED }}>Free plan includes 5 autofills a month. Works in Chrome.</span>
          </div>
        </section>
      </main>

      <footer style={{ borderTop: '1px solid rgba(23,19,33,.08)', padding: '36px 24px' }}>
        <div style={{ maxWidth: 1240, margin: '0 auto', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/fyllo-mark.png" alt="" style={{ width: 24, height: 24 }} />
            <span className="sg" style={{ fontWeight: 600, fontSize: 17, letterSpacing: '-0.02em' }}>Fyllo</span>
          </div>
          <nav aria-label="Footer" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 28px', fontSize: 14 }}>
            <Link className="lnk" to="/pricing">Pricing</Link>
            <Link className="lnk" to="/privacy">Privacy policy</Link>
            <Link className="lnk" to="/auth">Sign in</Link>
            <span style={{ color: MUTED }}>© 2026 Fyllo</span>
          </nav>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
