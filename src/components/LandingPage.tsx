
import React from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, Upload, RefreshCw, CheckCircle, Users, Clock, Target } from 'lucide-react';
import { Link } from 'react-router-dom';
import Logo from '@/components/Logo';

const LandingPage = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Navigation */}
      <nav className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <Logo className="w-8 h-8" />
              <span className="text-2xl font-bold text-gray-900">Fyllo</span>
            </div>
            <div className="flex items-center space-x-4">
              <Link to="/auth">
                <Button variant="ghost" className="text-gray-600 hover:text-gray-900">
                  Sign In
                </Button>
              </Link>
              <Link to="/auth">
                <Button className="bg-brand hover:bg-brand-dark text-white">
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
          <Badge className="mb-6 bg-brand/10 text-brand-dark border-brand/20">
            🚀 Now supporting Workday, iCIMS, Greenhouse, Lever, Ashby & SmartRecruiters
          </Badge>
          
          <h1 className="text-5xl md:text-6xl font-display text-gray-900 mb-6 leading-tight">
            Fill the gap between
            <span className="bg-gradient-to-r from-brand to-brand-dark bg-clip-text text-transparent"> effort and opportunity</span>
          </h1>
          
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto leading-relaxed">
            Stop wasting hours on repetitive job applications. Fyllo is the smart autofill assistant that makes applying to jobs effortless—starting with the platforms you already use.
          </p>
          
          <div className="flex justify-center mb-12">
            <Link to="/auth">
              <Button size="lg" className="bg-brand hover:bg-brand-dark text-white px-8 py-3">
                Start Applying Smarter
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-display text-gray-900 mb-4">
              How Fyllo Works
            </h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Three simple steps to transform your job application experience
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Card className="p-8 text-center border-0 shadow-lg hover:shadow-xl transition-shadow">
              <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <Upload className="h-8 w-8 text-brand" />
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
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-4xl font-display text-gray-900 mb-6">
            Tired of filling the same forms over and over?
          </h2>
          <p className="text-xl text-gray-600 mb-8">
            Every job seeker knows the pain. Workday, iCIMS, and other enterprise platforms make you re-enter the same information repeatedly. It's frustrating, time-consuming, and outdated.
          </p>

          <div className="space-y-4 inline-block text-left">
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
      </section>

      <section className="py-20 px-4 sm:px-6 lg:px-8 bg-gradient-to-r from-brand to-brand-dark">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl font-display text-white mb-6">
            Ready to apply smarter, not harder?
          </h2>
          <p className="text-xl text-white/90 mb-8">
            Make your application process effortless with Fyllo.
          </p>
          
          <div className="flex justify-center">
            <Link to="/auth">
              <Button size="lg" className="bg-white text-brand hover:bg-gray-100 px-8 py-3">
                Get Started Free
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <Logo className="w-8 h-8" />
              <span className="text-xl font-bold text-gray-900">Fyllo</span>
            </div>
            <p className="text-gray-500">© {new Date().getFullYear()} Fyllo. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
