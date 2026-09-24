import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProfiles } from '@/hooks/useProfiles';
import { useToast } from '@/hooks/use-toast';
import DeleteProfileDialog from './DeleteProfileDialog';
import ResumeUpload from './ResumeUpload';
import './fyllo/fyllo.css';

const PENDING = ['Pending', 'Uploading', 'Processing'];
const CHIPS = ['#8A2BE2', '#171321'];

interface ProfileListProps {
  isPro?: boolean;
  onUpgrade?: () => void;
}

const fmtUpdated = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Updated today';
  return `Updated ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
};

const ProfileList = ({ isPro = true, onUpgrade }: ProfileListProps) => {
  const navigate = useNavigate();
  const { profiles, loading, deleteProfile, refetch } = useProfiles();
  const { toast } = useToast();
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => {
    // Poll every 3 seconds if any profile is currently parsing in the background
    const hasPending = profiles.some(p => PENDING.includes((p.resume_metadata as any)?.parsing_status));
    if (hasPending) {
      const interval = setInterval(() => { refetch(); }, 3000);
      return () => clearInterval(interval);
    }
  }, [profiles, refetch]);

  const [deleteDialog, setDeleteDialog] = useState<{ isOpen: boolean; profileId: string; profileName: string }>({
    isOpen: false, profileId: '', profileName: ''
  });

  const handleEdit = (profileId: string) => navigate(`/profile/edit/${profileId}`);
  const handleDelete = (profileId: string, profileName: string) =>
    setDeleteDialog({ isOpen: true, profileId, profileName });

  const confirmDelete = async () => {
    try {
      const { error } = await deleteProfile(deleteDialog.profileId);
      if (error) {
        toast({ title: 'Error', description: 'Failed to delete profile. Please try again.', variant: 'destructive' });
      } else {
        toast({ title: 'Success', description: 'Profile deleted successfully.' });
      }
    } catch (error) {
      console.error('Error deleting profile:', error);
      toast({ title: 'Error', description: 'Failed to delete profile. Please try again.', variant: 'destructive' });
    }
    setDeleteDialog({ isOpen: false, profileId: '', profileName: '' });
  };

  const closeDialog = () => setDeleteDialog({ isOpen: false, profileId: '', profileName: '' });
  const handleUploadComplete = () => setShowUpload(false);

  // Free plan = 1 profile; a second one routes to the upgrade prompt.
  const atFreeLimit = !isPro && profiles.length >= 1;
  const startUpload = () => {
    if (atFreeLimit) onUpgrade?.();
    else setShowUpload(true);
  };

  const getProfileStats = (profile: any) => {
    const workExperience = Array.isArray(profile.work_experience) ? profile.work_experience : [];
    const education = Array.isArray(profile.education_history) ? profile.education_history : [];
    const skills = (profile.technical_skills as any)?.all || [];
    const projects = Array.isArray(profile.projects) ? profile.projects : [];
    const certifications = Array.isArray(profile.certifications_licenses) ? profile.certifications_licenses : [];
    const personalDetails = profile.personal_details as any;
    return {
      experienceCount: workExperience.length,
      educationCount: education.length,
      skillsCount: Array.isArray(skills) ? skills.length : 0,
      projectsCount: projects.length,
      certificationsCount: certifications.length,
      hasPersonalDetails: Boolean(personalDetails?.email),
    };
  };

  const getProfileSummary = (profile: any) => {
    const personalDetails = profile.personal_details || {};
    const workExp = profile.work_experience?.[0];
    const fullName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || personalDetails.full_name || personalDetails.fullName || '';
    const profileName = profile.resume_metadata?.profile_name || fullName || 'Untitled profile';
    const role = [workExp?.jobTitle, fullName].filter(Boolean).join(' · ');
    return { name: profileName, role };
  };

  if (loading) {
    return (
      <section style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <h2 className="sg" style={{ margin: 0, fontWeight: 500, fontSize: 24, letterSpacing: '-0.025em' }}>Profiles</h2>
        <div className="fy-card" style={{ padding: 22, display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#6C6577' }} role="status">
          <span className="fy-spin" style={{ width: 14, height: 14 }} aria-hidden="true" />Loading your profiles…
        </div>
      </section>
    );
  }

  if (showUpload) {
    return (
      <section aria-labelledby="profiles-h" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <h2 id="profiles-h" className="sg" style={{ margin: 0, fontWeight: 500, fontSize: 24, letterSpacing: '-0.025em' }}>Upload résumé</h2>
          <button type="button" className="fy-btn fy-outline" style={{ height: 40, padding: '0 16px', borderRadius: 999, fontSize: 14 }} onClick={() => setShowUpload(false)}>Cancel</button>
        </div>
        <div className="fy-card" style={{ padding: 'clamp(22px,4vw,32px)' }}>
          <ResumeUpload onComplete={handleUploadComplete} />
        </div>
      </section>
    );
  }

  return (
    <>
      <section aria-labelledby="profiles-h" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <h2 id="profiles-h" className="sg" style={{ margin: 0, fontWeight: 500, fontSize: 24, letterSpacing: '-0.025em' }}>Profiles</h2>
          <button type="button" onClick={startUpload} className="fy-btn fy-outline" style={{ height: 40, padding: '0 16px', borderRadius: 999, fontSize: 14, flex: 'none' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /><path d="M12 5v14" /></svg>Upload résumé
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,340px),1fr))', gap: 16 }}>
          {profiles.map((profile, i) => {
            const st = getProfileStats(profile);
            const summary = getProfileSummary(profile);
            const status = (profile.resume_metadata as any)?.parsing_status;
            const parsing = PENDING.includes(status);
            const failed = status === 'Failed';
            const ready = !parsing && !failed;
            const low = ready && profile.completeness < 75;
            const stats = [
              st.experienceCount > 0 && `${st.experienceCount} job${st.experienceCount !== 1 ? 's' : ''}`,
              st.educationCount > 0 && `${st.educationCount} degree${st.educationCount !== 1 ? 's' : ''}`,
              st.skillsCount > 0 && `${st.skillsCount} skill${st.skillsCount !== 1 ? 's' : ''}`,
              st.projectsCount > 0 && `${st.projectsCount} project${st.projectsCount !== 1 ? 's' : ''}`,
              st.certificationsCount > 0 && `${st.certificationsCount} cert${st.certificationsCount !== 1 ? 's' : ''}`,
            ].filter(Boolean) as string[];
            return (
              <article key={profile.id} className="fy-card" style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 18 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                  <div aria-hidden="true" className="sg" style={{ width: 44, height: 44, borderRadius: 12, background: CHIPS[i % 2], color: '#fff', fontWeight: 600, fontSize: 17, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{summary.name.charAt(0).toUpperCase()}</div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500 }}>{summary.name}</h3>
                    </div>
                    {summary.role && <span style={{ fontSize: 13, color: '#6C6577' }}>{summary.role}</span>}
                  </div>
                </div>
                {parsing && (
                  <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#6C6577' }}>
                    <span className="fy-spin" style={{ width: 14, height: 14 }} aria-hidden="true" />{status === 'Uploading' ? 'Uploading your résumé…' : 'Reading your résumé…'}
                  </div>
                )}
                {failed && (
                  <p style={{ margin: 0, padding: '10px 12px', borderRadius: 12, background: '#FDECEA', color: '#B42318', fontSize: 13, lineHeight: 1.5 }}>We couldn't read this résumé. Open the profile to fill it in by hand, or upload it again.</p>
                )}
                {ready && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: '#6C6577' }}>Complete</span><span style={{ fontWeight: 500 }}>{profile.completeness}%</span></div>
                    <div style={{ height: 4, borderRadius: 4, background: '#F0ECF5', overflow: 'hidden' }}><div style={{ height: '100%', width: `${profile.completeness}%`, background: low ? '#C9A64A' : '#8A2BE2', borderRadius: 4 }} /></div>
                  </div>
                )}
                {low && (
                  <p style={{ margin: 0, padding: '10px 12px', borderRadius: 12, background: '#FFF6E5', color: '#8A5A00', fontSize: 13, lineHeight: 1.5 }}>
                    Needs to be 75% complete before Fyllo can fill with it.{' '}
                    {[!st.hasPersonalDetails && 'Add personal details.', st.experienceCount === 0 && 'Add work experience.', st.skillsCount === 0 && 'Add skills.'].filter(Boolean).join(' ')}
                  </p>
                )}
                {stats.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {stats.map((s) => <span key={s} style={{ fontSize: 12, color: '#6C6577', background: '#F6F4F9', padding: '4px 10px', borderRadius: 999 }}>{s}</span>)}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 4, borderTop: '1px solid rgba(23,19,33,.06)' }}>
                  <button type="button" className="fy-btn fy-ghost" disabled={parsing} onClick={() => handleEdit(profile.id)} style={{ height: 38, padding: '0 14px', borderRadius: 999, fontSize: 14, marginTop: 10 }}>Edit profile</button>
                  <button type="button" className="fy-btn fy-ghost" onClick={() => handleDelete(profile.id, summary.name)} style={{ height: 38, padding: '0 14px', borderRadius: 999, fontSize: 14, marginTop: 10, color: '#B42318' }}>Delete</button>
                  <span style={{ flex: 1 }} />
                  <span style={{ marginTop: 10, display: 'flex', alignItems: 'center', fontSize: 12, color: '#9C97A6' }}>{fmtUpdated(profile.updated_at)}</span>
                </div>
              </article>
            );
          })}
          {profiles.length === 0 && (
            <div style={{ borderRadius: 20, border: '1px dashed rgba(23,19,33,.18)', padding: 22, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10, minHeight: 200 }}>
              <span style={{ fontSize: 16, fontWeight: 500 }}>No profiles yet</span>
              <span style={{ fontSize: 14, lineHeight: 1.55, color: '#6C6577' }}>Upload your résumé and Fyllo will build your first profile from it.</span>
              <button type="button" onClick={startUpload} className="fy-btn fy-primary" style={{ alignSelf: 'flex-start', marginTop: 6, height: 38, padding: '0 16px', borderRadius: 999, fontSize: 14 }}>Upload résumé</button>
            </div>
          )}
          {atFreeLimit && (
            <div style={{ borderRadius: 20, border: '1px dashed rgba(23,19,33,.18)', padding: 22, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10, minHeight: 200 }}>
              <span style={{ fontSize: 16, fontWeight: 500 }}>Applying for more than one kind of role?</span>
              <span style={{ fontSize: 14, lineHeight: 1.55, color: '#6C6577' }}>Keep a separate profile for each with Pro — unlimited profiles and autofills.</span>
              <button type="button" onClick={onUpgrade} className="fy-btn" style={{ alignSelf: 'flex-start', marginTop: 6, height: 38, padding: '0 16px', borderRadius: 999, background: '#F5F1FB', color: '#4B0082', fontSize: 14 }}>See Pro</button>
            </div>
          )}
        </div>
      </section>

      <DeleteProfileDialog
        isOpen={deleteDialog.isOpen}
        onClose={closeDialog}
        onConfirm={confirmDelete}
        profileName={deleteDialog.profileName}
      />
    </>
  );
};

export default ProfileList;
