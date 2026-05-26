
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, FileText, Settings, Chrome, User, Upload, LogOut } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useProfiles } from '@/hooks/useProfiles';
import Onboarding from '@/components/Onboarding';
import ProfileList from '@/components/ProfileList';

const Dashboard = () => {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const { user, signOut } = useAuth();
  const { profiles, loading } = useProfiles();
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to auth if not logged in  
    if (!user) {
      navigate('/auth');
      return;
    }

    // Show onboarding if no profiles exist
    const onboardingComplete = localStorage.getItem('fillo_onboarding_complete');
    if (!onboardingComplete && profiles.length === 0 && !loading) {
      setShowOnboarding(true);
    }
  }, [user, profiles.length, loading, navigate]);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    localStorage.setItem('fillo_onboarding_complete', 'true');
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  // Get user's first name from email or profile
  const getUserName = () => {
    if (user?.email) {
      const emailName = user.email.split('@')[0];
      return emailName.charAt(0).toUpperCase() + emailName.slice(1);
    }
    return 'User';
  };

  // Calculate stats from profiles
  const getStats = () => {
    const totalProfiles = profiles.length;
    const completeProfiles = profiles.filter(p => p.completeness >= 90).length;
    const averageCompleteness = profiles.length > 0 
      ? Math.round(profiles.reduce((sum, p) => sum + p.completeness, 0) / profiles.length)
      : 0;

    return {
      totalProfiles,
      completeProfiles,
      averageCompleteness
    };
  };

  const stats = getStats();

  if (!user) {
    return null; // Will redirect to auth
  }

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
                {user.email}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleSignOut}>
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome Section */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Welcome back, {getUserName()}!
          </h1>
          <p className="text-gray-600">
            {profiles.length === 0 
              ? "Let's create your first application profile to get started."
              : `You have ${profiles.length} profile${profiles.length === 1 ? '' : 's'} ready for job applications.`
            }
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Active Profiles</p>
                <p className="text-2xl font-bold text-gray-900">{stats.totalProfiles}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {stats.completeProfiles} fully complete
                </p>
              </div>
              <FileText className="h-8 w-8 text-blue-600" />
            </div>
          </Card>
          
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Average Completeness</p>
                <p className="text-2xl font-bold text-gray-900">{stats.averageCompleteness}%</p>
                <p className="text-xs text-gray-500 mt-1">
                  {stats.averageCompleteness >= 90 ? 'Excellent!' : 'Room for improvement'}
                </p>
              </div>
              <Upload className="h-8 w-8 text-green-600" />
            </div>
          </Card>
          
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Extension Status</p>
                <Badge className="mt-1 bg-yellow-100 text-yellow-800">Not Installed</Badge>
                <p className="text-xs text-gray-500 mt-1">Install to auto-fill</p>
              </div>
              <Chrome className="h-8 w-8 text-purple-600" />
            </div>
          </Card>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Profiles Section */}
          <div className="lg:col-span-2">
            <ProfileList />
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Extension Card */}
            <Card className="p-6">
              <h3 className="font-semibold text-gray-900 mb-3">Browser Extension</h3>
              <p className="text-sm text-gray-600 mb-4">
                Install our Chrome extension to start auto-filling job applications using your profiles.
              </p>
              <Button variant="outline" className="w-full">
                <Chrome className="h-4 w-4 mr-2" />
                Install Extension
              </Button>
            </Card>

            {/* Personalized Tips Card */}
            <Card className="p-6">
              <h3 className="font-semibold text-gray-900 mb-3">Tips for {getUserName()}</h3>
              <ul className="space-y-2 text-sm text-gray-600">
                {profiles.length === 0 ? (
                  <>
                    <li>• Upload your resume to create your first profile</li>
                    <li>• Review and edit parsed information for accuracy</li>
                    <li>• Install the browser extension once ready</li>
                  </>
                ) : (
                  <>
                    <li>• Create different profiles for different job types</li>
                    <li>• Keep your profiles updated with latest experience</li>
                    <li>• Use the extension on Workday and ICIMS sites</li>
                    {stats.averageCompleteness < 90 && (
                      <li>• Complete your profiles for better auto-fill accuracy</li>
                    )}
                  </>
                )}
              </ul>
            </Card>

            {/* Recent Activity Card */}
            {profiles.length > 0 && (
              <Card className="p-6">
                <h3 className="font-semibold text-gray-900 mb-3">Recent Activity</h3>
                <div className="space-y-3">
                  {profiles.slice(0, 3).map((profile) => (
                    <div key={profile.id} className="flex items-center space-x-3">
                      <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">{profile.name}</p>
                        <p className="text-xs text-gray-500">
                          Updated {new Date(profile.updated_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
