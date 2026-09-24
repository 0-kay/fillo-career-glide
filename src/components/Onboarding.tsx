import React, { useCallback, useEffect, useRef, useState } from 'react';
import ResumeUpload, { ResumeUploadEvent } from '@/components/ResumeUpload';
import type { ScreeningAnswer } from '@/components/ScreeningQuestionsDialog';
import { useProfiles } from '@/hooks/useProfiles';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import '@/components/fyllo/fyllo.css';

interface OnboardingProps {
  onComplete: () => void;
}

const STAGES = ['Uploading résumé', 'Getting your name', 'Getting contact details', 'Getting work experience', 'Getting education', 'Synchronizing your profile', 'Saving résumé'];
const OB_LABELS = ['Résumé', 'Questions', 'Extension', 'Review'];

// Design copy shown to the user, mapped onto the question text/keywords the extension already matches on.
const OBQ = [
  { id: 'auth', q: 'Are you authorized to work lawfully in the United States?', full: 'Are you authorized to work lawfully in the United States?', keywords: ['authorized', 'authorization', 'lawfully', 'work', 'united states', 'u.s.', 'us'] },
  { id: 'spons', q: 'Do you now or in the future require visa sponsorship?', full: 'Do you now or in the future require visa sponsorship to maintain work authorization?', keywords: ['visa', 'sponsorship', 'sponsor', 'immigration', 'h-1b', 'employment-based', 'require'] },
  { id: 'age', q: 'Are you at least 18 years of age?', full: 'Are you at least 18 years of age?', keywords: ['age', 'eighteen', 'years'] },
  { id: 'bg', q: 'Are you willing to undergo a background check?', full: 'Are you willing to undergo a background check?', keywords: ['background', 'check', 'willing'] },
];

type UpState = 'idle' | 'busy' | 'done' | 'failed';
type ExtState = 'pending' | 'waiting' | 'ok';
type Review = { first: string; last: string; email: string; phone: string; city: string; linkedin: string; portfolio: string };
const EMPTY_REVIEW: Review = { first: '', last: '', email: '', phone: '', city: '', linkedin: '', portfolio: '' };

const h1Style: React.CSSProperties = { margin: 0, fontWeight: 500, fontSize: 'clamp(34px,4vw,48px)', lineHeight: 1.04, letterSpacing: '-0.035em' };
const kickerStyle: React.CSSProperties = { fontSize: 13, fontWeight: 500, color: '#8A2BE2' };
const subStyle: React.CSSProperties = { margin: 0, fontSize: 17, lineHeight: 1.6, color: '#6C6577' };
const spinner = (size: number, border = 2): React.CSSProperties => ({ width: size, height: size, borderWidth: border });
const chip: React.CSSProperties = { fontSize: 13, padding: '6px 12px', borderRadius: 999, background: '#F5F1FB', color: '#4B0082' };

