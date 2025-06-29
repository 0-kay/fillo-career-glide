
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Plus, X, Save, Loader2 } from 'lucide-react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useProfiles } from '@/hooks/useProfiles';
import { useToast } from '@/hooks/use-toast';

const ProfileEdit = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getProfile, updateProfile } = useProfiles();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<any>(null);
  const [newSkill, setNewSkill] = useState('');

  useEffect(() => {
    const fetchProfile = async () => {
      if (!id) return;
      
      setLoading(true);
      try {
        const { data, error } = await getProfile(id);
        if (error) {
          console.error('Error fetching profile:', error);
          toast({
            title: "Error",
            description: "Failed to load profile data",
            variant: "destructive"
          });
          navigate('/dashboard');
        } else if (data) {
          setFormData({
            profileName: data.name,
            personalDetails: data.personal_details || {},
            workExperience: data.work_experience || [],
            educationHistory: data.education_history || [],
            technicalSkills: data.technical_skills || [],
            softSkills: data.soft_skills || [],
            toolsTechnologies: data.tools_technologies || [],
            projects: data.projects || [],
            certifications: data.certifications_licenses || [],
            languages: data.languages || [],
            volunteerExperience: data.volunteer_experience || [],
            jobPreferences: data.job_preferences || {}
          });
        }
      } catch (error) {
        console.error('Error:', error);
        toast({
          title: "Error",
          description: "Failed to load profile data",
          variant: "destructive"
        });
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [id, getProfile, navigate, toast]);

  const handlePersonalDetailsChange = (field: string, value: string) => {
    setFormData((prev: any) => ({
      ...prev,
      personalDetails: {
        ...prev.personalDetails,
        [field]: value
      }
    }));
  };

  const handleNestedPersonalDetailsChange = (section: string, field: string, value: string) => {
    setFormData((prev: any) => ({
      ...prev,
      personalDetails: {
        ...prev.personalDetails,
        [section]: {
          ...prev.personalDetails[section],
          [field]: value
        }
      }
    }));
  };

  const addTechnicalSkill = () => {
    if (newSkill.trim()) {
      const newSkillObj = {
        skill: newSkill.trim(),
        category: 'Technical',
        proficiency: 'Intermediate'
      };
      setFormData((prev: any) => ({
        ...prev,
        technicalSkills: [...prev.technicalSkills, newSkillObj]
      }));
      setNewSkill('');
    }
  };

  const removeTechnicalSkill = (index: number) => {
    setFormData((prev: any) => ({
      ...prev,
      technicalSkills: prev.technicalSkills.filter((_: any, i: number) => i !== index)
    }));
  };

  const handleSave = async () => {
    if (!id || !formData) return;
    
    setSaving(true);
    try {
      const { error } = await updateProfile(id, {
        name: formData.profileName,
        personal_details: formData.personalDetails,
        work_experience: formData.workExperience,
        education_history: formData.educationHistory,
        technical_skills: formData.technicalSkills,
        soft_skills: formData.softSkills,
        tools_technologies: formData.toolsTechnologies,
        projects: formData.projects,
        certifications_licenses: formData.certifications,
        languages: formData.languages,
        volunteer_experience: formData.volunteerExperience,
        job_preferences: formData.jobPreferences
      });

      if (error) {
        toast({
          title: "Error",
          description: "Failed to save profile changes",
          variant: "destructive"
        });
      } else {
        toast({
          title: "Success",
          description: "Profile updated successfully",
        });
        navigate('/dashboard');
      }
    } catch (error) {
      console.error('Error saving profile:', error);
      toast({
        title: "Error",
        description: "Failed to save profile changes",
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading profile data...</p>
        </div>
      </div>
    );
  }

  if (!formData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600">Profile not found</p>
          <Link to="/dashboard">
            <Button className="mt-4">Back to Dashboard</Button>
          </Link>
        </div>
      </div>
    );
  }

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
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Edit Profile</h1>
          <p className="text-gray-600">Update your profile information and preferences.</p>
        </div>

        <div className="space-y-8">
          {/* Profile Name */}
          <Card className="p-6">
            <h4 className="font-semibold text-gray-900 mb-4">Profile Name</h4>
            <Input
              value={formData.profileName || ''}
              onChange={(e) => setFormData((prev: any) => ({ ...prev, profileName: e.target.value }))}
              placeholder="e.g., Software Engineer Profile"
              className="max-w-md"
            />
          </Card>

          {/* Personal Information */}
          <Card className="p-6">
            <h4 className="font-semibold text-gray-900 mb-4">Personal Information</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={formData.personalDetails?.full_name?.first || ''}
                  onChange={(e) => handleNestedPersonalDetailsChange('full_name', 'first', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={formData.personalDetails?.full_name?.last || ''}
                  onChange={(e) => handleNestedPersonalDetailsChange('full_name', 'last', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.personalDetails?.email || ''}
                  onChange={(e) => handlePersonalDetailsChange('email', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={formData.personalDetails?.phone || ''}
                  onChange={(e) => handlePersonalDetailsChange('phone', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="linkedin">LinkedIn URL</Label>
                <Input
                  id="linkedin"
                  value={formData.personalDetails?.linkedin_url || ''}
                  onChange={(e) => handlePersonalDetailsChange('linkedin_url', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="github">GitHub URL</Label>
                <Input
                  id="github"
                  value={formData.personalDetails?.github_url || ''}
                  onChange={(e) => handlePersonalDetailsChange('github_url', e.target.value)}
                />
              </div>
            </div>
          </Card>

          {/* Technical Skills */}
          <Card className="p-6">
            <h4 className="font-semibold text-gray-900 mb-4">Technical Skills</h4>
            <div className="flex flex-wrap gap-2 mb-4">
              {formData.technicalSkills?.map((skillObj: any, index: number) => (
                <Badge key={index} variant="secondary" className="flex items-center gap-1">
                  {skillObj.skill || skillObj}
                  <button
                    onClick={() => removeTechnicalSkill(index)}
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
                placeholder="Add a technical skill"
                onKeyPress={(e) => e.key === 'Enter' && addTechnicalSkill()}
                className="max-w-xs"
              />
              <Button onClick={addTechnicalSkill} variant="outline" size="sm">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </Card>

          {/* Work Experience */}
          <Card className="p-6">
            <h4 className="font-semibold text-gray-900 mb-4">Work Experience</h4>
            <div className="space-y-4">
              {formData.workExperience?.map((exp: any, index: number) => (
                <div key={index} className="border rounded-lg p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label>Job Title</Label>
                      <Input value={exp.title || ''} readOnly />
                    </div>
                    <div>
                      <Label>Company</Label>
                      <Input value={exp.company || ''} readOnly />
                    </div>
                    <div>
                      <Label>Start Date</Label>
                      <Input value={exp.start_date || ''} readOnly />
                    </div>
                    <div>
                      <Label>End Date</Label>
                      <Input value={exp.end_date || ''} readOnly />
                    </div>
                  </div>
                  {exp.achievements && exp.achievements.length > 0 && (
                    <div className="mt-4">
                      <Label>Achievements</Label>
                      <div className="mt-2 space-y-1">
                        {exp.achievements.map((achievement: string, achIndex: number) => (
                          <p key={achIndex} className="text-sm text-gray-600">• {achievement}</p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {(!formData.workExperience || formData.workExperience.length === 0) && (
                <p className="text-gray-500 text-center py-4">No work experience data found</p>
              )}
            </div>
          </Card>

          {/* Education */}
          <Card className="p-6">
            <h4 className="font-semibold text-gray-900 mb-4">Education</h4>
            <div className="space-y-4">
              {formData.educationHistory?.map((edu: any, index: number) => (
                <div key={index} className="border rounded-lg p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label>Degree</Label>
                      <Input value={edu.degree || ''} readOnly />
                    </div>
                    <div>
                      <Label>Institution</Label>
                      <Input value={edu.institution || ''} readOnly />
                    </div>
                    <div>
                      <Label>Start Date</Label>
                      <Input value={edu.start_date || ''} readOnly />
                    </div>
                    <div>
                      <Label>End Date</Label>
                      <Input value={edu.end_date || ''} readOnly />
                    </div>
                  </div>
                  {edu.gpa && (
                    <div className="mt-4">
                      <Label>GPA</Label>
                      <Input value={edu.gpa} readOnly className="max-w-xs" />
                    </div>
                  )}
                </div>
              ))}
              {(!formData.educationHistory || formData.educationHistory.length === 0) && (
                <p className="text-gray-500 text-center py-4">No education data found</p>
              )}
            </div>
          </Card>

          {/* Projects */}
          {formData.projects && formData.projects.length > 0 && (
            <Card className="p-6">
              <h4 className="font-semibold text-gray-900 mb-4">Projects</h4>
              <div className="space-y-4">
                {formData.projects.map((project: any, index: number) => (
                  <div key={index} className="border rounded-lg p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label>Project Title</Label>
                        <Input value={project.title || ''} readOnly />
                      </div>
                      <div>
                        <Label>Link</Label>
                        <Input value={project.link || ''} readOnly />
                      </div>
                    </div>
                    {project.description && (
                      <div className="mt-4">
                        <Label>Description</Label>
                        <Textarea value={project.description} readOnly />
                      </div>
                    )}
                    {project.technologies && project.technologies.length > 0 && (
                      <div className="mt-4">
                        <Label>Technologies</Label>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {project.technologies.map((tech: string, techIndex: number) => (
                            <Badge key={techIndex} variant="outline">{tech}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Actions */}
          <div className="flex justify-end space-x-4">
            <Link to="/dashboard">
              <Button variant="outline">Cancel</Button>
            </Link>
            <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfileEdit;
