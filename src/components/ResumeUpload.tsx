import React, { useState, useCallback } from 'react';
import { useProfiles } from '@/hooks/useProfiles';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { computeCompletenessFromRow } from '@/utils/profileCompleteness';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ScreeningQuestionsDialog, { ScreeningAnswer } from '@/components/ScreeningQuestionsDialog';

export type ResumeUploadEvent =
  | { type: 'started'; fileName: string }
  | { type: 'profile'; profileId: string }
  | { type: 'uploaded' }
  | { type: 'parsing' }
  | { type: 'saving' }
  | { type: 'done'; profileId: string }
  | { type: 'failed' }
  | { type: 'error' };

// Optional headless mode used by the onboarding flow: the parent renders its own UI,
// receives progress events and supplies screening answers to merge into the final save.
export interface ResumeUploadOnboarding {
  register: (handleFile: (file: File) => void) => void;
  onEvent: (event: ResumeUploadEvent) => void;
  getScreeningAnswers?: () => ScreeningAnswer[];
}

interface ResumeUploadProps {
  onComplete?: () => void;
  onboarding?: ResumeUploadOnboarding;
}

const ResumeUpload = ({ onComplete, onboarding }: ResumeUploadProps) => {
  console.log('🚀 ResumeUpload component rendered');
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showScreeningDialog, setShowScreeningDialog] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [profileNameInput, setProfileNameInput] = useState('');
  const [newProfileId, setNewProfileId] = useState<string | null>(null);
  const { createProfile, updateProfile, getProfile } = useProfiles();
  const { user } = useAuth();
  const { toast } = useToast();

  const uploadResumeToStorage = async (file: File, userId: string, profileId: string) => {
    try {
      const timestamp = Date.now();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = `${userId}/${profileId}_${timestamp}_${safeName}`;

      console.log('📤 Uploading resume to storage:', { filePath, fileType: file.type, fileSize: file.size });

      const { error, data } = await supabase.storage
        .from('resumes')
        .upload(filePath, file, { contentType: file.type, upsert: true });

      if (error) {
        console.error('❌ Resume file upload failed:', error.message, error);
        toast({
          title: "Resume storage failed",
          description: `Could not save resume file: ${error.message}`,
          variant: "destructive",
        });
        return null;
      }

      console.log('✅ Resume file uploaded to storage:', filePath, data);
      return { path: filePath };
    } catch (e) {
      console.error('❌ Resume file upload error:', e);
      toast({
        title: "Resume storage error",
        description: e instanceof Error ? e.message : "Unknown error uploading to storage",
        variant: "destructive",
      });
      return null;
    }
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    console.log('=== DROP EVENT ===');
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    console.log('Files in drop:', e.dataTransfer.files.length);
    if (e.dataTransfer.files?.[0]) {
      console.log('Calling handleFile from drop');
      handleFile(e.dataTransfer.files[0]);
    } else {
      console.log('No files in drop event');
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log('=== FILE INPUT CHANGE ===');
    e.preventDefault();
    console.log('Files in input:', e.target.files?.length || 0);
    if (e.target.files?.[0]) {
      console.log('Calling handleFile from input change');
      handleFile(e.target.files[0]);
    } else {
      console.log('No files in input change event');
    }
  };

  const handleFile = async (file: File, profileName?: string) => {
    // Force console logs to appear
    console.clear();
    console.log('🔥🔥🔥 HANDLE FILE CALLED 🔥🔥🔥');
    console.log('=== HANDLE FILE CALLED ===');
    console.warn('⚠️ HANDLE FILE WARNING LOG');
    console.error('🚨 HANDLE FILE ERROR LOG (this is intentional for visibility)');
    console.log('File object:', file);
    console.log('File name:', file.name);
    console.log('File type:', file.type);
    console.log('File size:', file.size);
    
    const validTypes = [
      'application/pdf', 
      'application/msword', 
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ];
    
    console.log('Valid types:', validTypes);
    console.log('File type valid?', validTypes.includes(file.type));
    
    if (!validTypes.includes(file.type)) {
      console.log('Invalid file type detected');
      toast({
        title: "Invalid file type",
        description: "Please upload a PDF, DOC, DOCX, or TXT file",
        variant: "destructive"
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File too large", 
        description: "File must be less than 10MB",
        variant: "destructive"
      });
      return;
    }

    // Ask for a profile name first so users can tell their profiles apart when filling.
    if (!onboarding && profileName === undefined) {
      setProfileNameInput(file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim());
      setPendingFile(file);
      return;
    }

    setSelectedFile(file);
    setUploading(true);
    onboarding?.onEvent({ type: 'started', fileName: file.name });

    // The browser only creates the profile row, uploads the file and asks the server to
    // process it. Parsing happens in the `process-resume` edge function, which writes the
    // result to the database itself, so refreshing or leaving this page changes nothing.
    const baseName = file.name.replace(/\.[^.]+$/, '');
    const metadata: Record<string, any> = {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      uploadDate: new Date().toISOString(),
      ...(profileName?.trim() ? { profile_name: profileName.trim() } : {}),
      parsing_status: 'Uploading'
    };
    let profileId: string | null = null;

    try {
      const created = await createProfile({
        first_name: baseName,
        last_name: '',
        personal_details: { full_name: baseName },
        resume_metadata: metadata,
        completeness: 0
      });
      if (created.error) {
        const dbMessage = (created.error as { message?: string })?.message;
        throw new Error(dbMessage || 'Failed to start resume processing');
      }
      profileId = created.data?.id ?? null;
      if (!profileId) throw new Error('No profile ID returned');

      setNewProfileId(profileId);
      onboarding?.onEvent({ type: 'profile', profileId });

      // Questions can be answered while the file uploads and the server parses it.
      setUploading(false);
      if (!onboarding) setShowScreeningDialog(true);

      const stored = user?.id ? await uploadResumeToStorage(file, user.id, profileId) : null;
      if (!stored) throw new Error('Could not upload your résumé file');
      onboarding?.onEvent({ type: 'uploaded' });

      await updateProfile(profileId, {
        resume_metadata: { ...metadata, file_path: stored.path, parsing_status: 'Processing' } as any
      });

      const { error: startError } = await supabase.functions.invoke('process-resume', { body: { profileId } });
      if (startError) throw new Error('Could not start résumé processing');
      onboarding?.onEvent({ type: 'parsing' });

      if (onboarding) void watchOnboardingProfile(profileId);
    } catch (error) {
      console.error('Resume upload failed:', error);
      if (profileId) await markProfileFailed(profileId, error instanceof Error ? error.message : 'Upload failed');
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive"
      });
      setUploading(false);
      setSelectedFile(null);
      onboarding?.onEvent({ type: 'error' });
    }
  };

  const markProfileFailed = async (profileId: string, message: string) => {
    const current = await getProfile(profileId);
    const meta = (current.data?.resume_metadata as Record<string, any>) || {};
    await updateProfile(profileId, { resume_metadata: { ...meta, parsing_status: 'Failed', error: message } as any });
  };

  // Onboarding shows its own progress UI, so it follows the server's result by polling the
  // row. Closing the page is fine: the server finishes regardless.
  const watchOnboardingProfile = async (profileId: string) => {
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      const res = await getProfile(profileId);
      const status = (res.data?.resume_metadata as Record<string, any> | undefined)?.parsing_status;
      if (status === 'Completed') {
        onboarding?.onEvent({ type: 'saving' });
        const answers = onboarding?.getScreeningAnswers?.() ?? [];
        if (answers.length > 0) {
          const prefs = (res.data?.job_preferences as Record<string, any>) || {};
          const job_preferences = { ...prefs, screening_answers: answers };
          await updateProfile(profileId, {
            job_preferences: job_preferences as any,
            completeness: computeCompletenessFromRow({ ...res.data, job_preferences }),
          });
        }
        onboarding?.onEvent({ type: 'done', profileId });
        return;
      }
      if (status === 'Failed') {
        onboarding?.onEvent({ type: 'failed' });
        return;
      }
    }
    onboarding?.onEvent({ type: 'failed' });
  };

  // Parsing keeps running in the background after the dialog closes, so these toasts
  // must not claim the résumé is done; the profile card shows the live status.
  const handleScreeningSave = async (answers: ScreeningAnswer[]) => {
    if (newProfileId && answers.length > 0) {
      // Merge rather than replace: parsing may already have saved AI preferences.
      const current = await getProfile(newProfileId);
      const currentPrefs = (current.data?.job_preferences as Record<string, any>) || {};
      const job_preferences = { ...currentPrefs, screening_answers: answers };
      await updateProfile(newProfileId, {
        job_preferences: job_preferences as any,
        completeness: computeCompletenessFromRow({ ...current.data, job_preferences }),
      });
    }
    setShowScreeningDialog(false);
    toast({
      title: "Answers saved",
      description: "We're still reading your résumé. It'll show as ready on your dashboard shortly.",
    });
    onComplete?.();
  };

  const handleScreeningSkip = () => {
    setShowScreeningDialog(false);
    toast({
      title: "Skipped for now",
      description: "We're still reading your résumé. You can add screening answers later from your profile.",
    });
    onComplete?.();
  };

  const confirmProfileName = () => {
    const file = pendingFile;
    if (!file) return;
    setPendingFile(null);
    handleFile(file, profileNameInput.trim());
  };

  const removeFile = () => {
    setSelectedFile(null);
  };

  // Headless onboarding mode: hand the upload handler to the parent, render nothing.
  if (onboarding) {
    onboarding.register(handleFile);
    return null;
  }

  if (uploading) {
    return (
      <div role="status" style={{ textAlign: 'center', padding: '48px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <span className="fy-spin" style={{ width: 28, height: 28, borderWidth: 3 }} aria-hidden="true" />
        <h3 className="sg" style={{ margin: 0, fontWeight: 500, fontSize: 22, letterSpacing: '-0.025em' }}>Reading your résumé…</h3>
        <p style={{ margin: 0, fontSize: 14, color: '#6C6577' }}>This usually takes a few seconds.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h3 className="sg" style={{ margin: 0, fontWeight: 500, fontSize: 22, letterSpacing: '-0.025em' }}>Upload your résumé</h3>
        <p style={{ margin: 0, fontSize: 15, color: '#6C6577' }}>Fyllo reads it and builds your profile. You can review everything afterwards.</p>
      </div>

      {!selectedFile ? (
        <div
          style={{ position: 'relative', border: `1.5px dashed ${dragActive ? '#8A2BE2' : 'rgba(23,19,33,.18)'}`, borderRadius: 16, padding: '44px 20px', textAlign: 'center', background: dragActive ? '#F5F1FB' : '#fff', transition: 'background .2s,border-color .2s', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <span style={{ fontSize: 16, fontWeight: 500 }}>Drop your résumé here, or click to browse</span>
          <span style={{ fontSize: 13, color: '#6C6577' }}>PDF, DOC, DOCX or TXT, up to 10MB</span>
          <input
            type="file"
            accept=".pdf,.doc,.docx,.txt"
            onChange={handleChange}
            aria-label="Choose a résumé file"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
          />
          <span className="fy-btn fy-dark" style={{ height: 40, padding: '0 18px', borderRadius: 999, fontSize: 14, marginTop: 8 }}>Browse files</span>
        </div>
      ) : (
        <div style={{ border: '1px solid rgba(23,19,33,.1)', borderRadius: 16, padding: '16px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedFile.name}</div>
            <div style={{ fontSize: 13, color: '#6C6577' }}>{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</div>
          </div>
          <button type="button" onClick={removeFile} aria-label="Remove file" className="fy-btn fy-ghost" style={{ width: 36, height: 36, borderRadius: '50%', color: '#6C6577', fontSize: 20 }}>×</button>
        </div>
      )}

      <p style={{ margin: 0, fontSize: 13, color: '#9C97A6' }}>Your résumé is processed securely and never shared.</p>

      <Dialog open={!!pendingFile} onOpenChange={(open) => { if (!open) setPendingFile(null); }}>
        <DialogContent className="fy" style={{ minHeight: 0, maxWidth: 460, borderRadius: 24, padding: 28, border: 0, boxShadow: '0 40px 80px -24px rgba(23,19,33,.45)' }}>
          <DialogHeader>
            <DialogTitle className="sg" style={{ fontWeight: 500, fontSize: 22, letterSpacing: '-0.025em' }}>Name this profile</DialogTitle>
            <DialogDescription style={{ fontSize: 14, lineHeight: 1.5, color: '#6C6577' }}>
              Pick a name that tells it apart from your other profiles, like "Product Manager" or "Data Analyst". You'll choose by this name when filling applications.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); confirmProfileName(); }} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <input
              className="fy-input"
              autoFocus
              value={profileNameInput}
              onChange={(e) => setProfileNameInput(e.target.value)}
              placeholder="e.g., Product Manager"
              aria-label="Profile name"
            />
            <DialogFooter>
              <button type="button" className="fy-btn fy-outline" onClick={() => setPendingFile(null)} style={{ height: 42, padding: '0 18px', borderRadius: 999, fontSize: 14 }}>Cancel</button>
              <button type="submit" className="fy-btn fy-dark" disabled={!profileNameInput.trim()} style={{ height: 42, padding: '0 18px', borderRadius: 999, fontSize: 14 }}>Continue</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ScreeningQuestionsDialog
        isOpen={showScreeningDialog}
        onClose={handleScreeningSkip}
        onSave={handleScreeningSave}
      />
    </div>
  );
};

export default ResumeUpload;
