export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      application_profiles: {
        Row: {
          awards_honors: Json | null
          certifications: string[] | null
          certifications_licenses: Json | null
          completeness: number | null
          created_at: string | null
          education: Json | null
          education_history: Json | null
          experience: Json | null
          id: string
          job_preferences: Json | null
          languages: Json | null
          name: string
          personal_details: Json | null
          personal_info: Json | null
          projects: Json | null
          resume_metadata: Json | null
          skills: string[] | null
          soft_skills: Json | null
          technical_skills: Json | null
          tools_technologies: Json | null
          updated_at: string | null
          user_id: string
          volunteer_experience: Json | null
          work_experience: Json | null
        }
        Insert: {
          awards_honors?: Json | null
          certifications?: string[] | null
          certifications_licenses?: Json | null
          completeness?: number | null
          created_at?: string | null
          education?: Json | null
          education_history?: Json | null
          experience?: Json | null
          id?: string
          job_preferences?: Json | null
          languages?: Json | null
          name: string
          personal_details?: Json | null
          personal_info?: Json | null
          projects?: Json | null
          resume_metadata?: Json | null
          skills?: string[] | null
          soft_skills?: Json | null
          technical_skills?: Json | null
          tools_technologies?: Json | null
          updated_at?: string | null
          user_id: string
          volunteer_experience?: Json | null
          work_experience?: Json | null
        }
        Update: {
          awards_honors?: Json | null
          certifications?: string[] | null
          certifications_licenses?: Json | null
          completeness?: number | null
          created_at?: string | null
          education?: Json | null
          education_history?: Json | null
          experience?: Json | null
          id?: string
          job_preferences?: Json | null
          languages?: Json | null
          name?: string
          personal_details?: Json | null
          personal_info?: Json | null
          projects?: Json | null
          resume_metadata?: Json | null
          skills?: string[] | null
          soft_skills?: Json | null
          technical_skills?: Json | null
          tools_technologies?: Json | null
          updated_at?: string | null
          user_id?: string
          volunteer_experience?: Json | null
          work_experience?: Json | null
        }
        Relationships: []
      }
      applications: {
        Row: {
          application_url: string | null
          applied_at: string | null
          company_name: string
          id: string
          notes: string | null
          position_title: string
          profile_id: string | null
          status: string | null
          user_id: string
        }
        Insert: {
          application_url?: string | null
          applied_at?: string | null
          company_name: string
          id?: string
          notes?: string | null
          position_title: string
          profile_id?: string | null
          status?: string | null
          user_id: string
        }
        Update: {
          application_url?: string | null
          applied_at?: string | null
          company_name?: string
          id?: string
          notes?: string | null
          position_title?: string
          profile_id?: string | null
          status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "application_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
