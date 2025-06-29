
import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, FileText, X, Loader2 } from 'lucide-react';
import { useProfiles } from '@/hooks/useProfiles';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import mammoth from 'mammoth';

interface ResumeUploadProps {
  onComplete?: () => void;
}

const ResumeUpload = ({ onComplete }: ResumeUploadProps) => {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const { createProfile } = useProfiles();
  const { toast } = useToast();

  const parseResumeWithAI = async (file: File) => {
    console.log('Starting parsing for:', file.name, file.type);
    
    let requestBody = {};
    
    if (file.type === 'application/pdf') {
      console.log('Processing PDF file');
      // For PDF, we'll send the file info but not the binary data to avoid stack overflow
      requestBody = {
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size
      };
    } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      console.log('Processing DOCX file');
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      requestBody = {
        resumeText: result.value,
        fileName: file.name
      };
    } else {
      console.log('Processing text file');
      const text = await file.text();
      requestBody = {
        resumeText: text,
        fileName: file.name
      };
    }

    console.log('Sending request to edge function');
    const { data, error } = await supabase.functions.invoke('azure-resume-parser', {
      body: requestBody
    });

    if (error) {
      console.error('Edge function error:', error);
      throw new Error(`Failed to parse resume: ${error.message}`);
    }

    return data;
  };

  const calculateCompleteness = (data: any) => {
    let score = 0;
    if (data.personalInfo?.fullName) score += 20;
    if (data.personalInfo?.email) score += 20;
    if (data.experience?.length > 0) score += 30;
    if (data.education?.length > 0) score += 20;
    if (data.skills?.technical?.length > 0) score += 10;
    return Math.min(score, 100);
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

    if (file.size > 10 * 1024 * 1024) {
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
      console.log('Starting resume parsing...');
      const parsedData = await parseResumeWithAI(file);
      console.log('Parsed data received:', parsedData);
      
      const completeness = calculateCompleteness(parsedData);
      
      // Create simplified profile data
      const profileData = {
        name: parsedData.personalInfo?.fullName || `${file.name.split('.')[0]}'s Resume`,
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
        certifications: parsedData.certifications || [],
        completeness
      };
      
      console.log('Creating profile...');
      const { error } = await createProfile(profileData);

      if (error) {
        throw new Error('Failed to save profile');
      }

      toast({
        title: "Profile created successfully",
        description: `Resume parsed with ${completeness}% completeness`,
      });
      
      if (onComplete) {
        onComplete();
      }
    } catch (error) {
      console.error('Error processing resume:', error);
      toast({
        title: "Error processing resume",
        description: error instanceof Error ? error.message : "Please try again",
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
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Processing Your Resume</h3>
        <p className="text-gray-600">
          Analyzing your resume with AI...
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="text-center mb-8">
        <h3 className="text-xl font-semibold text-gray-900 mb-2">Upload Your Resume</h3>
        <p className="text-gray-600">
          Upload your resume and our AI will extract information to create your profile.
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
          Your resume is processed securely and never shared with third parties.
        </p>
      </div>
    </div>
  );
};

export default ResumeUpload;
