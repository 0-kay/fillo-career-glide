import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, Edit, Trash2, Clock, Plus, Briefcase, GraduationCap, Code, User, Award, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useProfiles } from '@/hooks/useProfiles';
import { useToast } from '@/hooks/use-toast';
import DeleteProfileDialog from './DeleteProfileDialog';
import ResumeUpload from './ResumeUpload';

const ProfileList = () => {
  const navigate = useNavigate();
  const { profiles, loading, deleteProfile, refetch } = useProfiles();
  const { toast } = useToast();
  const [showUpload, setShowUpload] = useState(false);
  
  useEffect(() => {
    // Poll every 3 seconds if any profile is currently parsing in the background
    const hasPending = profiles.some(p => {
      const status = (p.resume_metadata as any)?.parsing_status;
      return status === 'Pending' || status === 'Uploading' || status === 'Processing';
    });
    if (hasPending) {
      const interval = setInterval(() => {
        refetch();
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [profiles, refetch]);

  const [deleteDialog, setDeleteDialog] = useState<{ isOpen: boolean; profileId: string; profileName: string }>({
    isOpen: false,
    profileId: '',
    profileName: ''
  });

  const handleEdit = (profileId: string) => {
    console.log('Edit profile:', profileId);
    navigate(`/profile/edit/${profileId}`);
  };

  const handleDelete = (profileId: string, profileName: string) => {
    console.log('Delete profile:', profileId);
    setDeleteDialog({
      isOpen: true,
      profileId,
      profileName
    });
  };

  const confirmDelete = async () => {
    try {
      const { error } = await deleteProfile(deleteDialog.profileId);
      if (error) {
        toast({
          title: "Error",
          description: "Failed to delete profile. Please try again.",
          variant: "destructive"
        });
      } else {
        toast({
          title: "Success",
          description: "Profile deleted successfully.",
        });
      }
    } catch (error) {
      console.error('Error deleting profile:', error);
      toast({
        title: "Error",
        description: "Failed to delete profile. Please try again.",
        variant: "destructive"
      });
    }
    setDeleteDialog({ isOpen: false, profileId: '', profileName: '' });
  };

  const closeDialog = () => {
    setDeleteDialog({ isOpen: false, profileId: '', profileName: '' });
  };

  const handleUploadComplete = () => {
    setShowUpload(false);
  };

  // Helper function to get profile stats
  const getProfileStats = (profile: any) => {
    const workExperience = Array.isArray(profile.work_experience) ? profile.work_experience : [];
    const education = Array.isArray(profile.education_history) ? profile.education_history : [];
    const technicalSkills = profile.technical_skills as any;
    const skills = technicalSkills?.all || [];
    const projects = Array.isArray(profile.projects) ? profile.projects : [];
    const certifications = Array.isArray(profile.certifications_licenses) ? profile.certifications_licenses : [];
    const personalDetails = profile.personal_details as any;
    
    return {
      experienceCount: workExperience.length,
      educationCount: education.length,
      skillsCount: Array.isArray(skills) ? skills.length : 0,
      projectsCount: projects.length,
      certificationsCount: certifications.length,
      hasPersonalDetails: Boolean(personalDetails?.email)
    };
  };

  // Helper function to get profile summary
  const getProfileSummary = (profile: any) => {
    const personalDetails = profile.personal_details || {};
    const workExp = profile.work_experience?.[0]; // Most recent experience
    
    const fullName = profile.resume_metadata?.profile_name || [profile.first_name, profile.last_name].filter(Boolean).join(' ') || personalDetails.full_name || personalDetails.fullName || 'Unknown User';
    
    return {
      name: fullName,
      email: personalDetails.email,
      currentRole: workExp?.jobTitle,
      currentCompany: workExp?.company,
      summary: personalDetails.summary
    };
  };

  if (loading) {
    return (
      <Card className="p-8 text-center">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mx-auto"></div>
        </div>
      </Card>
    );
  }

  if (showUpload) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold">Upload New Resume</h3>
          <Button variant="outline" onClick={() => setShowUpload(false)}>
            Cancel
          </Button>
        </div>
        <ResumeUpload onComplete={handleUploadComplete} />
      </Card>
    );
  }

  if (profiles.length === 0) {
    return (
      <Card className="p-8 text-center">
        <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">No profiles yet</h3>
        <p className="text-gray-600 mb-4">
          Create your first application profile to get started with auto-filling job applications.
        </p>
        <Button onClick={() => setShowUpload(true)} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="h-4 w-4 mr-2" />
          Upload Resume
        </Button>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-900">Your Profiles</h2>
          <Button onClick={() => setShowUpload(true)} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="h-4 w-4 mr-2" />
            Upload Resume
          </Button>
        </div>
        
        {profiles.map((profile) => {
          const stats = getProfileStats(profile);
          const summary = getProfileSummary(profile);
          
          return (
            <Card key={profile.id} className="p-6 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-start space-x-4 flex-1">
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <User className="h-6 w-6 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">{summary.name}</h3>
                    
                    {/* Current Role & Company */}
                    {summary.currentRole && (
                      <p className="text-sm text-gray-600 mb-1">
                        {summary.currentRole}
                        {summary.currentCompany && ` at ${summary.currentCompany}`}
                      </p>
                    )}
                    
                    {/* Email */}
                    {summary.email && (
                      <p className="text-sm text-gray-500 mb-2">{summary.email}</p>
                    )}
                    
                    {/* Professional Summary Preview */}
                    {summary.summary && (
                      <p className="text-sm text-gray-600 mb-3 line-clamp-2">
                        {/* Remove bullet points for preview and clean up text */}
                        {summary.summary.replace(/•/g, '').substring(0, 120).trim()}
                        {summary.summary.length > 120 && '...'}
                      </p>
                    )}
                    
                    {/* Profile Stats */}
                    <div className="flex flex-wrap gap-2 mb-2">
                      {stats.experienceCount > 0 && (
                        <div className="flex items-center text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded">
                          <Briefcase className="h-3 w-3 mr-1" />
                          {stats.experienceCount} job{stats.experienceCount !== 1 ? 's' : ''}
                        </div>
                      )}
                      {stats.educationCount > 0 && (
                        <div className="flex items-center text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded">
                          <GraduationCap className="h-3 w-3 mr-1" />
                          {stats.educationCount} degree{stats.educationCount !== 1 ? 's' : ''}
                        </div>
                      )}
                      {stats.skillsCount > 0 && (
                        <div className="flex items-center text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded">
                          <Code className="h-3 w-3 mr-1" />
                          {stats.skillsCount} skill{stats.skillsCount !== 1 ? 's' : ''}
                        </div>
                      )}
                      {stats.projectsCount > 0 && (
                        <div className="flex items-center text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded">
                          <FileText className="h-3 w-3 mr-1" />
                          {stats.projectsCount} project{stats.projectsCount !== 1 ? 's' : ''}
                        </div>
                      )}
                      {stats.certificationsCount > 0 && (
                        <div className="flex items-center text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded">
                          <Award className="h-3 w-3 mr-1" />
                          {stats.certificationsCount} cert{stats.certificationsCount !== 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                    
                    {/* Skills Preview */}
                    {(() => {
                      const technicalSkills = profile.technical_skills as any;
                      const skillsArray = technicalSkills?.all || [];
                      return Array.isArray(skillsArray) && skillsArray.length > 0 && (
                        <div className="mb-2">
                          <div className="flex flex-wrap gap-1">
                            {skillsArray.slice(0, 5).map((skill: string, index: number) => (
                              <Badge key={index} variant="secondary" className="text-xs">
                                {skill}
                              </Badge>
                            ))}
                            {skillsArray.length > 5 && (
                              <Badge variant="outline" className="text-xs">
                                +{skillsArray.length - 5} more
                              </Badge>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                    
                    {/* Metadata */}
                    <div className="flex items-center space-x-4 mt-2 text-xs text-gray-500">
                      <div className="flex items-center">
                        <Clock className="h-3 w-3 mr-1" />
                        Last updated: {new Date(profile.updated_at).toLocaleDateString()}
                      </div>
                      {(() => {
                        const resumeMetadata = profile.resume_metadata as any;
                        return resumeMetadata?.fileName && (
                          <div className="flex items-center">
                            <FileText className="h-3 w-3 mr-1" />
                            {resumeMetadata.fileName}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
                
                <div className="flex items-start space-x-2">
                  {(() => {
                    const status = (profile.resume_metadata as any)?.parsing_status;
                    if (status === 'Pending' || status === 'Uploading' || status === 'Processing') {
                      const label = status === 'Uploading' ? 'Uploading...' : 'Processing...';
                      return <Badge className="bg-blue-100 text-blue-800 border-blue-200 flex items-center"><Loader2 className="h-3 w-3 mr-1 animate-spin" />{label}</Badge>;
                    }
                    if (status === 'Failed') {
                      return <Badge variant="destructive">Failed</Badge>;
                    }
                    return (
                      <Badge
                        variant={profile.completeness >= 75 ? "default" : "secondary"}
                        className={profile.completeness >= 75 ? "bg-green-100 text-green-800" : ""}
                      >
                        {profile.completeness}% complete
                      </Badge>
                    );
                  })()}
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => handleEdit(profile.id)}
                    disabled={['Pending', 'Uploading', 'Processing'].includes((profile.resume_metadata as any)?.parsing_status)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => handleDelete(profile.id, summary.name)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              
              {profile.completeness < 75 && (
                <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
                  <p className="text-sm text-orange-800 font-medium">
                    Profile must be at least 75% filled to be used for filling.
                  </p>
                  <p className="text-xs text-orange-700 mt-1">
                    {!stats.hasPersonalDetails && "Add personal details. "}
                    {stats.experienceCount === 0 && "Add work experience. "}
                    {stats.skillsCount === 0 && "Add technical skills. "}
                  </p>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <DeleteProfileDialog
        isOpen={deleteDialog.isOpen}
        onClose={closeDialog}
        onConfirm={confirmDelete}
        profileName={deleteDialog.profileName}
      />
    </>
  );
};

export default ProfileList;
