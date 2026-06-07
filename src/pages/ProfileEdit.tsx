import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Plus, X, Save, Loader2, ExternalLink, Award, Globe, Briefcase, GraduationCap, Code, Users, Trophy, BookOpen, User, Settings, ClipboardCheck } from 'lucide-react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useProfiles } from '@/hooks/useProfiles';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import ScreeningQuestionsDialog, { ScreeningAnswer } from '@/components/ScreeningQuestionsDialog';

const ProfileEdit = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getProfile, updateProfile } = useProfiles();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState<any>(null);
  const [newSkill, setNewSkill] = useState('');
  const [showScreeningDialog, setShowScreeningDialog] = useState(false);

  useEffect(() => {
    if (authLoading) return; // Wait until authentication check is complete
    
    const fetchProfile = async () => {
      if (!id || !user) {
        if (!user) {
          navigate('/');
        }
        return;
      }
      
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
          // Initialize form data with proper field mappings from actual data structure
          const pd = data.personal_details || {} as any;
          pd.fullName = pd.full_name || pd.fullName || '';
          // Normalize address: migrate flat string to object format
          if (!pd.address || typeof pd.address === 'string') {
            pd.address = { line1: '', line2: '', city: '', state: '', postalCode: '', country: '' };
          }
          // Normalize phone: strip whitespace
          if (pd.phone) {
            pd.phone = pd.phone.replace(/\s+/g, '');
          }
          // Normalize phoneExtension: clear bogus values like "empty string"
          if (!pd.phoneExtension || pd.phoneExtension === 'empty string') {
            pd.phoneExtension = '';
          }
          // Normalize education dates: migrate plain strings to {year, month} objects
          const normalizeEduDate = (d: any) => {
            if (d && typeof d === 'object' && 'year' in d) return { year: d.year || "", month: d.month || "" };
            if (typeof d === 'string') {
              const s = d.trim();
              const ym = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
              if (ym) return { year: ym[2], month: ym[1] };
              const yOnly = s.match(/^(\d{4})$/);
              if (yOnly) return { year: yOnly[1], month: "" };
              return { year: s, month: "" };
            }
            return { year: "", month: "" };
          };
          const educationHistory = (data.education_history || []).map((edu: any) => ({
            ...edu,
            startDate: normalizeEduDate(edu.startDate),
            endDate: normalizeEduDate(edu.endDate),
          }));

          setFormData({
            profileName: data.name || 'Untitled Profile',
            personalDetails: pd,
            workExperience: data.work_experience || [],
            educationHistory,
            technicalSkills: data.technical_skills || {},
            softSkills: data.soft_skills || {},
            toolsTechnologies: data.tools_technologies || {},
            projects: data.projects || [],
            certifications: data.certifications_licenses || [],
            awards: data.awards_honors || [],
            languages: data.languages || [],
            volunteerExperience: data.volunteer_experience || [],
            jobPreferences: data.job_preferences || {},
            screeningAnswers: (data.job_preferences as any)?.screening_answers || [],
            resumeMetadata: data.resume_metadata || {}
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
  }, [id, getProfile, navigate, toast, user, authLoading]);

  const handlePersonalDetailsChange = (field: string, value: string) => {
    setFormData((prev: any) => ({
      ...prev,
      personalDetails: {
        ...prev.personalDetails,
        [field]: value,
        ...(field === 'fullName' ? { full_name: value } : {})
      }
    }));
  };

  const handleAddressChange = (field: string, value: string) => {
    setFormData((prev: any) => ({
      ...prev,
      personalDetails: {
        ...prev.personalDetails,
        address: {
          ...(prev.personalDetails?.address || {}),
          [field]: value
        }
      }
    }));
  };

  const addTechnicalSkill = () => {
    if (newSkill.trim()) {
      const currentSkills = formData.technicalSkills?.all || [];
      setFormData((prev: any) => ({
        ...prev,
        technicalSkills: {
          ...prev.technicalSkills,
          all: [...currentSkills, newSkill.trim()]
        }
      }));
      setNewSkill('');
    }
  };

  const removeTechnicalSkill = (index: number) => {
    const currentSkills = formData.technicalSkills?.all || [];
    setFormData((prev: any) => ({
      ...prev,
      technicalSkills: {
        ...prev.technicalSkills,
        all: currentSkills.filter((_: any, i: number) => i !== index)
      }
    }));
  };

  const handleSave = async () => {
    if (!id || !formData) return;
    
    setSaving(true);
    try {
      // Ensure address is always saved as an object and phoneExtension is included
      const personalDetails = {
        ...formData.personalDetails,
        address: typeof formData.personalDetails?.address === 'object' && formData.personalDetails?.address !== null
          ? formData.personalDetails.address
          : { line1: '', line2: '', city: '', state: '', postalCode: '', country: '' },
        phoneExtension: formData.personalDetails?.phoneExtension || '',
      };
      const { error } = await updateProfile(id, {
        personal_details: personalDetails,
        work_experience: formData.workExperience,
        education_history: formData.educationHistory,
        technical_skills: formData.technicalSkills,
        soft_skills: formData.softSkills,
        tools_technologies: formData.toolsTechnologies,
        projects: formData.projects,
        certifications_licenses: formData.certifications,
        awards_honors: formData.awards,
        languages: formData.languages,
        volunteer_experience: formData.volunteerExperience,
        job_preferences: { ...formData.jobPreferences, screening_answers: formData.screeningAnswers },
        resume_metadata: formData.resumeMetadata
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

  // EditableField component for inline editing
  const EditableField = ({ 
    value, 
    onSave, 
    fieldKey, 
    type = 'text', 
    multiline = false,
    placeholder = "Click to edit...",
    className = ""
  }: {
    value: string;
    onSave: (value: string) => void;
    fieldKey: string;
    type?: string;
    multiline?: boolean;
    placeholder?: string;
    className?: string;
  }) => {
    const [editValue, setEditValue] = useState(value || '');
    const [isEditing, setIsEditing] = useState(false);

    const handleEdit = () => {
      setIsEditing(true);
      setEditValue(value || '');
    };

    const handleSaveField = () => {
      onSave(editValue);
      setIsEditing(false);
    };

    const handleCancel = () => {
      setEditValue(value || '');
      setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !multiline) {
        handleSaveField();
      } else if (e.key === 'Escape') {
        handleCancel();
      }
    };

    if (isEditing) {
      return (
        <div className="space-y-2">
          {multiline ? (
            <Textarea
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className={`min-h-[100px] ${className}`}
              placeholder={placeholder}
              autoFocus
            />
          ) : (
            <Input
              type={type}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              className={className}
              placeholder={placeholder}
              autoFocus
            />
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSaveField}>
              <Save className="h-3 w-3 mr-1" />
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={handleCancel}>
              <X className="h-3 w-3 mr-1" />
              Cancel
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div 
        className={`cursor-pointer hover:bg-gray-50 p-2 rounded border border-transparent hover:border-gray-200 transition-colors min-h-[2rem] flex items-start ${className}`}
        onClick={handleEdit}
        title="Click to edit"
      >
        {value ? (
          <div className="w-full">
            {value.includes('•') ? (
              value.split('•').filter(item => item.trim()).map((item: string, itemIndex: number) => (
                <div key={itemIndex} className="mb-1 flex items-start">
                  <span className="text-blue-600 mr-2 mt-0.5">•</span>
                  <span className="flex-1">{item.trim()}</span>
                </div>
              ))
            ) : (
              <span className="whitespace-pre-line">{value}</span>
            )}
          </div>
        ) : (
          <span className="text-gray-400 italic">{placeholder}</span>
        )}
      </div>
    );
  };

  // Helper to update nested fields
  const updateNestedField = (section: string, index: number, field: string, value: string) => {
    setFormData((prev: any) => {
      const newData = { ...prev };
      if (!newData[section]) newData[section] = [];
      if (!newData[section][index]) newData[section][index] = {};
      newData[section][index][field] = value;
      return newData;
    });
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
          <p className="text-gray-600">View and update your comprehensive profile information.</p>
          {formData.resumeMetadata?.fileName && (
            <div className="mt-2 flex items-center text-sm text-gray-500">
              <Briefcase className="h-4 w-4 mr-1" />
              Parsed from: {formData.resumeMetadata.fileName}
              <Badge className="ml-2 bg-green-100 text-green-800">
                {formData.resumeMetadata.extractionQuality?.dataCompleteness || 'N/A'}% complete
              </Badge>
            </div>
          )}
        </div>

        <div className="space-y-8">
          {/* Profile Name */}
          <Card className="p-6">
            <div className="flex items-center mb-4">
              <User className="h-5 w-5 mr-2 text-blue-600" />
              <h4 className="font-semibold text-gray-900">Profile Name</h4>
            </div>
            <Input
              value={formData.profileName || ''}
              onChange={(e) => setFormData((prev: any) => ({ ...prev, profileName: e.target.value }))}
              placeholder="e.g., Software Engineer Profile"
              className="max-w-md"
            />
          </Card>

          {/* Personal Information */}
          <Card className="p-6">
            <div className="flex items-center mb-4">
              <User className="h-5 w-5 mr-2 text-blue-600" />
              <h4 className="font-semibold text-gray-900">Personal Information</h4>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  value={formData.personalDetails?.fullName || ''}
                  onChange={(e) => handlePersonalDetailsChange('fullName', e.target.value)}
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
                <Label htmlFor="phoneExtension">Phone Extension</Label>
                <Input
                  id="phoneExtension"
                  value={formData.personalDetails?.phoneExtension || ''}
                  onChange={(e) => handlePersonalDetailsChange('phoneExtension', e.target.value)}
                />
              </div>
              <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="addressLine1">Address Line 1</Label>
                  <Input
                    id="addressLine1"
                    value={formData.personalDetails?.address?.line1 || ''}
                    onChange={(e) => handleAddressChange('line1', e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="addressLine2">Address Line 2</Label>
                  <Input
                    id="addressLine2"
                    value={formData.personalDetails?.address?.line2 || ''}
                    onChange={(e) => handleAddressChange('line2', e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={formData.personalDetails?.address?.city || ''}
                    onChange={(e) => handleAddressChange('city', e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="state">State / Province</Label>
                  <Input
                    id="state"
                    value={formData.personalDetails?.address?.state || ''}
                    onChange={(e) => handleAddressChange('state', e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="postalCode">Postal Code</Label>
                  <Input
                    id="postalCode"
                    value={formData.personalDetails?.address?.postalCode || ''}
                    onChange={(e) => handleAddressChange('postalCode', e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="country">Country</Label>
                  <Input
                    id="country"
                    value={formData.personalDetails?.address?.country || ''}
                    onChange={(e) => handleAddressChange('country', e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="linkedin">LinkedIn</Label>
                <Input
                  id="linkedin"
                  value={formData.personalDetails?.linkedin || ''}
                  onChange={(e) => handlePersonalDetailsChange('linkedin', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="github">GitHub</Label>
                <Input
                  id="github"
                  value={formData.personalDetails?.github || ''}
                  onChange={(e) => handlePersonalDetailsChange('github', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="portfolio">Portfolio</Label>
                <Input
                  id="portfolio"
                  value={formData.personalDetails?.portfolio || ''}
                  onChange={(e) => handlePersonalDetailsChange('portfolio', e.target.value)}
                />
              </div>
            </div>
            
            {/* Additional Links */}
            {formData.personalDetails?.additionalLinks && formData.personalDetails.additionalLinks.length > 0 && (
              <div className="mt-4">
                <Label className="text-sm font-medium">Additional Links</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {formData.personalDetails.additionalLinks.map((link: any, linkIndex: number) => (
                    <a 
                      key={linkIndex}
                      href={link.url?.startsWith('http') ? link.url : `https://${link.url}`}
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded-full hover:bg-blue-200 transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {link.label || 'Link'}
                    </a>
                  ))}
                </div>
              </div>
            )}
            
            {/* Main Profile Links */}
            {(formData.personalDetails?.linkedin || formData.personalDetails?.github || formData.personalDetails?.portfolio) && (
              <div className="mt-4">
                <Label className="text-sm font-medium">Profile Links</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {formData.personalDetails?.linkedin && (
                    <a 
                      href={formData.personalDetails.linkedin.startsWith('http') ? formData.personalDetails.linkedin : `https://${formData.personalDetails.linkedin}`}
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded-full hover:bg-blue-200 transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                      LinkedIn
                    </a>
                  )}
                  {formData.personalDetails?.github && (
                    <a 
                      href={formData.personalDetails.github.startsWith('http') ? formData.personalDetails.github : `https://${formData.personalDetails.github}`}
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors"
                    >
                      <Code className="h-3 w-3" />
                      GitHub
                    </a>
                  )}
                  {formData.personalDetails?.portfolio && (
                    <a 
                      href={formData.personalDetails.portfolio.startsWith('http') ? formData.personalDetails.portfolio : `https://${formData.personalDetails.portfolio}`}
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 px-3 py-1 text-xs bg-purple-100 text-purple-700 rounded-full hover:bg-purple-200 transition-colors"
                    >
                      <Globe className="h-3 w-3" />
                      Portfolio
                    </a>
                  )}
                </div>
              </div>
            )}
            
            <div className="mt-4">
              <Label htmlFor="summary">Professional Summary</Label>
              <EditableField
                value={formData.personalDetails?.summary || ''}
                onSave={(value) => handlePersonalDetailsChange('summary', value)}
                fieldKey="professional-summary"
                multiline={true}
                placeholder="Write a compelling professional summary. Use • for bullet points."
                className="mt-2"
              />
            </div>
          </Card>

          {/* Technical Skills */}
          <Card className="p-6">
            <div className="flex items-center mb-4">
              <Code className="h-5 w-5 mr-2 text-blue-600" />
              <h4 className="font-semibold text-gray-900">Technical Skills</h4>
            </div>
            
            {/* All Skills */}
            <div className="mb-6">
              <Label className="text-sm font-medium">All Skills</Label>
              <div className="flex flex-wrap gap-2 mt-2 mb-4">
                {(formData.technicalSkills?.all || []).map((skill: string, index: number) => (
                  <Badge key={index} variant="secondary" className="flex items-center gap-1">
                    {skill}
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
            </div>

            {/* Categorized Skills */}
            {Object.entries(formData.technicalSkills || {}).filter(([key]) => key !== 'all').map(([category, skills]) => (
              <div key={category} className="mb-4">
                <Label className="text-sm font-medium capitalize">{category} Skills</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {Array.isArray(skills) && skills.map((skill: string, index: number) => (
                    <Badge key={index} variant="outline" className="capitalize">
                      {skill}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </Card>

          {/* Tools & Technologies */}
          {formData.toolsTechnologies?.all && formData.toolsTechnologies.all.length > 0 && (
            <Card className="p-6">
              <div className="flex items-center mb-4">
                <Settings className="h-5 w-5 mr-2 text-blue-600" />
                <h4 className="font-semibold text-gray-900">Tools & Technologies</h4>
              </div>
              <div className="flex flex-wrap gap-2">
                {formData.toolsTechnologies.all.map((tool: string, index: number) => (
                  <Badge key={index} variant="outline">{tool}</Badge>
                ))}
              </div>
            </Card>
          )}

          {/* Work Experience */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <Briefcase className="h-5 w-5 mr-2 text-blue-600" />
                <h4 className="font-semibold text-gray-900">Work Experience</h4>
              </div>
              <Button 
                size="sm" 
                onClick={handleSave} 
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                Save All Changes
              </Button>
            </div>
            <div className="space-y-6">
              {(formData.workExperience || []).map((exp: any, index: number) => (
                <div key={index} className="border rounded-lg p-4 bg-gray-50">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <div>
                      <Label className="text-sm font-medium">Job Title</Label>
                      <EditableField
                        value={exp?.jobTitle || ''}
                        onSave={(value) => updateNestedField('workExperience', index, 'jobTitle', value)}
                        fieldKey={`work-title-${index}`}
                        placeholder="Enter job title"
                        className="font-semibold"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Company</Label>
                      <EditableField
                        value={exp?.company || ''}
                        onSave={(value) => updateNestedField('workExperience', index, 'company', value)}
                        fieldKey={`work-company-${index}`}
                        placeholder="Enter company name"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Start Date</Label>
                      <EditableField
                        value={exp?.startDate || ''}
                        onSave={(value) => updateNestedField('workExperience', index, 'startDate', value)}
                        fieldKey={`work-start-${index}`}
                        placeholder="e.g., Jan 2022"
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-medium">End Date</Label>
                      <EditableField
                        value={exp?.endDate || ''}
                        onSave={(value) => updateNestedField('workExperience', index, 'endDate', value)}
                        fieldKey={`work-end-${index}`}
                        placeholder="e.g., Present or Dec 2023"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <Label className="text-sm font-medium">Location</Label>
                      <EditableField
                        value={exp?.location || ''}
                        onSave={(value) => updateNestedField('workExperience', index, 'location', value)}
                        fieldKey={`work-location-${index}`}
                        placeholder="e.g., San Francisco, CA"
                      />
                    </div>
                  </div>
                  
                  <div className="mb-4">
                    <Label className="text-sm font-medium">Description</Label>
                    <EditableField
                      value={exp?.description || ''}
                      onSave={(value) => updateNestedField('workExperience', index, 'description', value)}
                      fieldKey={`work-desc-${index}`}
                      multiline={true}
                      placeholder="Describe your role and responsibilities. Use • for bullet points."
                    />
                  </div>

                  {exp?.technologies && exp.technologies.length > 0 && (
                    <div className="mb-4">
                      <Label className="text-sm font-medium">Technologies Used</Label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {exp.technologies.map((tech: string, techIndex: number) => (
                          <Badge key={techIndex} variant="outline" className="text-xs">
                            {tech}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {exp?.achievements && exp.achievements.length > 0 && (
                    <div className="mb-4">
                      <Label className="text-sm font-medium">Key Achievements</Label>
                      <ul className="mt-2 space-y-1">
                        {exp.achievements.map((achievement: string, achIndex: number) => (
                          <li key={achIndex} className="text-sm text-gray-700 flex items-start">
                            <span className="mr-2">•</span>
                            <span>{achievement}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {exp?.metrics && exp.metrics.length > 0 && (
                    <div>
                      <Label className="text-sm font-medium">Metrics & Impact</Label>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {exp.metrics.map((metric: string, metricIndex: number) => (
                          <Badge key={metricIndex} variant="secondary" className="text-xs bg-green-100 text-green-800">
                            {metric}
                          </Badge>
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
            <div className="flex items-center mb-4">
              <GraduationCap className="h-5 w-5 mr-2 text-blue-600" />
              <h4 className="font-semibold text-gray-900">Education</h4>
            </div>
            <div className="space-y-4">
              {(formData.educationHistory || []).map((edu: any, index: number) => (
                <div key={index} className="border rounded-lg p-4 bg-gray-50">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <Label className="text-sm font-medium">Degree</Label>
                      <p className="text-sm font-semibold text-gray-900">{edu?.degree || 'N/A'}</p>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Institution</Label>
                      <p className="text-sm text-gray-700">{edu?.school || 'N/A'}</p>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Graduation</Label>
                      <p className="text-sm text-gray-700">
                        {edu?.endDate?.month ? `${edu.endDate.month}/` : ''}{edu?.endDate?.year || 'N/A'}
                      </p>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Location</Label>
                      <p className="text-sm text-gray-700">{edu?.location || 'N/A'}</p>
                    </div>
                  </div>
                  {edu?.description && (
                    <div className="mt-4">
                      <Label className="text-sm font-medium">Details</Label>
                      <div className="mt-2 text-sm text-gray-700">
                        {edu.description.includes('•') ? (
                          edu.description.split('•').filter(item => item.trim()).map((item: string, itemIndex: number) => (
                            <div key={itemIndex} className="mb-1 flex items-start">
                              <span className="text-blue-600 mr-2 mt-0.5">•</span>
                              <span className="flex-1">{item.trim()}</span>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-gray-700">{edu.description}</p>
                        )}
                      </div>
                    </div>
                  )}
                  {edu?.gpa && (
                    <div className="mt-2">
                      <Label className="text-sm font-medium">GPA</Label>
                      <p className="text-sm text-gray-700">{edu.gpa}</p>
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
              <div className="flex items-center mb-4">
                <Code className="h-5 w-5 mr-2 text-blue-600" />
                <h4 className="font-semibold text-gray-900">Projects</h4>
              </div>
              <div className="space-y-4">
                {formData.projects.map((project: any, index: number) => (
                  <div key={index} className="border rounded-lg p-4 bg-gray-50">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                      <div>
                        <Label className="text-sm font-medium">Project Name</Label>
                        <EditableField
                          value={project?.name || ''}
                          onSave={(value) => updateNestedField('projects', index, 'name', value)}
                          fieldKey={`project-name-${index}`}
                          placeholder="Enter project name"
                          className="font-semibold"
                        />
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Role</Label>
                        <EditableField
                          value={project?.role || ''}
                          onSave={(value) => updateNestedField('projects', index, 'role', value)}
                          fieldKey={`project-role-${index}`}
                          placeholder="Your role in the project"
                        />
                      </div>
                    </div>
                    
                    {/* Project Links */}
                    {(project?.url || project?.githubUrl || project?.demoUrl || (project?.links && project.links.length > 0)) && (
                      <div className="mb-4">
                        <Label className="text-sm font-medium">Project Links</Label>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {project?.url && (
                            <a 
                              href={project.url.startsWith('http') ? project.url : `https://${project.url}`}
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 px-3 py-1 text-xs bg-blue-100 text-blue-700 rounded-full hover:bg-blue-200 transition-colors"
                            >
                              <ExternalLink className="h-3 w-3" />
                              Project URL
                            </a>
                          )}
                          {project?.githubUrl && (
                            <a 
                              href={project.githubUrl.startsWith('http') ? project.githubUrl : `https://${project.githubUrl}`}
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors"
                            >
                              <Code className="h-3 w-3" />
                              GitHub
                            </a>
                          )}
                          {project?.demoUrl && (
                            <a 
                              href={project.demoUrl.startsWith('http') ? project.demoUrl : `https://${project.demoUrl}`}
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 px-3 py-1 text-xs bg-green-100 text-green-700 rounded-full hover:bg-green-200 transition-colors"
                            >
                              <Globe className="h-3 w-3" />
                              Live Demo
                            </a>
                          )}
                          {project?.links && project.links.map((link: any, linkIndex: number) => (
                            <a 
                              key={linkIndex}
                              href={link.url?.startsWith('http') ? link.url : `https://${link.url}`}
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 px-3 py-1 text-xs bg-purple-100 text-purple-700 rounded-full hover:bg-purple-200 transition-colors"
                            >
                              <ExternalLink className="h-3 w-3" />
                              {link.label || 'Link'}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    <div className="mb-4">
                      <Label className="text-sm font-medium">Description</Label>
                      <EditableField
                        value={project?.description || ''}
                        onSave={(value) => updateNestedField('projects', index, 'description', value)}
                        fieldKey={`project-desc-${index}`}
                        multiline={true}
                        placeholder="Describe the project, your contributions, and impact. Use • for bullet points."
                      />
                    </div>

                    {project?.technologies && project.technologies.length > 0 && (
                      <div className="mb-4">
                        <Label className="text-sm font-medium">Technologies</Label>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {project.technologies.map((tech: string, techIndex: number) => (
                            <Badge key={techIndex} variant="outline" className="text-xs">
                              {tech}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {project?.metrics && project.metrics.length > 0 && (
                      <div>
                        <Label className="text-sm font-medium">Impact & Metrics</Label>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {project.metrics.map((metric: string, metricIndex: number) => (
                            <Badge key={metricIndex} variant="secondary" className="text-xs bg-green-100 text-green-800">
                              {metric}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Certifications */}
          {formData.certifications && formData.certifications.length > 0 && (
            <Card className="p-6">
              <div className="flex items-center mb-4">
                <Award className="h-5 w-5 mr-2 text-blue-600" />
                <h4 className="font-semibold text-gray-900">Certifications & Licenses</h4>
              </div>
              <div className="space-y-4">
                {formData.certifications.map((cert: any, index: number) => (
                  <div key={index} className="border rounded-lg p-4 bg-gray-50">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium">Certification Name</Label>
                        <p className="text-sm font-semibold text-gray-900">{cert?.name || 'N/A'}</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Issuing Organization</Label>
                        <p className="text-sm text-gray-700">{cert?.issuingOrganization || 'N/A'}</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Issue Date</Label>
                        <p className="text-sm text-gray-700">{cert?.dateIssued || 'N/A'}</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Expiration Date</Label>
                        <p className="text-sm text-gray-700">{cert?.expirationDate || 'Does not expire'}</p>
                      </div>
                    </div>
                    {cert?.credentialId && (
                      <div className="mt-4">
                        <Label className="text-sm font-medium">Credential ID</Label>
                        <p className="text-sm text-gray-700 font-mono">{cert.credentialId}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Awards & Honors */}
          {formData.awards && formData.awards.length > 0 && (
            <Card className="p-6">
              <div className="flex items-center mb-4">
                <Trophy className="h-5 w-5 mr-2 text-blue-600" />
                <h4 className="font-semibold text-gray-900">Awards & Honors</h4>
              </div>
              <div className="space-y-4">
                {formData.awards.map((award: any, index: number) => (
                  <div key={index} className="border rounded-lg p-4 bg-gray-50">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium">Award Title</Label>
                        <p className="text-sm font-semibold text-gray-900">{award?.title || 'N/A'}</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Issuer</Label>
                        <p className="text-sm text-gray-700">{award?.issuer || 'N/A'}</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Date</Label>
                        <p className="text-sm text-gray-700">{award?.date || 'N/A'}</p>
                      </div>
                    </div>
                    {award?.description && (
                      <div className="mt-4">
                        <Label className="text-sm font-medium">Description</Label>
                        <div className="mt-2 text-sm text-gray-700">
                          {award.description.split('•').filter(item => item.trim()).map((item: string, itemIndex: number) => (
                            <div key={itemIndex} className="mb-1 flex items-start">
                              <span className="text-blue-600 mr-2 mt-0.5">•</span>
                              <span className="flex-1">{item.trim()}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Volunteer Experience */}
          {formData.volunteerExperience && formData.volunteerExperience.length > 0 && (
            <Card className="p-6">
              <div className="flex items-center mb-4">
                <Users className="h-5 w-5 mr-2 text-blue-600" />
                <h4 className="font-semibold text-gray-900">Volunteer Experience</h4>
              </div>
              <div className="space-y-4">
                {formData.volunteerExperience.map((vol: any, index: number) => (
                  <div key={index} className="border rounded-lg p-4 bg-gray-50">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium">Role</Label>
                        <p className="text-sm font-semibold text-gray-900">{vol?.role || 'N/A'}</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Organization</Label>
                        <p className="text-sm text-gray-700">{vol?.organization || 'N/A'}</p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Duration</Label>
                        <p className="text-sm text-gray-700">
                          {vol?.startDate || 'N/A'} - {vol?.endDate || 'Present'}
                        </p>
                      </div>
                      <div>
                        <Label className="text-sm font-medium">Location</Label>
                        <p className="text-sm text-gray-700">{vol?.location || 'N/A'}</p>
                      </div>
                    </div>
                    {vol?.description && (
                      <div className="mt-4">
                        <Label className="text-sm font-medium">Description</Label>
                        <div className="mt-2 text-sm text-gray-700">
                          {vol.description.split('•').filter(item => item.trim()).map((item: string, itemIndex: number) => (
                            <div key={itemIndex} className="mb-1 flex items-start">
                              <span className="text-blue-600 mr-2 mt-0.5">•</span>
                              <span className="flex-1">{item.trim()}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Languages */}
          {formData.languages && formData.languages.length > 0 && (
            <Card className="p-6">
              <div className="flex items-center mb-4">
                <Globe className="h-5 w-5 mr-2 text-blue-600" />
                <h4 className="font-semibold text-gray-900">Languages</h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {formData.languages.map((lang: any, index: number) => (
                  <div key={index} className="border rounded-lg p-4 bg-gray-50">
                    <div className="flex justify-between items-center">
                      <p className="text-sm font-semibold text-gray-900">{lang?.language || 'N/A'}</p>
                      <Badge variant="outline" className="text-xs">
                        {lang?.proficiency || 'N/A'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Screening Questions */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center">
                <ClipboardCheck className="h-5 w-5 mr-2 text-blue-600" />
                <h4 className="font-semibold text-gray-900">Screening Questions</h4>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowScreeningDialog(true)}
              >
                Edit
              </Button>
            </div>
            {formData.screeningAnswers && formData.screeningAnswers.length > 0 ? (
              <div className="space-y-3">
                {formData.screeningAnswers.map((sa: ScreeningAnswer) => (
                  <div key={sa.id} className="flex items-center justify-between border rounded-lg p-3 bg-gray-50">
                    <p className="text-sm text-gray-700 flex-1 mr-4">{sa.question}</p>
                    <span className="text-sm font-medium text-gray-900 shrink-0">
                      {sa.answer || <span className="text-gray-400">Not answered</span>}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center py-4">
                No screening answers configured.{' '}
                <button
                  type="button"
                  className="text-blue-600 hover:underline"
                  onClick={() => setShowScreeningDialog(true)}
                >
                  Add answers
                </button>
              </p>
            )}
          </Card>

          <ScreeningQuestionsDialog
            isOpen={showScreeningDialog}
            onClose={() => setShowScreeningDialog(false)}
            onSave={(answers) => {
              setFormData((prev: any) => ({ ...prev, screeningAnswers: answers }));
              setShowScreeningDialog(false);
            }}
            initialAnswers={formData.screeningAnswers}
          />

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

