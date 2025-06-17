import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, FileText, Settings, Chrome, User, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import Onboarding from '@/components/Onboarding';
import ProfileList from '@/components/ProfileList';

// Mock data for profiles (in real app this would come from backend)
const mockProfiles = [
  {
    id: '1',
    name: 'Software Engineer Profile',
    lastUsed: '2025-01-15',
    completeness: 95
  },
  {
    id: '2', 
    name: 'Product Manager Profile',
    lastUsed: '2025-01-10',
    completeness: 87
  }
];

const Dashboard = () => {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [profiles, setProfiles] = useState(mockProfiles);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);

  useEffect(() => {
    // Check if user has completed onboarding (in real app, check from backend/localStorage)
    const onboardingComplete = localStorage.getItem('fillo_onboarding_complete');
    if (!onboardingComplete && profiles.length === 0) {
      setShowOnboarding(true);
    } else {
      setHasCompletedOnboarding(true);
    }
  }, [profiles.length]);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    setHasCompletedOnboarding(true);
    localStorage.setItem('fillo_onboarding_complete', 'true');
  };

  const handleDeleteProfile = (profileId: string) => {
    setProfiles(prev => prev.filter(profile => profile.id !== profileId));
    console.log('Profile deleted:', profileId);
  };

  if (showOnboarding) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">F</span>
              </div>
              <span className="text-2xl font-bold text-gray-900">Fillo</span>
            </div>
            <div className="flex items-center space-x-4">
              <Link to="/settings">
                <Button variant="ghost" size="sm">
                  <Settings className="h-4 w-4 mr-2" />
                  Settings
                </Button>
              </Link>
              <Button variant="ghost" size="sm">
                <User className="h-4 w-4 mr-2" />
                Profile
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Section */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome back!</h1>
          <p className="text-gray-600">Manage your application profiles and streamline your job search.</p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active Profiles</p>
                <p className="text-2xl font-bold text-gray-900">{profiles.length}</p>
              </div>
              <FileText className="h-8 w-8 text-blue-600" />
            </div>
          </Card>
          
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Applications This Week</p>
                <p className="text-2xl font-bold text-gray-900">12</p>
              </div>
              <Upload className="h-8 w-8 text-green-600" />
            </div>
          </Card>
          
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Extension Status</p>
                <Badge className="mt-1 bg-green-100 text-green-800">Installed</Badge>
              </div>
              <Chrome className="h-8 w-8 text-purple-600" />
            </div>
          </Card>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Profiles Section */}
          <div className="lg:col-span-2">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-900">Your Profiles</h2>
              <Button onClick={() => setShowOnboarding(true)} className="bg-blue-600 hover:bg-blue-700">
                <Plus className="h-4 w-4 mr-2" />
                Create Profile
              </Button>
            </div>
            
            <ProfileList profiles={profiles} onDeleteProfile={handleDeleteProfile} />
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Extension Card */}
            <Card className="p-6">
              <h3 className="font-semibold text-gray-900 mb-3">Browser Extension</h3>
              <p className="text-sm text-gray-600 mb-4">
                Install our Chrome extension to start auto-filling job applications.
              </p>
              <Button variant="outline" className="w-full">
                <Chrome className="h-4 w-4 mr-2" />
                Install Extension
              </Button>
            </Card>

            {/* Tips Card */}
            <Card className="p-6">
              <h3 className="font-semibold text-gray-900 mb-3">Quick Tips</h3>
              <ul className="space-y-2 text-sm text-gray-600">
                <li>• Create different profiles for different job types</li>
                <li>• Keep your profiles updated with latest experience</li>
                <li>• Use the extension on Workday and ICIMS sites</li>
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
