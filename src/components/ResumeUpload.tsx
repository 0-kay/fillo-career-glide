import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, FileText, X, Loader2 } from 'lucide-react';
import { useProfiles } from '@/hooks/useProfiles';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import mammoth from 'mammoth';
import * as pdfParse from 'pdf-parse';

interface ResumeUploadProps {
  onComplete?: () => void;
}

const ResumeUpload = ({ onComplete }: ResumeUploadProps) => {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const { createProfile } = useProfiles();
  const { toast } = useToast();

  const calculateCompleteness = (data: any) => {
    let score = 0;
    let maxScore = 0;
    
    // Personal details (20 points)
    maxScore += 20;
    if (data.personalInfo?.fullName) score += 5;
    if (data.personalInfo?.email) score += 5;
    if (data.personalInfo?.phone) score += 5;
    if (data.personalInfo?.address) score += 5;
    
    // Work experience (25 points)
    maxScore += 25;
    if (data.experience?.length > 0) score += 25;
    
    // Education (20 points)
    maxScore += 20;
    if (data.education?.length > 0) score += 20;
    
    // Skills (15 points)
    maxScore += 15;
    if (data.skills?.technical?.length > 0) score += 10;
    if (data.skills?.soft?.length > 0) score += 5;
    
    // Projects (10 points)
    maxScore += 10;
    if (data.projects?.length > 0) score += 10;
    
    // Additional sections (10 points)
    maxScore += 10;
    if (data.certifications?.length > 0) score += 3;
    if (data.languages?.length > 0) score += 3;
    if (data.volunteer?.length > 0) score += 2;
    if (data.preferences) score += 2;
    
    return Math.round((score / maxScore) * 100);
  };

  const extractTextFromPDF = async (file: File): Promise<string> => {
    try {
      console.log('Starting PDF text extraction for:', file.name);
      const arrayBuffer = await file.arrayBuffer();
      const pdfData = await pdfParse(arrayBuffer);
      console.log('PDF text extracted, length:', pdfData.text.length);
      console.log('PDF text preview:', pdfData.text.substring(0, 500) + '...');
      return pdfData.text;
    } catch (error) {
      console.error('Error extracting PDF text:', error);
      throw new Error('Failed to extract text from PDF file');
    }
  };

  const extractTextFromDOCX = async (file: File): Promise<string> => {
    try {
      console.log('Starting DOCX text extraction for:', file.name);
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      console.log('DOCX text extracted, length:', result.value.length);
      console.log('DOCX text preview:', result.value.substring(0, 500) + '...');
      return result.value;
    } catch (error) {
      console.error('Error extracting DOCX:', error);
      throw new Error('Failed to extract text from DOCX file');
    }
  };

  const parseResumeWithOpenAI = async (file: File): Promise<any> => {
    let text = '';
    
    console.log('Processing file:', file.name, 'Type:', file.type);
    
    if (file.type === 'application/pdf') {
      text = await extractTextFromPDF(file);
    } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      text = await extractTextFromDOCX(file);
    } else if (file.type === 'application/msword') {
      text = await file.text();
    } else {
      throw new Error('Unsupported file format');
    }

    if (!text || text.trim().length === 0) {
      throw new Error('No text could be extracted from the file');
    }

    console.log('Final extracted text length:', text.length);
    console.log('Sending text to OpenAI via edge function...');

    const { data, error } = await supabase.functions.invoke('azure-resume-parser', {
      body: {
        resumeText: text,
        fileName: file.name
      }
    });

    if (error) {
      console.error('OpenAI parsing error:', error);
      throw new Error('Failed to parse resume with OpenAI');
    }

    console.log('OpenAI response data:', data);
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
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = async (file: File) => {
    const validTypes = [
      'application/pdf', 
      'application/msword', 
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    if (!validTypes.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Please upload a PDF, DOC, or DOCX file",
        variant: "destructive"
      });
      return;
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      toast({
        title: "File too large",
        description: "File size must be less than 10MB",
        variant: "destructive"
      });
      return;
    }

    setSelectedFile(file);
    setUploading(true);

    try {
      console.log('Starting resume parsing with OpenAI:', file.name);
      const parsedData = await parseResumeWithOpenAI(file);
      console.log('Parsed data from OpenAI:', parsedData);
      
      const completeness = calculateCompleteness(parsedData);
      
      // Create comprehensive profile data structure
      const profileData = {
        name: parsedData.personalInfo?.fullName || `${file.name.split('.')[0]}'s Resume`,
        
        // Legacy fields for backward compatibility
        personal_info: {
          name: parsedData.personalInfo?.fullName || '',
          email: parsedData.personalInfo?.email || '',
          phone: parsedData.personalInfo?.phone || '',
          address: parsedData.personalInfo?.address || ''
        },
        education: parsedData.education || [],
        experience: parsedData.experience || [],
        skills: [
          ...(parsedData.skills?.technical || []),
          ...(parsedData.skills?.soft || []),
          ...(parsedData.skills?.tools || [])
        ],
        certifications: parsedData.certifications?.map((cert: any) => 
          typeof cert === 'string' ? cert : cert.name || ''
        ) || [],
        
        // New structured fields
        personal_details: {
          full_name: {
            first: parsedData.personalInfo?.fullName?.split(' ')[0] || '',
            middle: parsedData.personalInfo?.fullName?.split(' ').length > 2 ? 
              parsedData.personalInfo.fullName.split(' ').slice(1, -1).join(' ') : '',
            last: parsedData.personalInfo?.fullName?.split(' ').slice(-1)[0] || ''
          },
          email: parsedData.personalInfo?.email || '',
          phone: parsedData.personalInfo?.phone || '',
          linkedin_url: parsedData.personalInfo?.linkedin || '',
          github_url: parsedData.personalInfo?.portfolio || '',
          address: {
            street: '',
            city: '',
            state: '',
            zip: '',
            country: parsedData.personalInfo?.address || ''
          },
          work_authorization: parsedData.personalInfo?.workAuthorization || '',
          preferred_name: parsedData.personalInfo?.preferredName || ''
        },
        
        education_history: parsedData.education?.map((edu: any) => ({
          institution: edu.institution || '',
          degree: edu.degree || '',
          field_of_study: edu.fieldOfStudy || '',
          start_date: edu.startDate || '',
          end_date: edu.endDate || '',
          gpa: edu.gpa || '',
          honors: edu.honors || ''
        })) || [],
        
        work_experience: parsedData.experience?.map((exp: any) => ({
          title: exp.jobTitle || '',
          company: exp.company || '',
          location: exp.location || '',
          start_date: exp.startDate || '',
          end_date: exp.endDate || '',
          description: exp.description || '',
          achievements: Array.isArray(exp.achievements) ? exp.achievements : []
        })) || [],
        
        technical_skills: parsedData.skills?.technical?.map((skill: string) => ({
          skill: skill,
          category: 'Technical',
          proficiency: 'Intermediate'
        })) || [],
        
        soft_skills: parsedData.skills?.soft?.map((skill: string) => ({
          skill: skill,
          category: 'Soft',
          proficiency: 'Intermediate'
        })) || [],
        
        tools_technologies: parsedData.skills?.tools?.map((tool: string) => ({
          name: tool,
          category: 'Tool',
          proficiency: 'Intermediate'
        })) || [],
        
        certifications_licenses: parsedData.certifications?.map((cert: any) => ({
          name: typeof cert === 'string' ? cert : cert.name || '',
          issuer: typeof cert === 'object' ? cert.issuer || '' : '',
          issue_date: typeof cert === 'object' ? cert.issueDate || '' : '',
          expiration_date: typeof cert === 'object' ? cert.expirationDate || '' : '',
          credential_id: typeof cert === 'object' ? cert.credentialId || '' : '',
          credential_url: typeof cert === 'object' ? cert.credentialUrl || '' : ''
        })) || [],
        
        awards_honors: [],
        
        projects: parsedData.projects?.map((project: any) => ({
          title: project.title || '',
          description: project.description || '',
          technologies: Array.isArray(project.tools) ? project.tools : [],
          link: project.link || '',
          start_date: project.startDate || '',
          end_date: project.endDate || ''
        })) || [],
        
        languages: parsedData.languages?.map((lang: any) => ({
          language: typeof lang === 'string' ? lang : lang.language || '',
          proficiency: typeof lang === 'object' ? lang.proficiency || '' : 'Conversational'
        })) || [],
        
        volunteer_experience: parsedData.volunteer?.map((vol: any) => ({
          organization: vol.organization || '',
          role: vol.role || '',
          description: vol.description || '',
          start_date: vol.startDate || '',
          end_date: vol.endDate || ''
        })) || [],
        
        job_preferences: {
          desired_titles: Array.isArray(parsedData.preferences?.desiredTitles) ? 
            parsedData.preferences.desiredTitles : [],
          industries: Array.isArray(parsedData.preferences?.industries) ? 
            parsedData.preferences.industries : [],
          location_preferences: Array.isArray(parsedData.preferences?.locationPreferences) ? 
            parsedData.preferences.locationPreferences : [],
          employment_type: parsedData.preferences?.employmentType || '',
          relocation_willingness: parsedData.preferences?.relocationWillingness || '',
          availability: parsedData.preferences?.availability || '',
          salary_expectation: parsedData.preferences?.salaryExpectation || ''
        },
        
        resume_metadata: {
          name: parsedData.personalInfo?.fullName ? 
            `${parsedData.personalInfo.fullName}'s Resume` : 
            `${file.name.split('.')[0]}'s Resume`,
          file_name: file.name,
          parsing_status: 'Complete',
          version: '1.0',
          upload_date: new Date().toISOString()
        },
        
        completeness
      };
      
      console.log('Final profile data to save:', profileData);
      
      // Save to database
      const { error } = await createProfile(profileData);

      if (error) {
        console.error('Error saving profile:', error);
        toast({
          title: "Error saving profile",
          description: "Please try again later",
          variant: "destructive"
        });
      } else {
        toast({
          title: "Profile created successfully",
          description: `Your resume has been parsed and saved with ${completeness}% completeness`,
        });
        
        if (onComplete) {
          onComplete();
        }
      }
    } catch (error) {
      console.error('Error parsing resume:', error);
      toast({
        title: "Error parsing resume",
        description: error instanceof Error ? error.message : "Please try again or check if your file format is supported",
        variant: "destructive"
      });
    } finally {
      setUploading(false);
      setSelectedFile(null);
    }
  };

  const removeFile = () => {
    setSelectedFile(null);
  };

  if (uploading) {
    return (
      <div className="text-center py-12">
        <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Analyzing Your Resume with OpenAI</h3>
        <p className="text-gray-600">
          Using advanced AI to extract comprehensive information from your resume...
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="text-center mb-8">
        <h3 className="text-xl font-semibold text-gray-900 mb-2">Upload Your Resume</h3>
        <p className="text-gray-600">
          Upload your resume and our AI will intelligently extract comprehensive information including personal details, 
          work experience, education, skills, projects, and more to create a complete profile.
        </p>
      </div>

      {!selectedFile ? (
        <div
          className={`relative border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
            dragActive 
              ? 'border-blue-400 bg-blue-50' 
              : 'border-gray-300 hover:border-gray-400'
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h4 className="text-lg font-medium text-gray-900 mb-2">
            Drop your resume here, or click to browse
          </h4>
          <p className="text-gray-600 mb-6">
            Supports PDF, DOC, and DOCX files up to 10MB
          </p>
          
          <input
            type="file"
            accept=".pdf,.doc,.docx"
            onChange={handleChange}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          
          <Button className="bg-blue-600 hover:bg-blue-700">
            Browse Files
          </Button>
        </div>
      ) : (
        <div className="border rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <FileText className="h-8 w-8 text-blue-600" />
              <div>
                <p className="font-medium text-gray-900">{selectedFile.name}</p>
                <p className="text-sm text-gray-600">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={removeFile}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <div className="mt-6 text-center">
        <p className="text-sm text-gray-500">
          Your resume data is processed securely with OpenAI and never shared with third parties.
        </p>
      </div>
    </div>
  );
};

export default ResumeUpload;
