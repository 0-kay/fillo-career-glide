
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { Json } from '@/integrations/supabase/types';

interface ApplicationProfile {
  id: string;
  name: string;
  personal_info: Json;
  experience: Json;
  education: Json;
  skills: string[];
  certifications: string[];
  completeness: number;
  created_at: string;
  updated_at: string;
}

export function useProfiles() {
  const [profiles, setProfiles] = useState<ApplicationProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  const fetchProfiles = async () => {
    if (!user) {
      setProfiles([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('application_profiles')
        .select('*')
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setProfiles(data || []);
    } catch (error) {
      console.error('Error fetching profiles:', error);
    } finally {
      setLoading(false);
    }
  };

  const createProfile = async (profileData: {
    name: string;
    personal_info?: Json;
    experience?: Json;
    education?: Json;
    skills?: string[];
    certifications?: string[];
    completeness?: number;
  }) => {
    if (!user) return { error: 'Not authenticated' };

    try {
      const { data, error } = await supabase
        .from('application_profiles')
        .insert([{
          name: profileData.name,
          user_id: user.id,
          personal_info: profileData.personal_info || null,
          experience: profileData.experience || null,
          education: profileData.education || null,
          skills: profileData.skills || [],
          certifications: profileData.certifications || [],
          completeness: profileData.completeness || 0
        }])
        .select()
        .single();

      if (error) throw error;
      
      await fetchProfiles(); // Refresh the list
      return { data, error: null };
    } catch (error) {
      console.error('Error creating profile:', error);
      return { error };
    }
  };

  const updateProfile = async (id: string, profileData: Partial<{
    name: string;
    personal_info: Json;
    experience: Json;
    education: Json;
    skills: string[];
    certifications: string[];
    completeness: number;
  }>) => {
    if (!user) return { error: 'Not authenticated' };

    try {
      const { data, error } = await supabase
        .from('application_profiles')
        .update(profileData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      
      await fetchProfiles(); // Refresh the list
      return { data, error: null };
    } catch (error) {
      console.error('Error updating profile:', error);
      return { error };
    }
  };

  const deleteProfile = async (id: string) => {
    if (!user) return { error: 'Not authenticated' };

    try {
      const { error } = await supabase
        .from('application_profiles')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      await fetchProfiles(); // Refresh the list
      return { error: null };
    } catch (error) {
      console.error('Error deleting profile:', error);
      return { error };
    }
  };

  useEffect(() => {
    fetchProfiles();
  }, [user]);

  return {
    profiles,
    loading,
    createProfile,
    updateProfile,
    deleteProfile,
    refetch: fetchProfiles
  };
}
