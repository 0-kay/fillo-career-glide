
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, Edit, Trash2, Clock, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useProfiles } from '@/hooks/useProfiles';
import { useToast } from '@/hooks/use-toast';
import DeleteProfileDialog from './DeleteProfileDialog';
import ResumeUpload from './ResumeUpload';

const ProfileList = () => {
  const navigate = useNavigate();
  const { profiles, loading, deleteProfile } = useProfiles();
  const { toast } = useToast();
  const [showUpload, setShowUpload] = useState(false);
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
        
        {profiles.map((profile) => (
          <Card key={profile.id} className="p-6 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <FileText className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{profile.name}</h3>
                  <div className="flex items-center space-x-4 mt-1">
                    <div className="flex items-center text-sm text-gray-600">
                      <Clock className="h-4 w-4 mr-1" />
                      Last updated: {new Date(profile.updated_at).toLocaleDateString()}
                    </div>
                    <Badge 
                      variant={profile.completeness >= 90 ? "default" : "secondary"}
                      className={profile.completeness >= 90 ? "bg-green-100 text-green-800" : ""}
                    >
                      {profile.completeness}% complete
                    </Badge>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => handleEdit(profile.id)}
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => handleDelete(profile.id, profile.name)}
                  className="text-red-600 hover:text-red-700"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            
            {profile.completeness < 90 && (
              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">
                  Complete your profile to improve auto-fill accuracy.
                </p>
              </div>
            )}
          </Card>
        ))}
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
