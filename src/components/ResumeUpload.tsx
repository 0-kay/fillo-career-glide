
import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, FileText, X, Loader2 } from 'lucide-react';
import { useProfiles } from '@/hooks/useProfiles';
import { useToast } from '@/hooks/use-toast';
import { parseResumeFile } from '@/utils/resumeParser';

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
    if (data.personal_details?.full_name?.first) score += 5;
    if (data.personal_details?.email) score += 5;
    if (data.personal_details?.phone) score += 5;
    if (data.personal_details?.address?.city) score += 5;
    
    // Work experience (25 points)
    maxScore += 25;
    if (data.work_experience?.length > 0) score += 25;
    
    // Education (20 points)
    maxScore += 20;
    if (data.education_history?.length > 0) score += 20;
    
    // Skills (15 points)
    maxScore += 15;
    if (data.technical_skills?.length > 0) score += 10;
    if (data.soft_skills?.length > 0) score += 5;
    
    // Projects (10 points)
    maxScore += 10;
    if (data.projects?.length > 0) score += 10;
    
    // Additional sections (10 points)
    maxScore += 10;
    if (data.certifications_licenses?.length > 0) score += 3;
    if (data.languages?.length > 0) score += 3;
    if (data.volunteer_experience?.length > 0) score += 2;
    if (data.awards_honors?.length > 0) score += 2;
    
    return Math.round((score / maxScore) * 100);
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
      console.log('Parsing resume:', file.name);
      const parsedData = await parseResumeFile(file);
      console.log('Parsed comprehensive data:', parsedData);
      
      const completeness = calculateCompleteness(parsedData);
      
      // Save comprehensive data to database
      const { error } = await createProfile({
        name: parsedData.resume_metadata.name,
        personal_info: parsedData.personal_details, // Keep for backward compatibility
        personal_details: parsedData.personal_details,
        education: parsedData.education_history, // Keep for backward compatibility
        education_history: parsedData.education_history,
        experience: parsedData.work_experience, // Keep for backward compatibility
        work_experience: parsedData.work_experience,
        skills: parsedData.technical_skills.map(skill => skill.skill), // Keep for backward compatibility
        technical_skills: parsedData.technical_skills,
        soft_skills: parsedData.soft_skills,
        tools_technologies: parsedData.tools_technologies,
        certifications: parsedData.certifications_licenses.map(cert => cert.name), // Keep for backward compatibility
        certifications_licenses: parsedData.certifications_licenses,
        awards_honors: parsedData.awards_honors,
        projects: parsedData.projects,
        languages: parsedData.languages,
        volunteer_experience: parsedData.volunteer_experience,
        job_preferences: parsedData.job_preferences,
        resume_metadata: parsedData.resume_metadata,
        completeness
      });

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
        description: "Please try again or check if your file format is supported",
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
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Parsing Your Resume</h3>
        <p className="text-gray-600">
          Extracting comprehensive information from your resume and saving it to your profile...
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="text-center mb-8">
        <h3 className="text-xl font-semibold text-gray-900 mb-2">Upload Your Resume</h3>
        <p className="text-gray-600">
          Upload your resume and we'll automatically extract comprehensive information including personal details, 
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
          Your resume data is processed securely and never shared with third parties.
        </p>
      </div>
    </div>
  );
};

export default ResumeUpload;
