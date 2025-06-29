
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { Json } from '@/integrations/supabase/types';

interface ApplicationProfile {
  id: string;
  name: string;
  personal_info: Json;
  personal_details: Json;
  experience: Json;
  education: Json;
  education_history: Json;
  work_experience: Json;
  skills: string[];
  technical_skills: Json;
  soft_skills: Json;
  tools_technologies: Json;
  certifications: string[];
  certifications_licenses: Json;
  awards_honors: Json;
  projects: Json;
  languages: Json;
  volunteer_experience: Json;
  job_preferences: Json;
  resume_metadata: Json;
  completeness: number;
  created_at: string;
  updated_at: string;
}

export function useProfiles() {
  const [profiles, setProfiles] = useState<ApplicationProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  const fetchProfiles = useCallback(async () => {
    if (!user) {
      setProfiles([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('application_profiles')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

      if (error) {
        console.error('Error fetching profiles:', error);
        throw error;
      }
      setProfiles(data || []);
    } catch (error) {
      console.error('Error fetching profiles:', error);
      setProfiles([]);
    } finally {
      setLoading(false);
    }
  }, [user?.id]); // Only depend on user.id, not the entire user object

  const getProfile = useCallback(async (id: string) => {
    if (!user) return { error: 'Not authenticated' };

    try {
      const { data, error } = await supabase
        .from('application_profiles')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.id)
        .single();

      if (error) {
        console.error('Error fetching profile:', error);
        throw error;
      }
      return { data, error: null };
    } catch (error) {
      console.error('Error fetching profile:', error);
      return { error, data: null };
    }
  }, [user?.id]);

  const createProfile = useCallback(async (profileData: {
    name: string;
    personal_info?: Json;
    personal_details?: Json;
    experience?: Json;
    education?: Json;
    education_history?: Json;
    work_experience?: Json;
    skills?: string[];
    technical_skills?: Json;
    soft_skills?: Json;
    tools_technologies?: Json;
    certifications?: string[];
    certifications_licenses?: Json;
    awards_honors?: Json;
    projects?: Json;
    languages?: Json;
    volunteer_experience?: Json;
    job_preferences?: Json;
    resume_metadata?: Json;
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
          personal_details: profileData.personal_details || null,
          experience: profileData.experience || null,
          education: profileData.education || null,
          education_history: profileData.education_history || null,
          work_experience: profileData.work_experience || null,
          skills: profileData.skills || [],
          technical_skills: profileData.technical_skills || null,
          soft_skills: profileData.soft_skills || null,
          tools_technologies: profileData.tools_technologies || null,
          certifications: profileData.certifications || [],
          certifications_licenses: profileData.certifications_licenses || null,
          awards_honors: profileData.awards_honors || null,
          projects: profileData.projects || null,
          languages: profileData.languages || null,
          volunteer_experience: profileData.volunteer_experience || null,
          job_preferences: profileData.job_preferences || null,
          resume_metadata: profileData.resume_metadata || null,
          completeness: profileData.completeness || 0
        }])
        .select()
        .single();

      if (error) throw error;
      
      await fetchProfiles(); // This won't cause infinite loop now
      return { data, error: null };
    } catch (error) {
      console.error('Error creating profile:', error);
      return { error };
    }
  }, [user?.id, fetchProfiles]);

  const updateProfile = useCallback(async (id: string, profileData: Partial<{
    name: string;
    personal_info: Json;
    personal_details: Json;
    experience: Json;
    education: Json;
    education_history: Json;
    work_experience: Json;
    skills: string[];
    technical_skills: Json;
    soft_skills: Json;
    tools_technologies: Json;
    certifications: string[];
    certifications_licenses: Json;
    awards_honors: Json;
    projects: Json;
    languages: Json;
    volunteer_experience: Json;
    job_preferences: Json;
    resume_metadata: Json;
    completeness: number;
  }>) => {
    if (!user) return { error: 'Not authenticated' };

    try {
      const { data, error } = await supabase
        .from('application_profiles')
        .update(profileData)
        .eq('id', id)
        .eq('user_id', user.id)
        .select()
        .single();

      if (error) throw error;
      
      await fetchProfiles(); // This won't cause infinite loop now
      return { data, error: null };
    } catch (error) {
      console.error('Error updating profile:', error);
      return { error };
    }
  }, [user?.id, fetchProfiles]);

  const deleteProfile = useCallback(async (id: string) => {
    if (!user) return { error: 'Not authenticated' };

    try {
      const { error } = await supabase
        .from('application_profiles')
        .delete()
        .eq('id', id)
        .eq('user_id', user.id);

      if (error) throw error;
      
      await fetchProfiles(); // This won't cause infinite loop now
      return { error: null };
    } catch (error) {
      console.error('Error deleting profile:', error);
      return { error };
    }
  }, [user?.id, fetchProfiles]);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  return {
    profiles,
    loading,
    getProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    refetch: fetchProfiles
  };
}
