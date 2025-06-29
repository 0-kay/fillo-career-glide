
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowRight, Check, Upload } from 'lucide-react';
import ResumeUpload from '@/components/ResumeUpload';

interface OnboardingProps {
  onComplete: () => void;
}

const Onboarding = ({ onComplete }: OnboardingProps) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [profileCreated, setProfileCreated] = useState(false);

  const steps = [
    { id: 1, title: 'Welcome', description: 'Get started with Fillo' },
    { id: 2, title: 'Upload Resume', description: 'Let us parse your information' },
    { id: 3, title: 'Complete', description: 'Your profile is ready!' }
  ];

  const handleResumeComplete = () => {
    setProfileCreated(true);
    setCurrentStep(3);
  };

  const handleComplete = () => {
    onComplete();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => (
              <div key={step.id} className="flex items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${
                  currentStep >= step.id 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-gray-200 text-gray-600'
                }`}>
                  {currentStep > step.id ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    step.id
                  )}
                </div>
                {index < steps.length - 1 && (
                  <div className={`h-1 w-20 ml-4 ${
                    currentStep > step.id ? 'bg-blue-600' : 'bg-gray-200'
                  }`} />
                )}
              </div>
            ))}
          </div>
          <div className="mt-4">
            <h2 className="text-xl font-semibold text-gray-900">{steps[currentStep - 1].title}</h2>
            <p className="text-gray-600">{steps[currentStep - 1].description}</p>
          </div>
        </div>

        {/* Step Content */}
        <Card className="p-8">
          {currentStep === 1 && (
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <Upload className="h-8 w-8 text-blue-600" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4">Welcome to Fillo!</h3>
              <p className="text-gray-600 mb-8 max-w-2xl mx-auto">
                Let's get you set up with your first application profile. We'll start by uploading your resume 
                and parsing your information automatically.
              </p>
              <Button onClick={() => setCurrentStep(2)} className="bg-blue-600 hover:bg-blue-700">
                Get Started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}

          {currentStep === 2 && (
            <ResumeUpload onComplete={handleResumeComplete} />
          )}

          {currentStep === 3 && (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <Check className="h-8 w-8 text-green-600" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-4">Profile Created Successfully!</h3>
              <p className="text-gray-600 mb-8 max-w-2xl mx-auto">
                Your resume has been parsed and your application profile is ready to use. You can now start 
                auto-filling job applications or create additional profiles for different roles.
              </p>
              <Button onClick={handleComplete} className="bg-blue-600 hover:bg-blue-700">
                Go to Dashboard
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default Onboarding;
