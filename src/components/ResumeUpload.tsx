import React, { useState, useCallback } from 'react';
import { useProfiles } from '@/hooks/useProfiles';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { extractNameFromResume, parseFullName } from '@/utils/nameParser';
import ScreeningQuestionsDialog, { ScreeningAnswer } from '@/components/ScreeningQuestionsDialog';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';

// Use legacy build for better compatibility
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.js',
  import.meta.url
).toString();

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

  const extractTextFromPDF = async (file: File): Promise<string> => {
    console.log('=== PDF EXTRACTION START ===');
    console.log('File details:', {
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified
    });
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      console.log('ArrayBuffer created successfully, length:', arrayBuffer.byteLength);
      
      // Check if arrayBuffer is valid
      if (arrayBuffer.byteLength === 0) {
        throw new Error('File appears to be empty');
      }
      
      console.log('Loading PDF document...');
      const loadingTask = pdfjsLib.getDocument({
        data: arrayBuffer,
        verbosity: 0 // Reduce logging
      });
      
      const pdf = await loadingTask.promise;
      console.log('PDF loaded successfully! Number of pages:', pdf.numPages);

      let fullText = '';
      
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        try {
          console.log(`Processing page ${pageNum}/${pdf.numPages}`);
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          
          // Enhanced text extraction with better formatting
          const pageText = textContent.items
            .map((item: any, index: number) => {
              if (item && typeof item === 'object' && item.str) {
                let text = item.str.trim();
                
                // Add line breaks for proper formatting
                const nextItem = textContent.items[index + 1];
                if (nextItem && (item as any).transform && (nextItem as any).transform) {
                  const currentY = (item as any).transform[5];
                  const nextY = (nextItem as any).transform[5];
                  
                  // If next item is significantly lower, add line break
                  if (Math.abs(currentY - nextY) > 3) {
                    text += '\n';
                  } else {
                    text += ' ';
                  }
                }
                
                return text;
              }
              return '';
            })
            .join('')
            .replace(/\s+/g, ' ') // Clean up multiple spaces
            .replace(/\n\s*\n/g, '\n') // Clean up multiple line breaks
            .trim();
          
          if (pageText.length > 0) {
            fullText += pageText + '\n\n';
            console.log(`Page ${pageNum} extracted ${pageText.length} characters`);
          }
          
        } catch (pageError) {
          console.warn(`Error processing page ${pageNum}:`, pageError);
          // Continue with other pages
        }
      }

      console.log('=== PDF EXTRACTION COMPLETE ===');
      console.log('Total extracted text length:', fullText.length);
      console.log('Number of pages:', pdf.numPages);
      
      if (fullText.length === 0) {
        throw new Error('No text could be extracted from the PDF');
      }
      
      console.log('Sample extracted text (first 500 chars):');
      console.log(fullText.substring(0, 500));
      
      return fullText.trim();
      
    } catch (error) {
      console.error('=== PDF EXTRACTION ERROR ===');
      console.error('Error type:', typeof error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // Return a more descriptive fallback
      const fallbackText = `Error extracting text from PDF: ${file.name}. Error: ${error instanceof Error ? error.message : String(error)}`;
      console.log('Using fallback text:', fallbackText);
      return fallbackText;
    }
  };

  const parseResumeWithAI = async (file: File) => {
    console.log('=== AI PARSING START ===');
    console.log('Starting parse for:', file.name);
    
    let requestBody: any = {
      fileName: file.name,
      fileType: file.type
    };

    // Handle different file types
    if (file.type === 'application/pdf') {
      console.log('Processing PDF file for AI parsing...');
      const resumeText = await extractTextFromPDF(file);
      const truncatedText = resumeText.substring(0, 15000);
      
      console.log('Original text length:', resumeText.length);
      console.log('Truncated text length:', truncatedText.length);
      console.log('Text being sent to AI (first 300 chars):');
      console.log(truncatedText.substring(0, 300));
      
      requestBody = {
        resumeText: truncatedText,
        fileName: file.name
      };
    } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      try {
        console.log('Processing DOCX file...');
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        const truncatedText = result.value.substring(0, 15000);
        
        console.log('DOCX text length:', result.value.length);
        console.log('DOCX truncated length:', truncatedText.length);
        
        requestBody.resumeText = truncatedText;
      } catch (error) {
        console.log('DOCX extraction failed, using filename');
        console.error('DOCX error:', error);
      }
    } else if (file.type === 'text/plain') {
      try {
        console.log('Processing TXT file...');
        const text = await file.text();
        const truncatedText = text.substring(0, 15000);
        
        console.log('TXT text length:', text.length);
        console.log('TXT truncated length:', truncatedText.length);
        
        requestBody.resumeText = truncatedText;
      } catch (error) {
        console.log('Text extraction failed, using filename');
        console.error('TXT error:', error);
      }
    }

    console.log('=== SENDING TO OPENAI ===');
    console.log('Request body structure:', {
      hasFileName: !!requestBody.fileName,
      hasResumeText: !!requestBody.resumeText,
      resumeTextLength: requestBody.resumeText?.length || 0,
      fileType: requestBody.fileType
    });
    
    if (requestBody.resumeText) {
      console.log('First 200 chars being sent to OpenAI:');
      console.log(requestBody.resumeText.substring(0, 200));
    } else {
      console.log('No resume text extracted, sending only filename');
    }
    
    const { data, error } = await supabase.functions.invoke('azure-resume-parser', {
      body: requestBody
    });

    console.log('=== OPENAI RESPONSE ===');
    if (error) {
      console.error('Edge function error:', error);
      throw new Error('Failed to parse resume');
    }
    
    console.log('OpenAI response received:', {
      hasData: !!data,
      dataKeys: data ? Object.keys(data) : [],
      dataStructure: data
    });

    return data;
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

  const handleFile = async (file: File) => {
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

    setSelectedFile(file);
    setUploading(true);
    onboarding?.onEvent({ type: 'started', fileName: file.name });

    let initialFirstName = file.name;
    let initialLastName = '';
    
    // Attempt rapid local text extraction to grab the name from the top of the resume
    try {
      const arrayBuffer = await file.arrayBuffer();
      if (file.type === 'application/pdf') {
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
        const page = await pdf.getPage(1);
        const textContent = await page.getTextContent();
        const items = textContent.items
          .map((i: any) => i.str.trim())
          .filter((s: string) => s.length > 2 && s.length < 40 && !s.toLowerCase().includes('resume'));
        if (items.length > 0) {
          const parsed = parseFullName(items[0]);
          if (parsed.first_name) {
            initialFirstName = parsed.first_name;
            initialLastName = parsed.last_name || '';
          }
        }
      } else if (file.name.endsWith('.docx')) {
        const result = await mammoth.extractRawText({ arrayBuffer });
        const lines = result.value.split('\n').map(l => l.trim()).filter(l => l.length > 2 && l.length < 40 && !l.toLowerCase().includes('resume'));
        if (lines.length > 0) {
          const parsed = parseFullName(lines[0]);
          if (parsed.first_name) {
            initialFirstName = parsed.first_name;
            initialLastName = parsed.last_name || '';
          }
        }
      }
    } catch (e) {
      console.warn('Local name extraction skipped:', e);
    }

    try {
      // 1. Create a skeleton "Pending" profile immediately
      const skeletonProfile = {
        first_name: initialFirstName,
        last_name: initialLastName,
        personal_details: {
          full_name: `${initialFirstName} ${initialLastName}`.trim() || file.name
        },
        resume_metadata: {
          fileName: file.name,
          fileSize: file.size,
          uploadDate: new Date().toISOString(),
          parsing_status: 'Uploading'
        },
        completeness: 0
      };

      console.log('Creating skeleton profile:', skeletonProfile);
      const initialResult = await createProfile(skeletonProfile);
      
      if (initialResult.error) {
        const dbMessage = (initialResult.error as { message?: string })?.message;
        throw new Error(dbMessage || 'Failed to start resume processing');
      }

      const profileId = initialResult.data?.id;
      if (!profileId) throw new Error('No profile ID returned');
      
      setNewProfileId(profileId);
      onboarding?.onEvent({ type: 'profile', profileId });
      
      // Stop the main uploading spinner and show the screening questions dialog immediately
      setUploading(false);
      if (!onboarding) setShowScreeningDialog(true);
      
      // 2. Start the background parsing and updating task
      (async () => {
        // === UPLOAD PHASE ===
        let uploadPath = null;
        if (user?.id && file) {
          const uploadResult = await uploadResumeToStorage(file, user.id, profileId);
          if (uploadResult) uploadPath = uploadResult.path;
        }
        onboarding?.onEvent({ type: 'uploaded' });

        // Update profile to reflect that uploading is done and AI processing is starting
        await updateProfile(profileId, {
          first_name: initialFirstName,
          last_name: initialLastName,
          personal_details: {
            full_name: `${initialFirstName} ${initialLastName}`.trim() || file.name
          },
          resume_metadata: {
            ...skeletonProfile.resume_metadata,
            file_path: uploadPath,
            parsing_status: 'Processing'
          } as any
        });
        
        // === PARSING PHASE ===
        onboarding?.onEvent({ type: 'parsing' });
        let success = false;
        let lastError = null;
        let parsedData = null;
        
        // Retry logic: 3 attempts with 10s backoff
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            console.log(`=== BACKGROUND PARSING ATTEMPT ${attempt} ===`);
            parsedData = await parseResumeWithAI(file);
            success = true;
            break; // Success, exit retry loop
          } catch (err) {
            lastError = err;
            console.warn(`Parse attempt ${attempt} failed:`, err);
            if (attempt < 3) {
              await new Promise(resolve => setTimeout(resolve, 10000)); // 10s wait
            }
          }
        }
        
        // If all attempts failed, mark the profile as Failed
        if (!success) {
          console.error('All parsing attempts failed. Marking profile as Failed.');
          // Fetch current profile to not overwrite user changes
          const currentProfileRes = await getProfile(profileId);
          const currentMetadata = currentProfileRes.data?.resume_metadata as Record<string, any> || {};
          
          await updateProfile(profileId, {
            first_name: 'Failed',
            last_name: 'Upload',
            personal_details: { full_name: 'Unknown User' },
            resume_metadata: {
              ...currentMetadata,
              parsing_status: 'Failed',
              error: lastError instanceof Error ? lastError.message : 'Failed after 3 attempts'
            } as any
          });
          
          onboarding?.onEvent({ type: 'failed' });
          toast({
            title: "Background processing failed",
            description: "We could not parse your resume. Please try uploading again.",
            variant: "destructive"
          });
          return;
        }
        
        console.log('=== BACKGROUND PROCESSING SUCCESS ===');
        console.log('Parsed Data:', parsedData);
        
        // Extract and parse name components
        const nameData = extractNameFromResume(parsedData);
        
        // Helper function to calculate data completeness
        const calculateDataCompleteness = (data: any): number => {
          let score = 0;
          if (data.personalInfo?.fullName) score += 10;
          if (data.personalInfo?.email) score += 10;
          if (data.personalInfo?.phone) score += 10;
          if (data.summary) score += 10;
          if (data.experience?.length > 0) score += 20;
          if (data.education?.length > 0) score += 15;
          if (data.skills?.technical?.length > 0) score += 10;
          if (data.projects?.length > 0) score += 10;
          if (data.certifications?.length > 0) score += 5;
          return Math.min(score, 100);
        };
        
        // Map the parsed data into profile fields
        const profileDataToUpdate = {
          first_name: nameData.first_name || 'Unknown',
          middle_name: nameData.middle_name || '',
          last_name: nameData.last_name || 'User',
          personal_details: (() => {
            const raw = parsedData.personalInfo?.address;
            let address = { line1: "", line2: "", city: "", state: "", postalCode: "", country: "" };
            if (raw && typeof raw === 'object') {
              address = {
                line1: raw.line1 || raw.street || "",
                line2: raw.line2 || "",
                city: raw.city || "",
                state: raw.state || "",
                postalCode: raw.postalCode || raw.zip || "",
                country: raw.country || "",
              };
            } else if (typeof raw === 'string' && raw) {
              address = { ...address, line1: raw };
            }
            return {
              ...parsedData.personalInfo,
              full_name: nameData.full_name || `${nameData.first_name} ${nameData.last_name}`.trim() || 'Unknown User',
              firstName: nameData.first_name || '',
              lastName: nameData.last_name || '',
              summary: parsedData.summary || "",
              email: parsedData.personalInfo?.email || "",
              phone: (parsedData.personalInfo?.phone || "").replace(/\s+/g, ''),
              phoneExtension: (parsedData.personalInfo?.phoneExtension && parsedData.personalInfo.phoneExtension !== 'empty string') ? parsedData.personalInfo.phoneExtension : "",
              address,
              linkedin: parsedData.personalInfo?.linkedin || "",
              github: parsedData.personalInfo?.github || "",
              portfolio: parsedData.personalInfo?.portfolio || "",
            };
          })(),
          
          education_history: Array.isArray(parsedData.education) ? parsedData.education.map((edu: any) => {
            const normalizeEduDate = (d: any) => {
              if (d && typeof d === 'object' && 'year' in d) return { year: d.year || "", month: d.month || "" };
              if (typeof d === 'string') {
                const s = d.trim();
                const ym = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
                if (ym) return { year: ym[2], month: ym[1] };
                const my = s.match(/^(\d{4})[\/\-](\d{1,2})$/);
                if (my) return { year: my[1], month: my[2] };
                const yOnly = s.match(/^(\d{4})$/);
                if (yOnly) return { year: yOnly[1], month: "" };
                return { year: s, month: "" };
              }
              return { year: "", month: "" };
            };
            return {
              degree: edu.degree || "",
              school: edu.school || "",
              location: edu.location || "",
              startDate: normalizeEduDate(edu.startDate),
              endDate: normalizeEduDate(edu.endDate),
              description: edu.description || "",
              gpa: edu.gpa || "",
              honors: edu.honors || "",
              coursework: edu.coursework || ""
            };
          }) : [],
          
          work_experience: Array.isArray(parsedData.experience) ? parsedData.experience.map((exp: any) => ({
            jobTitle: exp.jobTitle || "",
            company: exp.company || "",
            location: exp.location || "",
            startDate: exp.startDate || "",
            endDate: exp.endDate || "",
            description: exp.description || "",
            achievements: exp.achievements || [],
            technologies: exp.technologies || [],
            metrics: exp.metrics || []
          })) : [],
          
          technical_skills: {
            programming: parsedData.skills?.technical?.filter((skill: string) => 
              ['java', 'javascript', 'python', 'react', 'node', 'typescript', 'c++', 'c#'].some(lang => 
                skill.toLowerCase().includes(lang)
              )) || [],
            frameworks: parsedData.skills?.technical?.filter((skill: string) => 
              ['react', 'angular', 'vue', 'express', 'spring', 'django', 'flask'].some(framework => 
                skill.toLowerCase().includes(framework)
              )) || [],
            databases: parsedData.skills?.technical?.filter((skill: string) => 
              ['postgresql', 'mysql', 'mongodb', 'redis', 'sql'].some(db => 
                skill.toLowerCase().includes(db)
              )) || [],
            cloud: parsedData.skills?.technical?.filter((skill: string) => 
              ['aws', 'azure', 'gcp', 'docker', 'kubernetes', 'devops'].some(cloud => 
                skill.toLowerCase().includes(cloud)
              )) || [],
            all: parsedData.skills?.technical || []
          },
          
          soft_skills: {
            leadership: parsedData.skills?.soft?.filter((skill: string) => 
              ['leadership', 'management', 'team'].some(lead => 
                skill.toLowerCase().includes(lead)
              )) || [],
            communication: parsedData.skills?.soft?.filter((skill: string) => 
              ['communication', 'presentation', 'writing'].some(comm => 
                skill.toLowerCase().includes(comm)
              )) || [],
            all: parsedData.skills?.soft || []
          },
          
          tools_technologies: {
            development: parsedData.skills?.tools?.filter((tool: string) => 
              ['vscode', 'intellij', 'eclipse', 'git', 'github', 'gitlab'].some(dev => 
                tool.toLowerCase().includes(dev)
              )) || [],
            design: parsedData.skills?.tools?.filter((tool: string) => 
              ['adobe', 'photoshop', 'illustrator', 'figma', 'canva'].some(design => 
                tool.toLowerCase().includes(design)
              )) || [],
            productivity: parsedData.skills?.tools?.filter((tool: string) => 
              ['jira', 'confluence', 'trello', 'slack', 'teams'].some(prod => 
                tool.toLowerCase().includes(prod)
              )) || [],
            all: parsedData.skills?.tools || []
          },
          
          certifications_licenses: Array.isArray(parsedData.certifications) ? parsedData.certifications.map((cert: any) => ({
            name: cert.name || "",
            issuingOrganization: cert.issuingOrganization || "",
            dateIssued: cert.dateIssued || "",
            expirationDate: cert.expirationDate || "",
            credentialId: cert.credentialId || "",
            credentialUrl: cert.credentialUrl || ""
          })) : [],
          
          awards_honors: Array.isArray(parsedData.awards) ? parsedData.awards.map((award: any) => ({
            title: award.title || "",
            issuer: award.issuer || "",
            date: award.date || "",
            description: award.description || "",
            significance: award.significance || ""
          })) : [],
          
          projects: Array.isArray(parsedData.projects) ? parsedData.projects.map((project: any) => ({
            name: project.name || "",
            description: project.description || "",
            technologies: Array.isArray(project.technologies) ? project.technologies : [],
            role: project.role || "",
            duration: project.duration || "",
            url: project.url || "",
            repository: project.repository || "",
            impact: project.impact || "",
            metrics: project.metrics || []
          })) : [],
          
          languages: Array.isArray(parsedData.languages) ? parsedData.languages.map((lang: any) => {
            if (typeof lang === 'string') {
              return { language: lang, proficiency: "" };
            }
            return {
              language: lang.language || lang.name || "",
              proficiency: lang.proficiency || lang.level || ""
            };
          }) : [],
          
          volunteer_experience: Array.isArray(parsedData.volunteer) ? parsedData.volunteer.map((vol: any) => ({
            organization: vol.organization || "",
            role: vol.role || "",
            location: vol.location || "",
            startDate: vol.startDate || "",
            endDate: vol.endDate || "",
            description: vol.description || "",
            impact: vol.impact || ""
          })) : [],
          
          completeness: calculateDataCompleteness(parsedData)
        };
        
        onboarding?.onEvent({ type: 'saving' });
        // Before updating, get current profile to preserve user settings like screening answers
        const currentProfileRes = await getProfile(profileId);
        const currentData = currentProfileRes.data || {};
        const currentJobPrefs = currentData.job_preferences as Record<string, any> || {};

        // Apply final update to turn 'Processing' into 'Completed'
        const finalUpdate = await updateProfile(profileId, {
          ...profileDataToUpdate,
          job_preferences: {
            ...currentJobPrefs,                // Preserve existing manual answers
            ...parsedData.job_preferences,     // Merge any AI preferences
            ...(() => {
              const answers = onboarding?.getScreeningAnswers?.() ?? [];
              return answers.length > 0 ? { screening_answers: answers } : {};
            })()
          } as any,
          resume_metadata: {
            ...skeletonProfile.resume_metadata,
            openAIResponse: parsedData,
            file_path: uploadPath, // preserve the path we got earlier
            parsing_status: 'Completed',
            extractionQuality: {
              hasPersonalInfo: !!parsedData.personalInfo,
              hasWorkExperience: Array.isArray(parsedData.experience) && parsedData.experience.length > 0,
              hasEducation: Array.isArray(parsedData.education) && parsedData.education.length > 0,
              hasSkills: !!parsedData.skills,
              hasProjects: Array.isArray(parsedData.projects) && parsedData.projects.length > 0,
              dataCompleteness: calculateDataCompleteness(parsedData)
            }
          } as any
        });
        
        if (finalUpdate.error) {
           console.error('Final background update failed:', finalUpdate.error);
           onboarding?.onEvent({ type: 'failed' });
        } else {
           onboarding?.onEvent({ type: 'done', profileId });
           console.log('Background processing fully complete:', finalUpdate.data);
           // We can optionally fire an event or toast here
           toast({
             title: "Resume parsed successfully!",
             description: `Extracted ${profileDataToUpdate.work_experience.length} roles and ${profileDataToUpdate.education_history.length} degrees.`,
           });
        }
      })(); // execute background closure
      
    } catch (error) {
      console.error('=== INITIALIZATION ERROR ===');
      console.error('Error:', error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive"
      });
      setUploading(false);
      setSelectedFile(null);
      onboarding?.onEvent({ type: 'error' });
    }
    // We NO LONGER have a finally block here clearing state 
    // because processing continues in the background!
  };

  const handleScreeningSave = async (answers: ScreeningAnswer[]) => {
    if (newProfileId && answers.length > 0) {
      await updateProfile(newProfileId, {
        job_preferences: { screening_answers: answers } as any,
      });
    }
    setShowScreeningDialog(false);
    toast({
      title: "Success!",
      description: "Resume processed and screening answers saved",
    });
    onComplete?.();
  };

  const handleScreeningSkip = () => {
    setShowScreeningDialog(false);
    toast({
      title: "Success!",
      description: "Resume processed and profile created",
    });
    onComplete?.();
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

      <ScreeningQuestionsDialog
        isOpen={showScreeningDialog}
        onClose={handleScreeningSkip}
        onSave={handleScreeningSave}
      />
    </div>
  );
};

export default ResumeUpload;
