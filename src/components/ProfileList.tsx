
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, Edit, Trash2, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useProfiles } from '@/hooks/useProfiles';
import { useToast } from '@/hooks/use-toast';
import DeleteProfileDialog from './DeleteProfileDialog';

interface Profile {
  id: string;
  name: string;
  lastUsed: string;
  completeness: number;
}

interface ProfileListProps {
  profiles: Profile[];
  onDeleteProfile?: (profileId: string) => void;
}

const ProfileList = ({ profiles }: ProfileListProps) => {
  const navigate = useNavigate();
  const { deleteProfile } = useProfiles();
  const { toast } = useToast();
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

  if (profiles.length === 0) {
    return (
      <Card className="p-8 text-center">
        <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">No profiles yet</h3>
        <p className="text-gray-600 mb-4">
          Create your first application profile to get started with auto-filling job applications.
        </p>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-4">
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
                      Last used: {new Date(profile.lastUsed).toLocaleDateString()}
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
