
import React from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, Upload, RefreshCw, CheckCircle, Chrome, Users, Clock, Target } from 'lucide-react';
import { Link } from 'react-router-dom';

const LandingPage = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Navigation */}
      <nav className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">F</span>
              </div>
              <span className="text-2xl font-bold text-gray-900">Fillo</span>
            </div>
            <div className="flex items-center space-x-4">
              <Link to="/auth">
                <Button variant="ghost" className="text-gray-600 hover:text-gray-900">
                  Sign In
                </Button>
              </Link>
              <Link to="/auth">
                <Button className="bg-blue-600 hover:bg-blue-700 text-white">
                  Get Started
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center">
          <Badge className="mb-6 bg-blue-100 text-blue-800 border-blue-200">
            🚀 Now supporting Workday, iCIMS, Greenhouse, Lever, Ashby & SmartRecruiters
          </Badge>
          
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6 leading-tight">
            Fill the gap between
            <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent"> effort and opportunity</span>
          </h1>
          
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto leading-relaxed">
            Stop wasting hours on repetitive job applications. Fillo is the smart autofill assistant that makes applying to jobs effortless—starting with the platforms you already use.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-12">
            <Link to="/auth">
              <Button size="lg" className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3">
                Start Applying Smarter
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Button size="lg" variant="outline" className="px-8 py-3">
              <Chrome className="mr-2 h-5 w-5" />
              Install Extension
            </Button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-3xl mx-auto">
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-600 mb-2">95%</div>
              <div className="text-gray-600">Time Saved</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-600 mb-2">50+</div>
              <div className="text-gray-600">Supported Platforms</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-600 mb-2">10k+</div>
              <div className="text-gray-600">Applications Filled</div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">
              How Fillo Works
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Three simple steps to transform your job application experience
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card className="p-8 text-center border-0 shadow-lg hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <Upload className="h-8 w-8 text-blue-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-4">1. Upload Your Resume</h3>
              <p className="text-gray-600">
                Upload your resume once and let our AI parse all your information automatically.
              </p>
            </Card>

            <Card className="p-8 text-center border-0 shadow-lg hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <RefreshCw className="h-8 w-8 text-green-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-4">2. Install Extension</h3>
              <p className="text-gray-600">
                Add our Chrome extension and create reusable profiles for different job types.
              </p>
            </Card>

            <Card className="p-8 text-center border-0 shadow-lg hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle className="h-8 w-8 text-purple-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-4">3. Auto-Fill Applications</h3>
              <p className="text-gray-600">
                Click once to fill any job application form on Workday, iCIMS, Greenhouse, Lever, Ashby, SmartRecruiters, and more.
              </p>
            </Card>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gray-50">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-4xl font-bold text-gray-900 mb-6">
                Tired of filling the same forms over and over?
              </h2>
              <p className="text-xl text-gray-600 mb-8">
                Every job seeker knows the pain. Workday, ICIMS, and other enterprise platforms make you re-enter the same information repeatedly. It's frustrating, time-consuming, and outdated.
              </p>
              
              <div className="space-y-4">
                <div className="flex items-center space-x-3">
                  <Clock className="h-5 w-5 text-red-500" />
                  <span className="text-gray-700">Hours wasted on repetitive form filling</span>
                </div>
                <div className="flex items-center space-x-3">
                  <Users className="h-5 w-5 text-red-500" />
                  <span className="text-gray-700">Different login for every application</span>
                </div>
                <div className="flex items-center space-x-3">
                  <Target className="h-5 w-5 text-red-500" />
                  <span className="text-gray-700">Outdated UX that discourages applications</span>
                </div>
              </div>
            </div>
            
            <div className="bg-white p-8 rounded-xl shadow-lg">
              <div className="space-y-4">
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm text-red-800 italic">
                    "If I see a job application served by Workday I immediately skip it."
                  </p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm text-red-800 italic">
                    "You need a different login for every iCIMS application. My password manager is crying."
                  </p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm text-red-800 italic">
                    "It's 2025. Why is autofill still not a thing?"
                  </p>
                </div>
              </div>
              <p className="text-sm text-gray-500 mt-4 text-center">
                — Actual tweets from job seekers, 2025
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-r from-blue-600 to-indigo-600">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl font-bold text-white mb-6">
            Ready to apply smarter, not harder?
          </h2>
          <p className="text-xl text-blue-100 mb-8">
            Join thousands of job seekers who've already made their application process effortless with Fillo.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/auth">
              <Button size="lg" className="bg-white text-blue-600 hover:bg-gray-100 px-8 py-3">
                Get Started Free
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Button size="lg" variant="outline" className="border-white text-white hover:bg-white hover:text-blue-600 px-8 py-3">
              <Chrome className="mr-2 h-5 w-5" />
              Install Extension
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">F</span>
              </div>
              <span className="text-xl font-bold text-gray-900">Fillo</span>
            </div>
            <p className="text-gray-500">© {new Date().getFullYear()} Fillo. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