const Onboarding = ({ onComplete }: OnboardingProps) => {
  const { user } = useAuth();
  const { getProfile, updateProfile } = useProfiles();
  const { toast } = useToast();

  const [step, setStep] = useState(1);
  const [up, setUp] = useState<UpState>('idle');
  const [stage, setStage] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [fileName, setFileName] = useState('');
  const [profileId, setProfileId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | undefined>>({});
  const [customQs, setCustomQs] = useState<{ q: string; a: string }[]>([]);
  const [addingQ, setAddingQ] = useState(false);
  const [draftQ, setDraftQ] = useState('');
  const [draftA, setDraftA] = useState('');
  const [ext, setExt] = useState<ExtState>('pending');
  const [review, setReview] = useState<Review>(EMPTY_REVIEW);
  const [reviewLoaded, setReviewLoaded] = useState(false);
  const [counts, setCounts] = useState({ jobs: 0, degrees: 0, skills: 0, projects: 0 });
  const [dragOver, setDragOver] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const uploadRef = useRef<(f: File) => void>(() => {});
  const fileInput = useRef<HTMLInputElement>(null);
  const profileIdRef = useRef<string | null>(null);

  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const fullName = String(meta.full_name || meta.name || '');
  const firstName = fullName.trim().split(/\s+/)[0] || '';

  // ---- screening answers (also read by the resume pipeline's final save) ----
  const answersRef = useRef<ScreeningAnswer[]>([]);
  const buildAnswers = useCallback((): ScreeningAnswer[] => {
    const list: ScreeningAnswer[] = [];
    OBQ.forEach((q) => {
      const a = answers[q.id];
      if (a) list.push({ id: `ob_${q.id}`, question: q.full, answer: a, answerType: 'yes_no', keywords: q.keywords, enabled: true });
    });
    customQs.forEach((c, i) => {
      const kw = Array.from(new Set(c.q.toLowerCase().replace(/[^a-z0-9\s-]/g, '').split(/\s+/).filter((w) => w.length > 3)));
      list.push({ id: `ob_custom_${i}_${Date.now()}`, question: c.q, answer: c.a, answerType: 'text', keywords: kw, enabled: true });
    });
    return list;
  }, [answers, customQs]);
  answersRef.current = buildAnswers();

  // ---- real upload progress -> design stages ----
  const handleEvent = useCallback((e: ResumeUploadEvent) => {
    switch (e.type) {
      case 'started':
        setFileName(e.fileName);
        setUp('busy');
        setStage(0);
        setParsing(false);
        break;
      case 'profile':
        profileIdRef.current = e.profileId;
        setProfileId(e.profileId);
        break;
      case 'uploaded':
        setStage((s) => Math.max(s, 1));
        break;
      case 'parsing':
        setParsing(true);
        break;
      case 'saving':
        setParsing(false);
        setStage(6);
        break;
      case 'done':
        setParsing(false);
        setStage(STAGES.length);
        setUp('done');
        break;
      case 'failed':
      case 'error':
        setParsing(false);
        setUp(e.type === 'error' ? 'idle' : 'failed');
        break;
    }
  }, []);

  // The parse is a single server call; step through the middle stages while it runs.
  useEffect(() => {
    if (!parsing) return;
    const t = setInterval(() => setStage((s) => (s < 5 ? s + 1 : s)), 1300);
    return () => clearInterval(t);
  }, [parsing]);

  // Load parsed profile for the review step once processing completes.
  useEffect(() => {
    if (up !== 'done' || !profileId || reviewLoaded) return;
    let cancelled = false;
    (async () => {
      const res = await getProfile(profileId);
      const p = res.data as any;
      if (cancelled || !p) return;
      const pd = (p.personal_details || {}) as Record<string, any>;
      setReview({
        first: p.first_name || '',
        last: p.last_name || '',
        email: pd.email || '',
        phone: pd.phone || '',
        city: pd.address?.city || '',
        linkedin: pd.linkedin || '',
        portfolio: pd.portfolio || '',
      });
      setCounts({
        jobs: Array.isArray(p.work_experience) ? p.work_experience.length : 0,
        degrees: Array.isArray(p.education_history) ? p.education_history.length : 0,
        skills: Array.isArray(p.technical_skills?.all) ? p.technical_skills.all.length : 0,
        projects: Array.isArray(p.projects) ? p.projects.length : 0,
      });
      setReviewLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [up, profileId, reviewLoaded, getProfile]);

  // Pick up the extension if it announces itself on the page.
  useEffect(() => {
    if (ext !== 'waiting') return;
    const t = setInterval(() => {
      if (document.documentElement.dataset.fylloExtension || document.documentElement.hasAttribute('data-fyllo-extension')) setExt('ok');
    }, 1000);
    return () => clearInterval(t);
  }, [ext]);

  const upDone = up === 'done';
  const upFailed = up === 'failed';
  const extOk = ext === 'ok';
  const pct = Math.round(((upDone ? STAGES.length : stage) / STAGES.length) * 100) + '%';
  const upLabel = upDone ? 'Processed and saved' : STAGES[Math.min(stage, STAGES.length - 1)] + '…';
  const nextDisabled = finishing || (step === 1 && (up === 'idle' || up === 'failed' || stage < 1));

  const nextLabel = step === 4 ? (upDone ? 'Go to dashboard' : 'Review later') : step === 3 && !extOk ? 'I’ll do this later' : 'Continue';

  const startPicker = () => fileInput.current?.click();
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) uploadRef.current(f);
    e.target.value = '';
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) uploadRef.current(f);
  };

  const finish = async () => {
    setFinishing(true);
    try {
      const id = profileIdRef.current;
      if (id && upDone) {
        const res = await getProfile(id);
        const p = res.data as any;
        if (p) {
          const pd = (p.personal_details || {}) as Record<string, any>;
          const list = answersRef.current;
          const jp = (p.job_preferences || {}) as Record<string, any>;
          const update: Record<string, any> = {};
          if (reviewLoaded) {
            update.first_name = review.first;
            update.last_name = review.last;
            update.personal_details = {
              ...pd,
              firstName: review.first,
              lastName: review.last,
              full_name: `${review.first} ${review.last}`.trim() || pd.full_name,
              email: review.email,
              phone: review.phone,
              address: { ...(pd.address || {}), city: review.city },
              linkedin: review.linkedin,
              portfolio: review.portfolio,
            };
          }
          if (list.length > 0) update.job_preferences = { ...jp, screening_answers: list };
          if (Object.keys(update).length > 0) {
            const r = await updateProfile(id, update as any);
            if (r && (r as any).error) toast({ title: 'Could not save your changes', description: 'You can edit them from your profile.', variant: 'destructive' });
          }
        }
      }
    } catch (err) {
      console.error('Onboarding finish error:', err);
    } finally {
      setFinishing(false);
      onComplete();
    }
  };

  const next = () => (step < 4 ? setStep(step + 1) : finish());
  const qInvalid = !draftQ.trim() || !draftA.trim();
  const saveQ = () => {
    if (qInvalid) return;
    setCustomQs((c) => [...c, { q: draftQ.trim(), a: draftA.trim() }]);
    setAddingQ(false); setDraftQ(''); setDraftA('');
  };
  const cancelQ = () => { setAddingQ(false); setDraftQ(''); setDraftA(''); };

  const setRv = (k: keyof Review) => (e: React.ChangeEvent<HTMLInputElement>) => setReview((r) => ({ ...r, [k]: e.target.value }));
  const reviewFields: { key: keyof Review; k: string }[] = [
    { key: 'first', k: 'First name' }, { key: 'last', k: 'Last name' }, { key: 'email', k: 'Email' },
    { key: 'phone', k: 'Phone' }, { key: 'city', k: 'City' }, { key: 'linkedin', k: 'LinkedIn' },
  ];

  const reviewTitle = upDone ? 'Here’s what we found. Look right?' : upFailed ? 'We couldn’t read your résumé.' : 'Still processing your résumé…';
  const reviewSub = upDone
    ? 'Fix anything now and it stays fixed on every application — or review it later from your profile.'
    : upFailed
      ? 'Something went wrong while processing it. You can upload it again from your dashboard.'
      : up === 'idle'
        ? 'No résumé uploaded yet. You can add one from your dashboard any time.'
        : 'This can take a minute. Skip ahead and review it later from your profile.';

  return (
    <div className="fy">
      {/* Real resume pipeline (headless): upload, storage, AI parse, profile save */}
      <ResumeUpload
        onboarding={{
          register: (fn) => { uploadRef.current = fn; },
          onEvent: handleEvent,
          getScreeningAnswers: () => answersRef.current,
        }}
      />
      <input ref={fileInput} type="file" accept=".pdf,.doc,.docx,.txt" onChange={onPick} style={{ display: 'none' }} tabIndex={-1} aria-hidden="true" />

      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '20px clamp(20px,4vw,40px)', borderBottom: '1px solid rgba(23,19,33,.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
            <img src="/fyllo-mark.png" alt="" style={{ width: 28, height: 28 }} />
            <span className="sg" style={{ fontWeight: 600, fontSize: 19, letterSpacing: '-0.02em' }}>Fyllo</span>
          </div>
          <ol aria-label="Setup progress" style={{ flex: 1, listStyle: 'none', margin: 0, padding: 0, display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
            {OB_LABELS.map((l, i) => {
              const n = i + 1, done = n < step, cur = n === step;
              return (
                <li key={l} aria-current={cur ? 'step' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, padding: '0 12px 0 6px', borderRadius: 999, background: cur ? '#F5F1FB' : 'transparent', fontSize: 13, fontWeight: 500, color: cur || done ? '#171321' : '#6C6577' }}>
                  <span style={{ width: 20, height: 20, borderRadius: '50%', background: done || cur ? '#8A2BE2' : '#EDEAF1', color: done || cur ? '#FFFFFF' : '#6C6577', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{done ? '✓' : String(n)}</span>
                  {l}
                </li>
              );
            })}
          </ol>
          <button type="button" onClick={finish} disabled={finishing} style={{ flex: 'none', border: 0, background: 'none', fontSize: 14, color: '#6C6577', cursor: 'pointer' }}>Skip for now</button>
        </header>

        {up === 'busy' && step > 1 && (
          <div role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '10px 20px', background: '#FBF8FE', borderBottom: '1px solid rgba(138,43,226,.12)', fontSize: 13, color: '#4B0082' }}>
            <span aria-hidden="true" className="fy-spin" style={spinner(12)} />
            Processing r{'é'}sum{'é'} {'·'} {Math.min(stage + 1, STAGES.length)}/{STAGES.length} {'—'} keep going, we'll finish in the background
          </div>
        )}

        <main style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: 'clamp(40px,7vw,88px) 24px' }}>
          <div style={{ width: '100%', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 32 }}>

            {step === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <span style={kickerStyle}>Step 1 of 4</span>
                  <h1 className="sg" style={h1Style}>{'Welcome' + (firstName ? ', ' + firstName : '') + '. Let’s start with your résumé.'}</h1>
                  <p style={subStyle}>Upload your r{'é'}sum{'é'} and Fyllo turns it into a profile it can fill applications from. PDF or Word, up to 10 MB. Once it's uploaded you can keep going {'—'} we'll finish processing in the background.</p>
                </div>
                {(up === 'idle' || up === 'failed') && (
                  <button
                    type="button"
                    onClick={startPicker}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    style={{ minHeight: 240, borderRadius: 24, border: '1.5px dashed rgba(138,43,226,.45)', background: dragOver ? '#F5F1FB' : '#FBF8FE', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, cursor: 'pointer', color: '#171321', padding: 32, transition: 'background .2s' }}
                  >
                    <span aria-hidden="true" style={{ width: 52, height: 52, borderRadius: 16, background: '#FFFFFF', border: '1px solid rgba(23,19,33,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8A2BE2' }}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" x2="12" y1="3" y2="15" /></svg>
                    </span>
                    <span style={{ fontSize: 17, fontWeight: 500 }}>Drop your r{'é'}sum{'é'} here, or <span style={{ color: '#8A2BE2' }}>browse</span></span>
                    <span style={{ fontSize: 13, color: upFailed ? '#B42318' : '#6C6577' }}>{upFailed ? 'That one didn’t process — try again.' : '.pdf or .docx'}</span>
                  </button>
                )}
                {(up === 'busy' || up === 'done') && (
                  <div role="status" aria-live="polite" style={{ borderRadius: 24, border: '1px solid rgba(23,19,33,.08)', background: '#FFFFFF', padding: 28, display: 'flex', flexDirection: 'column', gap: 22 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div style={{ width: 40, height: 48, borderRadius: 6, background: '#FFFFFF', border: '1px solid rgba(23,19,33,.12)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 6, fontSize: 9, fontWeight: 600, color: '#4B0082', flex: 'none' }}>
                        {(fileName.split('.').pop() || 'PDF').slice(0, 4).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</div>
                        <div style={{ fontSize: 13, color: '#6C6577' }}>{upLabel}</div>
                      </div>
                      {!upDone && <span aria-hidden="true" className="fy-spin" style={spinner(20)} />}
                    </div>
                    <div style={{ height: 4, borderRadius: 4, background: '#F0ECF5', overflow: 'hidden' }}><div style={{ height: '100%', width: pct, background: '#8A2BE2', transition: 'width .4s ease' }} /></div>
                    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {STAGES.map((l, i) => {
                        const done = upDone || i < stage, active = !upDone && i === stage, pending = !done && !active;
                        return (
                          <li key={l} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, color: done || active ? '#171321' : '#9C97A6', transition: 'color .3s' }}>
                            <span aria-hidden="true" style={{ width: 18, height: 18, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {done && <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8A2BE2" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                              {active && <span className="fy-spin" style={spinner(14)} />}
                              {pending && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#D9D4E0' }} />}
                            </span>
                            {l}
                          </li>
                        );
                      })}
                    </ol>
                    {!upDone && stage >= 1 && <p style={{ margin: 0, paddingTop: 4, fontSize: 13, color: '#6C6577' }}>Uploaded. You can continue {'—'} this keeps running in the background.</p>}
                  </div>
                )}
              </div>
            )}

            {step === 4 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <span style={kickerStyle}>Step 4 of 4 {'·'} Optional</span>
                  <h1 className="sg" style={h1Style}>{reviewTitle}</h1>
                  <p style={subStyle}>{reviewSub}</p>
                </div>
                {up === 'busy' && (
                  <div role="status" style={{ borderRadius: 24, border: '1px solid rgba(23,19,33,.08)', background: '#FFFFFF', padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}><span>{upLabel}</span><span style={{ color: '#6C6577' }}>{pct}</span></div>
                    <div style={{ height: 4, borderRadius: 4, background: '#F0ECF5', overflow: 'hidden' }}><div style={{ height: '100%', width: pct, background: '#8A2BE2', transition: 'width .4s ease' }} /></div>
                  </div>
                )}
                {upDone && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '14px 16px' }}>
                      {reviewFields.map((f) => (
                        <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                          <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 500 }}>
                            {f.k}
                            {f.key === 'city' && !review.city && <span style={{ fontSize: 12, fontWeight: 500, color: '#8A5A00' }}>Please check</span>}
                          </span>
                          <input className="fy-input" value={review[f.key]} onChange={setRv(f.key)} />
                        </label>
                      ))}
                      <label style={{ display: 'flex', flexDirection: 'column', gap: 7, gridColumn: '1 / -1' }}>
                        <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 500 }}>
                          Portfolio
                          {!review.portfolio && <span style={{ fontSize: 12, fontWeight: 500, color: '#8A5A00' }}>Please check</span>}
                        </span>
                        <input className="fy-input" value={review.portfolio} onChange={setRv('portfolio')} placeholder="Not found in your résumé" style={review.portfolio ? undefined : { borderColor: '#E7C27A', background: '#FFFBF2' }} />
                      </label>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <span style={{ fontSize: 13, color: '#6C6577', width: '100%' }}>Also imported</span>
                      <span style={chip}>{counts.jobs} {counts.jobs === 1 ? 'job' : 'jobs'}</span>
                      <span style={chip}>{counts.degrees} {counts.degrees === 1 ? 'degree' : 'degrees'}</span>
                      <span style={chip}>{counts.skills} {counts.skills === 1 ? 'skill' : 'skills'}</span>
                      <span style={chip}>{counts.projects} {counts.projects === 1 ? 'project' : 'projects'}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <span style={kickerStyle}>Step 2 of 4</span>
                  <h1 className="sg" style={h1Style}>Answer the usual questions once.</h1>
                  <p style={subStyle}>Nearly every application asks these. Skip any you'd rather answer yourself.</p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid rgba(23,19,33,.08)' }}>
                  {OBQ.map((q) => (
                    <div key={q.id} role="radiogroup" aria-label={q.q} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px 24px', padding: '18px 0', borderBottom: '1px solid rgba(23,19,33,.08)' }}>
                      <span style={{ flex: '1 1 280px', fontSize: 15, lineHeight: 1.5 }}>{q.q}</span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {['Yes', 'No'].map((o) => {
                          const sel = answers[q.id] === o;
                          return (
                            <button key={o} type="button" role="radio" aria-checked={sel} onClick={() => setAnswers((a) => ({ ...a, [q.id]: sel ? undefined : o }))}
                              style={{ height: 40, padding: '0 18px', borderRadius: 999, border: `1px solid ${sel ? '#8A2BE2' : 'rgba(23,19,33,.14)'}`, background: sel ? '#8A2BE2' : '#FFFFFF', color: sel ? '#FFFFFF' : '#171321', fontSize: 14, fontWeight: 500, cursor: 'pointer', transition: 'all .2s' }}>{o}</button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {customQs.map((c, i) => (
                    <div key={i} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px 24px', padding: '18px 0', borderBottom: '1px solid rgba(23,19,33,.08)', animation: 'fyIn .25s ease-out' }}>
                      <div style={{ flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: 15, lineHeight: 1.5 }}>{c.q}</span>
                        <span style={{ fontSize: 12, color: '#8A2BE2', fontWeight: 500 }}>Your question</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ height: 40, display: 'flex', alignItems: 'center', padding: '0 16px', borderRadius: 999, background: '#8A2BE2', color: '#FFFFFF', fontSize: 14, fontWeight: 500, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.a}</span>
                        <button type="button" className="fy-btn fy-ghost" aria-label="Remove question" onClick={() => setCustomQs((l) => l.filter((_, j) => j !== i))} style={{ width: 36, height: 36, borderRadius: '50%', color: '#6C6577', fontSize: 18 }}>{'×'}</button>
                      </div>
                    </div>
                  ))}
                </div>
                {addingQ ? (
                  <div style={{ borderRadius: 20, border: '1px solid rgba(138,43,226,.35)', background: '#FBF8FE', padding: 20, display: 'flex', flexDirection: 'column', gap: 14, animation: 'fyIn .2s ease-out' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}><span style={{ fontSize: 13, fontWeight: 500 }}>Question</span><input className="fy-input" value={draftQ} onChange={(e) => setDraftQ(e.target.value)} placeholder="e.g. Are you open to relocating?" /></label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}><span style={{ fontSize: 13, fontWeight: 500 }}>Your answer</span><input className="fy-input" value={draftA} onChange={(e) => setDraftA(e.target.value)} placeholder="e.g. Yes, within the US" /></label>
                    <span style={{ fontSize: 13, color: '#6C6577' }}>Fyllo matches this to similar wording on application forms.</span>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button type="button" className="fy-btn fy-ghost" onClick={cancelQ} style={{ height: 42, padding: '0 16px', borderRadius: 999, fontSize: 14 }}>Cancel</button>
                      <button type="button" className="fy-btn fy-primary" onClick={saveQ} disabled={qInvalid} style={{ height: 42, padding: '0 18px', borderRadius: 999, fontSize: 14, background: qInvalid ? '#CFC8DA' : undefined }}>Add question</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setAddingQ(true)} style={{ alignSelf: 'flex-start', height: 44, padding: '0 18px', border: '1px dashed rgba(138,43,226,.5)', borderRadius: 999, background: '#FFFFFF', fontSize: 14, fontWeight: 500, color: '#4B0082', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /><path d="M12 5v14" /></svg>Add your own question
                  </button>
                )}
                <p style={{ margin: 0, fontSize: 14, color: '#6C6577' }}>You can add veteran status, disability status, salary expectations and more later.</p>
              </div>
            )}

            {step === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <span style={kickerStyle}>Step 3 of 4</span>
                  <h1 className="sg" style={h1Style}>{extOk ? 'You’re all set.' : 'Add Fyllo to Chrome.'}</h1>
                  <p style={subStyle}>{extOk ? 'The extension is connected to your account. Try it on your next application.' : 'The extension does the filling. It connects to this account automatically once installed.'}</p>
                </div>
                <div style={{ borderRadius: 24, border: '1px solid rgba(23,19,33,.08)', background: '#FFFFFF', padding: 24, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20 }}>
                  <img src="/icon128.png" alt="" style={{ width: 56, height: 56, borderRadius: 14 }} />
                  <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 16, fontWeight: 500 }}>Fyllo Auto-Fill</span>
                    <span style={{ fontSize: 13, color: '#6C6577' }}>Chrome extension {'·'} Productivity</span>
                  </div>
                  {ext === 'pending' && <button type="button" className="fy-btn fy-dark" onClick={() => setExt('waiting')} style={{ height: 46, padding: '0 22px', borderRadius: 999, fontSize: 15 }}>Add to Chrome</button>}
                  {ext === 'waiting' && <span role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#6C6577' }}><span aria-hidden="true" className="fy-spin" style={spinner(16)} />Waiting for the extension{'…'}</span>}
                  {extOk && <span role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 14px', borderRadius: 999, background: '#F5F1FB', color: '#4B0082', fontSize: 14, fontWeight: 500 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>Connected</span>}
                </div>
                <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 16 }}>
                  {['Open any job application', 'Click the Fyllo icon in your toolbar', 'Press Fill, review, submit'].map((t, i) => (
                    <li key={t} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span className="sg" style={{ fontSize: 14, color: '#8A2BE2' }}>{'0' + (i + 1)}</span>
                      <span style={{ fontSize: 14, lineHeight: 1.5 }}>{t}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingTop: 8 }}>
              {step > 1 && <button type="button" className="fy-btn fy-ghost" onClick={() => setStep(Math.max(1, step - 1))} style={{ height: 48, padding: '0 20px', borderRadius: 999, fontSize: 15 }}>Back</button>}
              <span style={{ flex: 1 }} />
              <button type="button" className="fy-btn fy-primary" onClick={next} disabled={nextDisabled} style={{ height: 50, padding: '0 26px', borderRadius: 999, fontSize: 15, gap: 10, background: nextDisabled ? '#CFC8DA' : undefined, opacity: 1, cursor: nextDisabled ? 'not-allowed' : 'pointer' }}>
                {nextLabel}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Onboarding;
