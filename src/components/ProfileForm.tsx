
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Plus, X } from 'lucide-react';

interface ProfileFormProps {
  initialData: any;
  onSave: () => void;
  onBack: () => void;
}

const ProfileForm = ({ initialData, onSave, onBack }: ProfileFormProps) => {
  const [formData, setFormData] = useState({
    profileName: 'My Profile',
    personalInfo: initialData.personalInfo || {},
    experience: initialData.experience || [],
    education: initialData.education || [],
    skills: initialData.skills || [],
    certifications: initialData.certifications || []
  });

  const [newSkill, setNewSkill] = useState('');

  const handlePersonalInfoChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      personalInfo: {
        ...prev.personalInfo,
        [field]: value
      }
    }));
  };

  const addSkill = () => {
    if (newSkill.trim() && !formData.skills.includes(newSkill.trim())) {
      setFormData(prev => ({
        ...prev,
        skills: [...prev.skills, newSkill.trim()]
      }));
      setNewSkill('');
    }
  };

  const removeSkill = (skillToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      skills: prev.skills.filter(skill => skill !== skillToRemove)
    }));
  };

  const handleSave = () => {
    // In real app, this would save to backend
    console.log('Saving profile:', formData);
    onSave();
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h3 className="text-xl font-semibold text-gray-900 mb-2">Review & Edit Your Profile</h3>
        <p className="text-gray-600">
          We've automatically filled in your information. Please review and make any necessary changes.
        </p>
      </div>

      <div className="space-y-8">
        {/* Profile Name */}
        <Card className="p-6">
          <h4 className="font-semibold text-gray-900 mb-4">Profile Name</h4>
          <Input
            value={formData.profileName}
            onChange={(e) => setFormData(prev => ({ ...prev, profileName: e.target.value }))}
            placeholder="e.g., Software Engineer Profile"
            className="max-w-md"
          />
          <p className="text-sm text-gray-500 mt-2">
            Give this profile a descriptive name to easily identify it later.
          </p>
        </Card>

        {/* Personal Information */}
        <Card className="p-6">
          <h4 className="font-semibold text-gray-900 mb-4">Personal Information</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                value={formData.personalInfo.name || ''}
                onChange={(e) => handlePersonalInfoChange('name', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.personalInfo.email || ''}
                onChange={(e) => handlePersonalInfoChange('email', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formData.personalInfo.phone || ''}
                onChange={(e) => handlePersonalInfoChange('phone', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                value={formData.personalInfo.address || ''}
                onChange={(e) => handlePersonalInfoChange('address', e.target.value)}
              />
            </div>
          </div>
        </Card>

        {/* Skills */}
        <Card className="p-6">
          <h4 className="font-semibold text-gray-900 mb-4">Skills</h4>
          <div className="flex flex-wrap gap-2 mb-4">
            {formData.skills.map((skill, index) => (
              <Badge key={index} variant="secondary" className="flex items-center gap-1">
                {skill}
                <button
                  onClick={() => removeSkill(skill)}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newSkill}
              onChange={(e) => setNewSkill(e.target.value)}
              placeholder="Add a skill"
              onKeyPress={(e) => e.key === 'Enter' && addSkill()}
              className="max-w-xs"
            />
            <Button onClick={addSkill} variant="outline" size="sm">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </Card>

        {/* Experience */}
        <Card className="p-6">
          <h4 className="font-semibold text-gray-900 mb-4">Work Experience</h4>
          <div className="space-y-4">
            {formData.experience.map((exp, index) => (
              <div key={index} className="border rounded-lg p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Job Title</Label>
                    <Input value={exp.title} readOnly />
                  </div>
                  <div>
                    <Label>Company</Label>
                    <Input value={exp.company} readOnly />
                  </div>
                  <div>
                    <Label>Duration</Label>
                    <Input value={exp.duration} readOnly />
                  </div>
                </div>
                <div className="mt-4">
                  <Label>Description</Label>
                  <Input value={exp.description} readOnly />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Education */}
        <Card className="p-6">
          <h4 className="font-semibold text-gray-900 mb-4">Education</h4>
          <div className="space-y-4">
            {formData.education.map((edu, index) => (
              <div key={index} className="border rounded-lg p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label>Degree</Label>
                    <Input value={edu.degree} readOnly />
                  </div>
                  <div>
                    <Label>School</Label>
                    <Input value={edu.school} readOnly />
                  </div>
                  <div>
                    <Label>Year</Label>
                    <Input value={edu.year} readOnly />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex justify-between mt-8">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Upload
        </Button>
        <Button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700">
          Save Profile
        </Button>
      </div>
    </div>
  );
};

export default ProfileForm;
