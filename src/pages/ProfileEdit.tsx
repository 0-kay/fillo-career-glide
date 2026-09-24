import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useProfiles } from '@/hooks/useProfiles';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import ScreeningQuestionsDialog, { ScreeningAnswer } from '@/components/ScreeningQuestionsDialog';
import AppShell from '@/components/fyllo/AppShell';
import '@/components/fyllo/fyllo.css';

type EduDate = { year?: string; month?: string } | string | null | undefined;

// Normalize education dates: migrate plain strings to {year, month} objects
const normalizeEduDate = (d: EduDate) => {
  if (d && typeof d === 'object' && 'year' in d) return { year: d.year || "", month: d.month || "" };
  if (typeof d === 'string') {
    const s = d.trim();
    const ym = s.match(/^(\d{1,2})[/-](\d{4})$/);
    if (ym) return { year: ym[2], month: ym[1] };
    const yOnly = s.match(/^(\d{4})$/);
    if (yOnly) return { year: yOnly[1], month: "" };
    return { year: s, month: "" };
  }
  return { year: "", month: "" };
};

const formatEduDate = (d: EduDate) => {
  if (d && typeof d === 'object') return d.month ? `${d.month}/${d.year}` : (d.year || '');
  return d ? String(d) : '';
};

const ProfileEdit = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getProfile, updateProfile } = useProfiles();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<any>(null);
  const [newSkill, setNewSkill] = useState('');
  const [showScreeningDialog, setShowScreeningDialog] = useState(false);
  const [section, setSection] = useState('personal');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (authLoading) return; // Wait until authentication check is complete
    
    const fetchProfile = async () => {
      if (!id || !user) {
        if (!user) {
          navigate('/');
        }
        return;
      }
      
      setLoading(true);
      try {
        const { data, error } = await getProfile(id);
        if (error) {
          console.error('Error fetching profile:', error);
          toast({
            title: "Error",
            description: "Failed to load profile data",
            variant: "destructive"
          });
          navigate('/dashboard');
        } else if (data) {
          // Initialize form data with proper field mappings from actual data structure
          const pd = data.personal_details || {} as any;
          pd.fullName = pd.full_name || pd.fullName || '';
          // Normalize address: migrate flat string to object format
          if (!pd.address || typeof pd.address === 'string') {
            pd.address = { line1: '', line2: '', city: '', state: '', postalCode: '', country: '' };
          }
          // Normalize phone: strip whitespace
          if (pd.phone) {
            pd.phone = pd.phone.replace(/\s+/g, '');
          }
          // Normalize phoneExtension: clear bogus values like "empty string"
          if (!pd.phoneExtension || pd.phoneExtension === 'empty string') {
            pd.phoneExtension = '';
          }
          const educationHistory = (data.education_history || []).map((edu: any) => ({
            ...edu,
            startDate: normalizeEduDate(edu.startDate),
            endDate: normalizeEduDate(edu.endDate),
          }));

          setFormData({
            profileName: (data.resume_metadata as any)?.profile_name || [data.first_name, data.last_name].filter(Boolean).join(' ') || (data.personal_details as any)?.fullName || 'Untitled Profile',
            personalDetails: pd,
            workExperience: data.work_experience || [],
            educationHistory,
            technicalSkills: data.technical_skills || {},
            softSkills: data.soft_skills || {},
            toolsTechnologies: data.tools_technologies || {},
            projects: data.projects || [],
            certifications: data.certifications_licenses || [],
            awards: data.awards_honors || [],
            languages: data.languages || [],
            volunteerExperience: data.volunteer_experience || [],
            jobPreferences: data.job_preferences || {},
            screeningAnswers: (data.job_preferences as any)?.screening_answers || [],
            resumeMetadata: data.resume_metadata || {}
          });
        }
      } catch (error) {
        console.error('Error:', error);
        toast({
          title: "Error",
          description: "Failed to load profile data",
          variant: "destructive"
        });
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [id, getProfile, navigate, toast, user, authLoading]);

  const handlePersonalDetailsChange = (field: string, value: string) => {
    setFormData((prev: any) => ({
      ...prev,
      personalDetails: {
        ...prev.personalDetails,
        [field]: value,
        ...(field === 'fullName' ? { full_name: value } : {})
      }
    }));
  };

  const handleAddressChange = (field: string, value: string) => {
    setFormData((prev: any) => ({
      ...prev,
      personalDetails: {
        ...prev.personalDetails,
        address: {
          ...(prev.personalDetails?.address || {}),
          [field]: value
        }
      }
    }));
  };

  const addTechnicalSkill = () => {
    if (newSkill.trim()) {
      const currentSkills = formData.technicalSkills?.all || [];
      setFormData((prev: any) => ({
        ...prev,
        technicalSkills: {
          ...prev.technicalSkills,
          all: [...currentSkills, newSkill.trim()]
        }
      }));
      setNewSkill('');
    }
  };

  const removeTechnicalSkill = (index: number) => {
    const currentSkills = formData.technicalSkills?.all || [];
    setFormData((prev: any) => ({
      ...prev,
      technicalSkills: {
        ...prev.technicalSkills,
        all: currentSkills.filter((_: any, i: number) => i !== index)
      }
    }));
  };

  const handleSave = async () => {
    if (!id || !formData) return;
    
    setSaving(true);
    try {
      // Ensure address is always saved as an object and phoneExtension is included
      const personalDetails = {
        ...formData.personalDetails,
        address: typeof formData.personalDetails?.address === 'object' && formData.personalDetails?.address !== null
          ? formData.personalDetails.address
          : { line1: '', line2: '', city: '', state: '', postalCode: '', country: '' },
        phoneExtension: formData.personalDetails?.phoneExtension || '',
      };
      // first_name/last_name are fill data (the applicant's real name) — derive them
      // from the personal details Full Name, never from the profile label.
      const nameParts = (personalDetails.fullName || personalDetails.full_name || '').trim().split(/\s+/).filter(Boolean);
      const { error } = await updateProfile(id, {
        ...(nameParts.length > 0 ? {
          first_name: nameParts[0],
          middle_name: nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '',
          last_name: nameParts.length > 1 ? nameParts[nameParts.length - 1] : '',
        } : {}),
        personal_details: personalDetails,
        work_experience: formData.workExperience,
        education_history: formData.educationHistory,
        technical_skills: formData.technicalSkills,
        soft_skills: formData.softSkills,
        tools_technologies: formData.toolsTechnologies,
        projects: formData.projects,
        certifications_licenses: formData.certifications,
        awards_honors: formData.awards,
        languages: formData.languages,
        volunteer_experience: formData.volunteerExperience,
        job_preferences: { ...formData.jobPreferences, screening_answers: formData.screeningAnswers },
        resume_metadata: { ...formData.resumeMetadata, profile_name: (formData.profileName || '').trim() || 'Untitled Profile' }
      });

      if (error) {
        toast({
          title: "Error",
          description: "Failed to save profile changes",
          variant: "destructive"
        });
      } else {
        toast({
          title: "Success",
          description: "Profile updated successfully",
        });
        setSaved(true);
        navigate('/dashboard');
      }
    } catch (error) {
      console.error('Error saving profile:', error);
      toast({
        title: "Error",
        description: "Failed to save profile changes",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };
  // Helper to update nested fields
  const updateNestedField = (section: string, index: number, field: string, value: string) => {
    setFormData((prev: any) => {
      const newData = { ...prev };
      if (!newData[section]) newData[section] = [];
      if (!newData[section][index]) newData[section][index] = {};
      newData[section][index][field] = value;
      return newData;
    });
  };

  // Education dates are stored as {year, month} objects — parse the typed value
  const updateEducationDate = (index: number, field: 'startDate' | 'endDate', value: string) => {
    setFormData((prev: any) => {
      const history = [...(prev.educationHistory || [])];
      history[index] = { ...history[index], [field]: normalizeEduDate(value) };
      return { ...prev, educationHistory: history };
    });
  };
  const fd = formData;
  const pd = fd?.personalDetails || {};
  const skillsAll: string[] = fd?.technicalSkills?.all || [];
  const tools: string[] = fd?.toolsTechnologies?.all || [];
  const len = (k: string) => (fd?.[k] || []).length;

  const completeness = (() => {
    const q = fd?.resumeMetadata?.extractionQuality?.dataCompleteness;
    if (q !== undefined && q !== null && !isNaN(Number(q))) return Math.round(Number(q));
    const checks = [pd.fullName, pd.email, pd.phone, pd.summary, pd.address?.city, skillsAll.length, len('workExperience'), len('educationHistory')];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  })();

  const sections = [
    { id: 'personal', label: 'Personal details', meta: '' },
    { id: 'experience', label: 'Work experience', meta: String(len('workExperience')) },
    { id: 'skills', label: 'Skills', meta: String(skillsAll.length) },
    ...(tools.length ? [{ id: 'tools', label: 'Tools & technologies', meta: String(tools.length) }] : []),
    { id: 'answers', label: 'Screening answers', meta: String(len('screeningAnswers')) },
    { id: 'resume', label: 'Résumé preview', meta: '' },
    { id: 'education', label: 'Education', meta: String(len('educationHistory')) },
    ...(len('projects') ? [{ id: 'projects', label: 'Projects', meta: String(len('projects')) }] : []),
    ...(len('certifications') ? [{ id: 'certs', label: 'Certifications & licenses', meta: String(len('certifications')) }] : []),
    ...(len('awards') ? [{ id: 'awards', label: 'Awards & honors', meta: String(len('awards')) }] : []),
    ...(len('volunteerExperience') ? [{ id: 'volunteer', label: 'Volunteer experience', meta: String(len('volunteerExperience')) }] : []),
    ...(len('languages') ? [{ id: 'languages', label: 'Languages', meta: String(len('languages')) }] : []),
  ];

  const shell = (inner: React.ReactNode) => <AppShell>{inner}</AppShell>;

  if (loading) {
    return shell(
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14, padding: 80 }}>
        <div className="fy-spin" style={{ width: 32, height: 32 }} />
        <p style={{ margin: 0, color: '#6C6577', fontSize: 14 }}>Loading profile data…</p>
      </main>
    );
  }

  if (!fd) {
    return shell(
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, padding: 80 }}>
        <p style={{ margin: 0, color: '#6C6577' }}>Profile not found</p>
        <Link to="/dashboard" className="fy-btn fy-dark" style={{ height: 44, padding: '0 20px', borderRadius: 999, fontSize: 14 }}>Back to Dashboard</Link>
      </main>
    );
  }

  const fileName = fd.resumeMetadata?.fileName;
  const initial = ((fd.profileName || 'P').trim()[0] || 'P').toUpperCase();
  const saveLabel = saving ? 'Saving…' : saved ? 'Saved' : 'Save changes';
  const addr = pd.address || {};
  const contactLine = [[addr.city, addr.state].filter(Boolean).join(', '), pd.email, pd.phone, pd.linkedin].filter(Boolean).join(' · ');
  const fmtDates = (o: any) => [o?.startDate, o?.endDate].filter(Boolean).join(' – ');
  const groupTitle = { margin: 0, fontSize: 18, fontWeight: 500 } as const;

  const eduDefs: FieldDef[] = [
    { label: 'Degree', key: 'degree', ph: 'e.g., Bachelor of Science', bold: true },
    { label: 'Institution', key: 'school', ph: 'Enter school or university' },
    { label: 'Field of study', key: 'fieldOfStudy', ph: 'e.g., Computer Science' },
    { label: 'Location', key: 'location', ph: 'e.g., Boston, MA' },
    { label: 'Start date', key: 'startDate', ph: 'e.g., 9/2018 or 2018', get: (o) => formatEduDate(o?.startDate), set: (i, v) => updateEducationDate(i, 'startDate', v) },
    { label: 'End date / graduation', key: 'endDate', ph: 'e.g., 5/2022 or 2022', get: (o) => formatEduDate(o?.endDate), set: (i, v) => updateEducationDate(i, 'endDate', v) },
    { label: 'GPA', key: 'gpa', ph: 'e.g., 3.8' },
    { label: 'Details', key: 'description', ph: 'Relevant coursework, honors, activities. Use • for bullet points.', multi: true },
  ];

  return shell(
    <main data-screen-label="Profile" style={{ maxWidth: 1200, width: '100%', margin: '0 auto', padding: 'clamp(28px,4vw,48px) 24px 120px', display: 'flex', flexDirection: 'column', gap: 36 }}>
      <Link to="/dashboard" style={{ alignSelf: 'flex-start', padding: '6px 0', fontSize: 14, color: '#6C6577' }}>← Profiles</Link>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: '20px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div aria-hidden="true" className="sg" style={{ width: 64, height: 64, borderRadius: 18, background: '#8A2BE2', color: '#fff', fontWeight: 600, fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initial}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 className="sg" style={{ margin: 0, fontWeight: 500, fontSize: 'clamp(30px,3.4vw,42px)', lineHeight: 1.05, letterSpacing: '-0.035em' }}>{fd.profileName || 'Untitled Profile'}</h1>
            {fileName && <span style={{ fontSize: 14, color: '#6C6577' }}>From {fileName} · Default profile</span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: '0 0 180px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}><span style={{ color: '#6C6577' }}>Complete</span><span style={{ fontWeight: 500 }}>{completeness}%</span></div>
            <div className="fy-bar"><div style={{ width: `${Math.min(100, completeness)}%` }} /></div>
          </div>
          <button type="button" className="fy-btn fy-dark" onClick={handleSave} disabled={saving} style={{ height: 44, padding: '0 20px', borderRadius: 999, fontSize: 14 }}>{saveLabel}</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))', gap: '32px 48px', alignItems: 'start' }}>
        <nav aria-label="Profile sections" style={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 260 }} className="fy-sticky-nav">
          {sections.map((s) => {
            const cur = s.id === section;
            return (
              <button key={s.id} type="button" onClick={() => setSection(s.id)} aria-current={cur ? 'true' : undefined}
                style={{ textAlign: 'left', height: 42, padding: '0 14px', border: 0, borderRadius: 12, background: cur ? '#F5F1FB' : 'transparent', color: cur ? '#171321' : '#6C6577', fontSize: 14, fontWeight: 500, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {s.label}<span style={{ fontSize: 12, fontWeight: 400, color: '#9C97A6' }}>{s.meta}</span>
              </button>
            );
          })}
        </nav>

        <div style={{ gridColumn: 'span 2', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {section === 'personal' && (
            <Card title="Personal details">
              <div style={fieldGrid}>
                <PF id="profileName" label="Profile name" value={fd.profileName || ''} ph="e.g., Software Engineer Profile" onChange={(v: string) => setFormData((p: any) => ({ ...p, profileName: v }))} col="1 / -1" />
                <PF id="fullName" label="Full name" value={pd.fullName || ''} onChange={(v: string) => handlePersonalDetailsChange('fullName', v)} />
                <PF id="email" type="email" label="Email" value={pd.email || ''} onChange={(v: string) => handlePersonalDetailsChange('email', v)} />
                <PF id="phone" label="Phone" value={pd.phone || ''} onChange={(v: string) => handlePersonalDetailsChange('phone', v)} />
                <PF id="phoneExtension" label="Phone extension" value={pd.phoneExtension || ''} onChange={(v: string) => handlePersonalDetailsChange('phoneExtension', v)} />
                <PF id="addressLine1" label="Address line 1" value={addr.line1 || ''} onChange={(v: string) => handleAddressChange('line1', v)} />
                <PF id="addressLine2" label="Address line 2" value={addr.line2 || ''} onChange={(v: string) => handleAddressChange('line2', v)} />
                <PF id="city" label="City" value={addr.city || ''} onChange={(v: string) => handleAddressChange('city', v)} />
                <PF id="state" label="State / province" value={addr.state || ''} onChange={(v: string) => handleAddressChange('state', v)} />
                <PF id="postalCode" label="Postal code" value={addr.postalCode || ''} onChange={(v: string) => handleAddressChange('postalCode', v)} />
                <PF id="country" label="Country" value={addr.country || ''} onChange={(v: string) => handleAddressChange('country', v)} />
                <PF id="linkedin" label="LinkedIn" value={pd.linkedin || ''} onChange={(v: string) => handlePersonalDetailsChange('linkedin', v)} />
                <PF id="github" label="GitHub" value={pd.github || ''} onChange={(v: string) => handlePersonalDetailsChange('github', v)} />
                <PF id="portfolio" label="Portfolio" value={pd.portfolio || ''} onChange={(v: string) => handlePersonalDetailsChange('portfolio', v)} />
              </div>
              {pd.additionalLinks && pd.additionalLinks.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>Additional links</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {pd.additionalLinks.map((l: any, k: number) => <LinkChip key={k} url={l.url || ''} label={l.label || 'Link'} />)}
                  </div>
                </div>
              )}
              {(pd.linkedin || pd.github || pd.portfolio) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>Profile links</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {pd.linkedin && <LinkChip url={pd.linkedin} label="LinkedIn" />}
                    {pd.github && <LinkChip url={pd.github} label="GitHub" tone="plain" />}
                    {pd.portfolio && <LinkChip url={pd.portfolio} label="Portfolio" tone="plain" />}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>Professional summary</span>
                <EditableField multiline value={pd.summary || ''} fieldKey="professional-summary" placeholder="Write a compelling professional summary. Use • for bullet points." onSave={(v) => handlePersonalDetailsChange('summary', v)} />
              </div>
            </Card>
          )}

          {section === 'experience' && (
            <Card title="Work experience">
              <ItemList items={fd.workExperience} updateNestedField={updateNestedField} sectionKey="workExperience" empty="No work experience data found" defs={[
                { label: 'Job title', key: 'jobTitle', ph: 'Enter job title', bold: true },
                { label: 'Company', key: 'company', ph: 'Enter company name' },
                { label: 'Start date', key: 'startDate', ph: 'e.g., Jan 2022' },
                { label: 'End date', key: 'endDate', ph: 'e.g., Present or Dec 2023' },
                { label: 'Location', key: 'location', ph: 'e.g., San Francisco, CA', full: true },
                { label: 'Description', key: 'description', ph: 'Describe your role and responsibilities. Use • for bullet points.', multi: true },
              ]} extras={(exp) => (
                <>
                  <Chips label="Technologies used" items={exp?.technologies} />
                  {exp?.achievements && exp.achievements.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>Key achievements</span>
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {exp.achievements.map((a: string, k: number) => (
                          <li key={k} style={{ fontSize: 14, color: '#6C6577', display: 'flex', gap: 8 }}><span>•</span><span>{a}</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <Chips label="Metrics & impact" items={exp?.metrics} tone="green" />
                </>
              )} />
            </Card>
          )}

          {section === 'skills' && (
            <Card title="Skills" right={<span style={{ fontSize: 13, color: '#6C6577' }}>{skillsAll.length} skills</span>}>
              <form onSubmit={(e) => { e.preventDefault(); addTechnicalSkill(); }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input className="fy-input" value={newSkill} onChange={(e) => setNewSkill(e.target.value)} placeholder="Add a technical skill" aria-label="New skill" style={{ flex: '1 1 220px', width: 'auto', height: 44 }} />
                <button type="submit" className="fy-btn fy-primary" disabled={!newSkill.trim()} style={{ height: 44, padding: '0 18px', borderRadius: 12, fontSize: 14 }}>+ Add</button>
              </form>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {skillsAll.map((sk, i) => (
                  <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, padding: '0 6px 0 14px', height: 36, borderRadius: 999, background: '#F6F4F9' }}>
                    {sk}
                    <button type="button" className="fy-btn fy-ghost" onClick={() => removeTechnicalSkill(i)} aria-label={`Remove ${sk}`} style={{ width: 24, height: 24, padding: 0, borderRadius: '50%', color: '#6C6577', fontSize: 15, lineHeight: 1 }}>×</button>
                  </span>
                ))}
              </div>
              {Object.entries(fd.technicalSkills || {}).filter(([k]) => k !== 'all').map(([category, skills]) => (
                Array.isArray(skills) && skills.length > 0 ? <Chips key={category} label={`${category.charAt(0).toUpperCase()}${category.slice(1)} skills`} items={skills as string[]} /> : null
              ))}
            </Card>
          )}

          {section === 'tools' && (
            <Card title="Tools & technologies" right={<span style={{ fontSize: 13, color: '#6C6577' }}>{tools.length}</span>}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {tools.map((t, i) => <span key={i} style={{ fontSize: 14, height: 36, display: 'inline-flex', alignItems: 'center', padding: '0 14px', borderRadius: 999, background: '#F6F4F9' }}>{t}</span>)}
              </div>
            </Card>
          )}

          {section === 'answers' && (
            <section className="fy-card" style={{ padding: 'clamp(20px,3vw,32px)', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <h2 style={groupTitle}>Screening answers</h2>
                <button type="button" className="fy-btn fy-outline" onClick={() => setShowScreeningDialog(true)} style={{ height: 40, padding: '0 16px', borderRadius: 999, fontSize: 14 }}>Edit</button>
              </div>
              {fd.screeningAnswers && fd.screeningAnswers.length > 0 ? (
                fd.screeningAnswers.map((sa: ScreeningAnswer) => (
                  <div key={sa.id} style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '10px 20px', padding: '16px 0', borderTop: '1px solid rgba(23,19,33,.06)' }}>
                    <span style={{ flex: '1 1 260px', fontSize: 14, lineHeight: 1.5 }}>{sa.question}</span>
                    <span style={{ fontSize: 13, fontWeight: 500, padding: '6px 12px', borderRadius: 999, background: sa.answer ? '#F5F1FB' : '#F6F4F9', color: sa.answer ? '#4B0082' : '#9C97A6' }}>{sa.answer || 'Not answered'}</span>
                  </div>
                ))
              ) : (
                <p style={{ margin: 0, color: '#6C6577', fontSize: 14, textAlign: 'center', padding: '16px 0', borderTop: '1px solid rgba(23,19,33,.06)' }}>
                  No screening answers configured.{' '}
                  <button type="button" onClick={() => setShowScreeningDialog(true)} style={{ border: 0, background: 'none', color: '#8A2BE2', cursor: 'pointer', fontSize: 14, padding: 0 }}>Add answers</button>
                </p>
              )}
            </section>
          )}

          {section === 'resume' && (
            <section className="fy-card" style={{ overflow: 'hidden' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, padding: '18px clamp(18px,3vw,28px)', borderBottom: '1px solid rgba(23,19,33,.07)' }}>
                <div style={{ width: 34, height: 40, borderRadius: 5, border: '1px solid rgba(23,19,33,.12)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 5, fontSize: 8, fontWeight: 600, color: '#4B0082', flex: 'none' }}>PDF</div>
                <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>{fileName || 'Résumé preview'}</div>
                  <div style={{ fontSize: 13, color: '#6C6577' }}>Preview built from your profile data</div>
                </div>
              </div>
              <div style={{ background: '#F3F1F6', padding: 'clamp(16px,4vw,40px)', display: 'flex', justifyContent: 'center' }}>
                <article aria-label="Résumé preview" style={{ width: '100%', maxWidth: 600, minHeight: 500, background: '#fff', boxShadow: '0 1px 2px rgba(23,19,33,.08),0 12px 32px -12px rgba(23,19,33,.2)', padding: 'clamp(22px,5%,44px)', display: 'flex', flexDirection: 'column', gap: 18, fontFamily: "Georgia,'Times New Roman',serif", color: '#222', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderBottom: '1px solid #DDD', paddingBottom: 14 }}>
                    <span style={{ fontSize: 'clamp(20px,3vw,26px)', letterSpacing: '.02em' }}>{pd.fullName || fd.profileName}</span>
                    <span style={{ fontSize: 11, color: '#555', fontFamily: 'Poppins,sans-serif' }}>{contactLine}</span>
                  </div>
                  {len('workExperience') > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <span style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', fontFamily: 'Poppins,sans-serif', color: '#555' }}>Experience</span>
                      {fd.workExperience.map((j: any, i: number) => (
                        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                            <span><b>{j?.jobTitle}</b>{j?.company ? `, ${j.company}` : ''}</span>
                            <span style={{ color: '#666', fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDates(j)}</span>
                          </div>
                          <span style={{ display: 'block', height: 5, width: '92%', background: '#EEE', borderRadius: 2 }} />
                          <span style={{ display: 'block', height: 5, width: '78%', background: '#EEE', borderRadius: 2 }} />
                        </div>
                      ))}
                    </div>
                  )}
                  {len('educationHistory') > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', fontFamily: 'Poppins,sans-serif', color: '#555' }}>Education</span>
                      {fd.educationHistory.map((e: any, i: number) => (
                        <span key={i} style={{ fontSize: 13 }}><b>{e?.degree}</b>{e?.school ? `, ${e.school}` : ''}{formatEduDate(e?.endDate) ? ` · ${formatEduDate(e.endDate)}` : ''}</span>
                      ))}
                    </div>
                  )}
                  {skillsAll.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', fontFamily: 'Poppins,sans-serif', color: '#555' }}>Skills</span>
                      <span style={{ fontSize: 12, lineHeight: 1.6, color: '#333' }}>{skillsAll.join(' · ')}</span>
                    </div>
                  )}
                </article>
              </div>
            </section>
          )}

          {section === 'education' && (
            <Card title="Education"><ItemList items={fd.educationHistory} updateNestedField={updateNestedField} sectionKey="educationHistory" defs={eduDefs} empty="No education data found" /></Card>
          )}

          {section === 'projects' && (
            <Card title="Projects">
              <ItemList items={fd.projects} updateNestedField={updateNestedField} sectionKey="projects" empty="No projects" defs={[
                { label: 'Project name', key: 'name', ph: 'Enter project name', bold: true },
                { label: 'Role', key: 'role', ph: 'Your role in the project' },
                { label: 'Description', key: 'description', ph: 'Describe the project, your contributions, and impact. Use • for bullet points.', multi: true },
              ]} extras={(p) => (
                <>
                  {(p?.url || p?.githubUrl || p?.demoUrl || (p?.links && p.links.length > 0)) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>Project links</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {p?.url && <LinkChip url={p.url} label="Project URL" />}
                        {p?.githubUrl && <LinkChip url={p.githubUrl} label="GitHub" tone="plain" />}
                        {p?.demoUrl && <LinkChip url={p.demoUrl} label="Live demo" />}
                        {p?.links && p.links.map((l: any, k: number) => <LinkChip key={k} url={l.url || ''} label={l.label || 'Link'} tone="plain" />)}
                      </div>
                    </div>
                  )}
                  <Chips label="Technologies" items={p?.technologies} />
                  <Chips label="Impact & metrics" items={p?.metrics} tone="green" />
                </>
              )} />
            </Card>
          )}

          {section === 'certs' && (
            <Card title="Certifications & licenses">
              <ItemList items={fd.certifications} updateNestedField={updateNestedField} sectionKey="certifications" empty="No certifications" defs={[
                { label: 'Certification name', key: 'name', ph: 'Enter certification name', bold: true },
                { label: 'Issuing organization', key: 'issuingOrganization', ph: 'Enter issuing organization' },
                { label: 'Issue date', key: 'dateIssued', ph: 'e.g., Jan 2023' },
                { label: 'Expiration date', key: 'expirationDate', ph: 'e.g., Jan 2026 or leave empty' },
                { label: 'Credential ID', key: 'credentialId', ph: 'Enter credential ID', mono: true, full: true },
              ]} />
            </Card>
          )}

          {section === 'awards' && (
            <Card title="Awards & honors">
              <ItemList items={fd.awards} updateNestedField={updateNestedField} sectionKey="awards" empty="No awards" defs={[
                { label: 'Award title', key: 'title', ph: 'Enter award title', bold: true },
                { label: 'Issuer', key: 'issuer', ph: 'Enter issuer' },
                { label: 'Date', key: 'date', ph: 'e.g., 2023' },
                { label: 'Description', key: 'description', ph: 'Describe the award. Use • for bullet points.', multi: true },
              ]} />
            </Card>
          )}

          {section === 'volunteer' && (
            <Card title="Volunteer experience">
              <ItemList items={fd.volunteerExperience} updateNestedField={updateNestedField} sectionKey="volunteerExperience" empty="No volunteer experience" defs={[
                { label: 'Role', key: 'role', ph: 'Enter role', bold: true },
                { label: 'Organization', key: 'organization', ph: 'Enter organization' },
                { label: 'Start date', key: 'startDate', ph: 'e.g., Jan 2022' },
                { label: 'End date', key: 'endDate', ph: 'e.g., Present or Dec 2023' },
                { label: 'Location', key: 'location', ph: 'e.g., San Francisco, CA', full: true },
                { label: 'Description', key: 'description', ph: 'Describe your volunteer work. Use • for bullet points.', multi: true },
              ]} />
            </Card>
          )}

          {section === 'languages' && (
            <Card title="Languages">
              <ItemList items={fd.languages} updateNestedField={updateNestedField} sectionKey="languages" empty="No languages" defs={[
                { label: 'Language', key: 'language', ph: 'e.g., Spanish', bold: true },
                { label: 'Proficiency', key: 'proficiency', ph: 'e.g., Fluent, Native, Intermediate' },
              ]} />
            </Card>
          )}
        </div>
      </div>

      <ScreeningQuestionsDialog
        isOpen={showScreeningDialog}
        onClose={() => setShowScreeningDialog(false)}
        onSave={(answers) => {
          setFormData((prev: any) => ({ ...prev, screeningAnswers: answers }));
          setShowScreeningDialog(false);
        }}
        initialAnswers={fd.screeningAnswers}
      />
    </main>
  );
};

const cardStyle: React.CSSProperties = { padding: 'clamp(20px,3vw,32px)', display: 'flex', flexDirection: 'column', gap: 22 };
const Card = ({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) => (
  <section className="fy-card" style={cardStyle}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500 }}>{title}</h2>{right}
    </div>
    {children}
  </section>
);

const fieldGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '16px 18px' };
const PF = ({ label, id, value, onChange, type, ph, col }: any) => (
  <label htmlFor={id} style={{ display: 'flex', flexDirection: 'column', gap: 7, gridColumn: col }}>
    <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
    <input id={id} type={type || 'text'} className="fy-input" value={value} placeholder={ph} onChange={(e) => onChange(e.target.value)} />
  </label>
);

type FieldDef = { label: string; key: string; ph: string; multi?: boolean; full?: boolean; bold?: boolean; mono?: boolean; get?: (o: any) => string; set?: (i: number, v: string) => void };
const ItemList = ({ items, sectionKey, defs, extras, empty, updateNestedField }: { items: any[]; sectionKey: string; defs: FieldDef[]; extras?: (o: any) => React.ReactNode; empty: string; updateNestedField: (s: string, i: number, f: string, v: string) => void }) => {
  if (!items.length) return <p style={{ margin: 0, color: '#6C6577', fontSize: 14, textAlign: 'center', padding: '16px 0' }}>{empty}</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {items.map((o: any, i: number) => (
        <div key={i} style={{ padding: '20px 0', borderTop: i === 0 ? 0 : '1px solid rgba(23,19,33,.06)', display: 'flex', flexDirection: 'column', gap: 16, ...(i === 0 ? { paddingTop: 0 } : {}) }}>
          <div style={fieldGrid}>
            {defs.filter((d) => !d.multi).map((d) => (
              <div key={d.key + d.label} style={{ display: 'flex', flexDirection: 'column', gap: 7, gridColumn: d.full ? '1 / -1' : undefined }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{d.label}</span>
                <EditableField value={d.get ? d.get(o) : o?.[d.key] || ''} placeholder={d.ph} fieldKey={`${sectionKey}-${d.key}-${i}`} bold={d.bold} mono={d.mono}
                  onSave={(v) => (d.set ? d.set(i, v) : updateNestedField(sectionKey, i, d.key, v))} />
              </div>
            ))}
          </div>
          {defs.filter((d) => d.multi).map((d) => (
            <div key={d.key} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{d.label}</span>
              <EditableField multiline value={o?.[d.key] || ''} placeholder={d.ph} fieldKey={`${sectionKey}-${d.key}-${i}`} onSave={(v) => updateNestedField(sectionKey, i, d.key, v)} />
            </div>
          ))}
          {extras?.(o)}
        </div>
      ))}
    </div>
  );
};

const LinkChip = ({ url, label, tone }: { url: string; label: string; tone?: 'brand' | 'plain' }) => (
  <a href={url.startsWith('http') ? url : `https://${url}`} target="_blank" rel="noopener noreferrer"
    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 14px', borderRadius: 999, fontSize: 13, fontWeight: 500, background: tone === 'plain' ? '#F6F4F9' : '#F5F1FB', color: tone === 'plain' ? '#171321' : '#4B0082' }}>
    {label} <span aria-hidden="true">↗</span>
  </a>
);
const Chips = ({ label, items, tone }: { label: string; items: string[]; tone?: 'green' }) =>
  items && items.length > 0 ? (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 500 }}>{label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {items.map((t, k) => (
          <span key={k} style={{ fontSize: 13, height: 30, display: 'inline-flex', alignItems: 'center', padding: '0 12px', borderRadius: 999, background: tone === 'green' ? '#E9F6EE' : '#F6F4F9', color: tone === 'green' ? '#1E6B3A' : '#171321' }}>{t}</span>
        ))}
      </div>
    </div>
  ) : null;


// Click-to-edit field styled with the Fyllo input language.
const EditableField = ({ value, onSave, placeholder = 'Click to edit…', multiline = false, bold, mono }: {
  value: string; onSave: (v: string) => void; fieldKey: string; multiline?: boolean; placeholder?: string; bold?: boolean; mono?: boolean;
}) => {
  const [editValue, setEditValue] = useState(value || '');
  const [isEditing, setIsEditing] = useState(false);
  const commit = () => { onSave(editValue); setIsEditing(false); };
  const cancel = () => { setEditValue(value || ''); setIsEditing(false); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !multiline) commit();
    else if (e.key === 'Escape') cancel();
  };
  const font = mono ? 'ui-monospace,monospace' : undefined;

  if (isEditing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {multiline ? (
          <textarea className="fy-input" value={editValue} onChange={(e) => setEditValue(e.target.value)} onKeyDown={onKey} placeholder={placeholder} autoFocus
            style={{ height: 'auto', minHeight: 110, padding: '12px 14px', lineHeight: 1.5, resize: 'vertical' }} />
        ) : (
          <input className="fy-input" value={editValue} onChange={(e) => setEditValue(e.target.value)} onKeyDown={onKey} placeholder={placeholder} autoFocus style={{ fontFamily: font }} />
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="fy-btn fy-dark" onClick={commit} style={{ height: 36, padding: '0 16px', borderRadius: 999, fontSize: 13 }}>Save</button>
          <button type="button" className="fy-btn fy-outline" onClick={cancel} style={{ height: 36, padding: '0 16px', borderRadius: 999, fontSize: 13 }}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div role="button" tabIndex={0} title="Click to edit" onClick={() => { setEditValue(value || ''); setIsEditing(true); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { setEditValue(value || ''); setIsEditing(true); } }}
      style={{ cursor: 'pointer', minHeight: 46, borderRadius: 12, border: '1px solid rgba(23,19,33,.14)', padding: multiline ? '12px 14px' : '0 14px', display: 'flex', alignItems: multiline ? 'flex-start' : 'center', fontSize: 15, background: '#fff', fontWeight: bold ? 500 : 400, fontFamily: font, color: '#171321' }}>
      {value ? (
        value.includes('•') ? (
          <div style={{ width: '100%' }}>
            {value.split('•').filter((s) => s.trim()).map((item, k) => (
              <div key={k} style={{ display: 'flex', gap: 8, marginBottom: 4, lineHeight: 1.5 }}><span style={{ color: '#8A2BE2' }}>•</span><span style={{ flex: 1 }}>{item.trim()}</span></div>
            ))}
          </div>
        ) : <span style={{ whiteSpace: 'pre-line', lineHeight: 1.5 }}>{value}</span>
      ) : <span style={{ color: '#9C97A6' }}>{placeholder}</span>}
    </div>
  );
};

export default ProfileEdit;
