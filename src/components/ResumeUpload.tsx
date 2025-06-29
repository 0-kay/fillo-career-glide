import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, FileText, X, Loader2 } from 'lucide-react';
import { useProfiles } from '@/hooks/useProfiles';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

interface ResumeUploadProps {
  onComplete?: () => void;
}

const ResumeUpload = ({ onComplete }: ResumeUploadProps) => {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const { createProfile } = useProfiles();
  const { toast } = useToast();

  const extractTextFromPDF = async (file: File): Promise<string> => {
    console.log('=== PDF EXTRACTION START ===');
    console.log('PDF.js version:', pdfjsLib.version);
    console.log('Worker source:', pdfjsLib.GlobalWorkerOptions.workerSrc);
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
      
      // Try to create a Uint8Array to ensure data is readable
      const uint8Array = new Uint8Array(arrayBuffer);
      console.log('Uint8Array created, first few bytes:', Array.from(uint8Array.slice(0, 10)));
      
      // Check for PDF signature
      const pdfSignature = uint8Array.slice(0, 4);
      const isPDF = String.fromCharCode(...pdfSignature) === '%PDF';
      console.log('PDF signature check:', isPDF, 'First 10 bytes as string:', String.fromCharCode(...uint8Array.slice(0, 10)));
      
      if (!isPDF) {
        throw new Error('File does not appear to be a valid PDF (missing PDF signature)');
      }
      
      console.log('Creating PDF loading task...');
      const loadingTask = pdfjsLib.getDocument({
        data: arrayBuffer,
        cMapUrl: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/cmaps/`,
        cMapPacked: true,
        verbosity: 1, // Enable some logging
      });
      
      console.log('Waiting for PDF to load...');
      const pdf = await loadingTask.promise;
      console.log('PDF loaded successfully! Number of pages:', pdf.numPages);

      let fullText = '';
      
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        try {
          console.log(`--- Processing page ${pageNum}/${pdf.numPages} ---`);
          const page = await pdf.getPage(pageNum);
          console.log(`Page ${pageNum} loaded successfully`);
          
          const textContent = await page.getTextContent();
          console.log(`Page ${pageNum} text content retrieved, items:`, textContent.items.length);
          
          const pageText = textContent.items
            .map((item: any) => {
              // More robust text extraction
              if (item && typeof item === 'object') {
                return item.str || item.text || '';
              }
              return String(item || '');
            })
            .filter(text => text.trim().length > 0)
            .join(' ');
          
          console.log(`Page ${pageNum} extracted text length:`, pageText.length);
          if (pageText.length > 0) {
            console.log(`Page ${pageNum} first 100 chars:`, pageText.substring(0, 100));
            fullText += pageText + '\n\n';
          } else {
            console.warn(`Page ${pageNum} produced no text`);
          }
          
        } catch (pageError) {
          console.error(`Error processing page ${pageNum}:`, {
            error: pageError,
            message: pageError instanceof Error ? pageError.message : String(pageError),
            stack: pageError instanceof Error ? pageError.stack : undefined
          });
          // Continue with other pages instead of failing completely
        }
      }

      console.log('=== PDF EXTRACTION COMPLETE ===');
      console.log('Total extracted text length:', fullText.length);
      
      if (fullText.length === 0) {
        throw new Error('No text could be extracted from any pages');
      }
      
      console.log('Sample extracted text (first 500 chars):');
      console.log(fullText.substring(0, 500));
      console.log('Sample extracted text (last 500 chars):');
      console.log(fullText.substring(Math.max(0, fullText.length - 500)));
      
      return fullText.trim();
      
    } catch (error) {
      console.error('=== PDF EXTRACTION ERROR ===');
      console.error('Error type:', typeof error);
      console.error('Error details:', {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'Unknown',
        stack: error instanceof Error ? error.stack : undefined,
        cause: error instanceof Error ? error.cause : undefined
      });
      
      // Log additional PDF.js specific error details
      if (error && typeof error === 'object' && 'name' in error) {
        console.error('PDF.js error name:', error.name);
      }
      
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
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files?.[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files?.[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = async (file: File) => {
    const validTypes = [
      'application/pdf', 
      'application/msword', 
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ];
    
    if (!validTypes.includes(file.type)) {
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

    try {
      console.log('=== FILE PROCESSING START ===');
      console.log('Processing file...');
      const parsedData = await parseResumeWithAI(file);
      
      console.log('=== PROFILE CREATION ===');
      const profileData = {
        name: parsedData.personalInfo?.fullName || file.name.replace(/\.[^/.]+$/, ''),
        personal_info: parsedData.personalInfo || {},
        education: parsedData.education || [],
        experience: parsedData.experience || [],
        skills: parsedData.skills?.technical || [],
        certifications: [],
        completeness: 50
      };
      
      console.log('Profile data to be created:', profileData);
      
      const result = await createProfile(profileData);
      
      if (result.error) {
        console.error('Profile creation error:', result.error);
        throw new Error('Failed to save profile');
      }

      console.log('Profile created successfully:', result);

      toast({
        title: "Success!",
        description: "Resume processed and profile created",
      });
      
      onComplete?.();
      
    } catch (error) {
      console.error('=== PROCESSING ERROR ===');
      console.error('Error:', error);
      toast({
        title: "Processing failed",
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
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Processing Resume</h3>
        <p className="text-gray-600">Please wait...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="text-center mb-8">
        <h3 className="text-xl font-semibold text-gray-900 mb-2">Upload Your Resume</h3>
        <p className="text-gray-600">
          Upload your resume and AI will extract the information.
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
            Supports PDF, DOC, DOCX, and TXT files up to 10MB
          </p>
          
          <input
            type="file"
            accept=".pdf,.doc,.docx,.txt"
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
          Your resume is processed securely and never shared.
        </p>
      </div>
    </div>
  );
};

export default ResumeUpload;
