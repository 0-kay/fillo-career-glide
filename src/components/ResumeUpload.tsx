
import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, FileText, X, Loader2 } from 'lucide-react';

interface ResumeUploadProps {
  onUpload: (file: File, parsedData: any) => void;
}

const ResumeUpload = ({ onUpload }: ResumeUploadProps) => {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Mock parsing function (in real app, this would call backend API)
  const mockParseResume = async (file: File) => {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return {
      personalInfo: {
        name: 'John Doe',
        email: 'john.doe@email.com',
        phone: '+1 (555) 123-4567',
        address: 'San Francisco, CA'
      },
      experience: [
        {
          title: 'Senior Software Engineer',
          company: 'Tech Corp',
          duration: '2022 - Present',
          description: 'Led development of web applications using React and Node.js'
        },
        {
          title: 'Software Engineer',
          company: 'StartupXYZ',
          duration: '2020 - 2022',
          description: 'Developed full-stack applications and improved system performance'
        }
      ],
      education: [
        {
          degree: 'Bachelor of Science in Computer Science',
          school: 'University of California',
          year: '2020'
        }
      ],
      skills: ['JavaScript', 'React', 'Node.js', 'Python', 'SQL', 'AWS'],
      certifications: ['AWS Certified Developer']
    };
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
    const validTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    
    if (!validTypes.includes(file.type)) {
      alert('Please upload a PDF, DOC, or DOCX file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) { // 10MB limit
      alert('File size must be less than 10MB');
      return;
    }

    setSelectedFile(file);
    setUploading(true);

    try {
      const parsedData = await mockParseResume(file);
      onUpload(file, parsedData);
    } catch (error) {
      console.error('Error parsing resume:', error);
      alert('Error parsing resume. Please try again.');
    } finally {
      setUploading(false);
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
          Our AI is extracting your information. This usually takes a few seconds...
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="text-center mb-8">
        <h3 className="text-xl font-semibold text-gray-900 mb-2">Upload Your Resume</h3>
        <p className="text-gray-600">
          Upload your resume and we'll automatically extract your information to create your profile.
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
