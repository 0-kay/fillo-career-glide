
import React from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ArrowLeft, User, Bell, Shield, Chrome } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

const Settings = () => {

  // const handleUpdateAccount = async() => {
  //   supabase.
  // }
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <Link to="/dashboard">
                <Button variant="ghost" size="sm">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Dashboard
                </Button>
              </Link>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">F</span>
              </div>
              <span className="text-2xl font-bold text-gray-900">Fillo</span>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Settings</h1>
          <p className="text-gray-600">Manage your account preferences and extension settings.</p>
        </div>

        <div className="space-y-6">
          {/* Account Settings */}
          <Card className="p-6">
            <div className="flex items-center space-x-3 mb-6">
              <User className="h-5 w-5 text-blue-600" />
              <h3 className="text-lg font-semibold text-gray-900">Account Settings</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label htmlFor="name">Full Name</Label>
                <Input id="name" placeholder="John Doe" />
              </div>
              <div>
                <Label htmlFor="email">Email Address</Label>
                <Input id="email" type="email" placeholder="john@example.com" />
              </div>
            </div>
            
            <div className="mt-6">
              <Button className="bg-blue-600 hover:bg-blue-700">Save Changes</Button>
            </div>
          </Card>

          {/* Notification Settings */}
          <Card className="p-6">
            <div className="flex items-center space-x-3 mb-6">
              <Bell className="h-5 w-5 text-blue-600" />
              <h3 className="text-lg font-semibold text-gray-900">Notifications</h3>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Extension Updates</p>
                  <p className="text-sm text-gray-600">Get notified when new features are available</p>
                </div>
                <Switch />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Application Tips</p>
                  <p className="text-sm text-gray-600">Receive helpful tips for job applications</p>
                </div>
                <Switch />
              </div>
            </div>
          </Card>

          {/* Extension Settings */}
          <Card className="p-6">
            <div className="flex items-center space-x-3 mb-6">
              <Chrome className="h-5 w-5 text-blue-600" />
              <h3 className="text-lg font-semibold text-gray-900">Extension Settings</h3>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Auto-fill on page load</p>
                  <p className="text-sm text-gray-600">Automatically suggest profile when forms are detected</p>
                </div>
                <Switch />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">Show success notifications</p>
                  <p className="text-sm text-gray-600">Display notifications when forms are filled successfully</p>
                </div>
                <Switch />
              </div>
            </div>
          </Card>



          {/* Privacy & Security */}
          <Card className="p-6">
            <div className="flex items-center space-x-3 mb-6">
              <Shield className="h-5 w-5 text-blue-600" />
              <h3 className="text-lg font-semibold text-gray-900">Privacy & Security</h3>
            </div>
            
            <div className="space-y-4">
              <Button variant="outline">Change Password</Button>
              <Button variant="outline">Download My Data</Button>
              <Button variant="destructive">Delete Account</Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Settings;
