export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      telegram_links: {
        Row: { blocked_at: string | null; center_id: string; chat_id: number; id: string; last_seen_at: string | null; linked_at: string; membership_id: string; revoked_at: string | null; revoked_by: string | null; telegram_user_id: number; username: string | null }
        Insert: { blocked_at?: string | null; center_id: string; chat_id: number; id?: string; last_seen_at?: string | null; linked_at?: string; membership_id: string; revoked_at?: string | null; revoked_by?: string | null; telegram_user_id: number; username?: string | null }
        Update: { blocked_at?: string | null; center_id?: string; chat_id?: number; id?: string; last_seen_at?: string | null; linked_at?: string; membership_id?: string; revoked_at?: string | null; revoked_by?: string | null; telegram_user_id?: number; username?: string | null }
        Relationships: []
      }
      practice_attempts: {
        Row: { center_id: string; created_at: string; earned: number; id: string; item_id: string; score: number | null; skill: Database["public"]["Enums"]["skill"]; student_id: string; total: number }
        Insert: { center_id: string; created_at?: string; earned?: number; id?: string; item_id: string; score?: number | null; skill: Database["public"]["Enums"]["skill"]; student_id: string; total?: number }
        Update: { center_id?: string; created_at?: string; earned?: number; id?: string; item_id?: string; score?: number | null; skill?: Database["public"]["Enums"]["skill"]; student_id?: string; total?: number }
        Relationships: []
      }
      activities: {
        Row: {
          actor_id: string | null
          center_id: string
          detail: string | null
          id: string
          occurred_at: string
          ref_id: string | null
          student_id: string
          title: string
          type: Database["public"]["Enums"]["activity_type"]
        }
        Insert: {
          actor_id?: string | null
          center_id: string
          detail?: string | null
          id?: string
          occurred_at?: string
          ref_id?: string | null
          student_id: string
          title: string
          type: Database["public"]["Enums"]["activity_type"]
        }
        Update: {
          actor_id?: string | null
          center_id?: string
          detail?: string | null
          id?: string
          occurred_at?: string
          ref_id?: string | null
          student_id?: string
          title?: string
          type?: Database["public"]["Enums"]["activity_type"]
        }
        Relationships: [
          {
            foreignKeyName: "activities_actor_id_center_id_fkey"
            columns: ["actor_id", "center_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "activities_student_id_center_id_fkey"
            columns: ["student_id", "center_id"]
            isOneToOne: false
            referencedRelation: "student_overview"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "activities_student_id_center_id_fkey"
            columns: ["student_id", "center_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "center_id"]
          },
        ]
      }
      assignments: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          center_id: string
          content: Json
          created_at: string
          created_by: string
          id: string
          level: Database["public"]["Enums"]["cefr_level"] | null
          library_item_id: string | null
          skill: Database["public"]["Enums"]["skill"]
          source: Database["public"]["Enums"]["assignment_source"]
          status: Database["public"]["Enums"]["assignment_status"]
          sub_skill: string | null
          title: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          center_id: string
          content?: Json
          created_at?: string
          created_by: string
          id?: string
          level?: Database["public"]["Enums"]["cefr_level"] | null
          library_item_id?: string | null
          skill: Database["public"]["Enums"]["skill"]
          source: Database["public"]["Enums"]["assignment_source"]
          status?: Database["public"]["Enums"]["assignment_status"]
          sub_skill?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          center_id?: string
          content?: Json
          created_at?: string
          created_by?: string
          id?: string
          level?: Database["public"]["Enums"]["cefr_level"] | null
          library_item_id?: string | null
          skill?: Database["public"]["Enums"]["skill"]
          source?: Database["public"]["Enums"]["assignment_source"]
          status?: Database["public"]["Enums"]["assignment_status"]
          sub_skill?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_approved_by_center_id_fkey"
            columns: ["approved_by", "center_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "assignments_center_id_fkey"
            columns: ["center_id"]
            isOneToOne: false
            referencedRelation: "centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_created_by_center_id_fkey"
            columns: ["created_by", "center_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "center_id"]
          },
        ]
      }
      audio_jobs: {
        Row: {
          id: string
          center_id: string | null
          created_by: string
          purpose: string
          provider: string
          target_bucket: string
          target_path: string
          idempotency_key: string
          draft_key: string
          script_hash: string
          answers_expected: number
          attached_at: string | null
          dismissed_at: string | null
          status: string
          progress: number
          segments_done: number
          segments_total: number | null
          attempts: number
          max_attempts: number
          lease_until: string | null
          seconds: number | null
          qa: Json | null
          error: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          created_at: string
          started_at: string | null
          finished_at: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          center_id?: string | null
          created_by?: string
          purpose?: string
          provider?: string
          target_bucket?: string
          target_path?: string
          idempotency_key?: string
          status?: string
          progress?: number
          segments_done?: number
          segments_total?: number | null
          attempts?: number
          max_attempts?: number
          lease_until?: string | null
          seconds?: number | null
          qa?: Json | null
          error?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
          started_at?: string | null
          finished_at?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          center_id?: string | null
          created_by?: string
          purpose?: string
          provider?: string
          target_bucket?: string
          target_path?: string
          idempotency_key?: string
          status?: string
          progress?: number
          segments_done?: number
          segments_total?: number | null
          attempts?: number
          max_attempts?: number
          lease_until?: string | null
          seconds?: number | null
          qa?: Json | null
          error?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
          started_at?: string | null
          finished_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ai_requests: {
        Row: {
          center_id: string
          completion_tokens: number | null
          cost_usd: number | null
          created_at: string
          id: number
          kind: string
          model: string | null
          ok: boolean | null
          prompt_tokens: number | null
          user_id: string
        }
        Insert: {
          center_id: string
          completion_tokens?: number | null
          cost_usd?: number | null
          created_at?: string
          id?: number
          kind: string
          model?: string | null
          ok?: boolean | null
          prompt_tokens?: number | null
          user_id: string
        }
        Update: {
          center_id?: string
          completion_tokens?: number | null
          cost_usd?: number | null
          created_at?: string
          id?: number
          kind?: string
          model?: string | null
          ok?: boolean | null
          prompt_tokens?: number | null
          user_id?: string
        }
        Relationships: []
      }
      assignment_keys: {
        Row: {
          answers: Json
          assignment_id: string
          center_id: string
          transcript: string | null
        }
        Insert: {
          answers?: Json
          assignment_id: string
          center_id: string
          transcript?: string | null
        }
        Update: {
          answers?: Json
          assignment_id?: string
          center_id?: string
          transcript?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assignment_keys_assignment_id_center_id_fkey"
            columns: ["assignment_id", "center_id"]
            isOneToOne: true
            referencedRelation: "assignments"
            referencedColumns: ["id", "center_id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          center_id: string
          id: string
          lesson_id: string
          marked_at: string
          marked_by: string | null
          note: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          student_id: string
        }
        Insert: {
          center_id: string
          id?: string
          lesson_id: string
          marked_at?: string
          marked_by?: string | null
          note?: string | null
          status: Database["public"]["Enums"]["attendance_status"]
          student_id: string
        }
        Update: {
          center_id?: string
          id?: string
          lesson_id?: string
          marked_at?: string
          marked_by?: string | null
          note?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_lesson_id_center_id_fkey"
            columns: ["lesson_id", "center_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "attendance_records_marked_by_center_id_fkey"
            columns: ["marked_by", "center_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "attendance_records_student_id_center_id_fkey"
            columns: ["student_id", "center_id"]
            isOneToOne: false
            referencedRelation: "student_overview"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "attendance_records_student_id_center_id_fkey"
            columns: ["student_id", "center_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "center_id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          at: string
          center_id: string | null
          id: number
          new_data: Json | null
          old_data: Json | null
          row_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          at?: string
          center_id?: string | null
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          row_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          at?: string
          center_id?: string | null
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          row_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      branches: {
        Row: {
          address: string | null
          center_id: string
          created_at: string
          id: string
          name: string
          phone: string | null
          status: Database["public"]["Enums"]["record_status"]
        }
        Insert: {
          address?: string | null
          center_id: string
          created_at?: string
          id?: string
          name: string
          phone?: string | null
          status?: Database["public"]["Enums"]["record_status"]
        }
        Update: {
          address?: string | null
          center_id?: string
          created_at?: string
          id?: string
          name?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["record_status"]
        }
        Relationships: [
          {
            foreignKeyName: "branches_center_id_fkey"
            columns: ["center_id"]
            isOneToOne: false
            referencedRelation: "centers"
            referencedColumns: ["id"]
          },
        ]
      }
      centers: {
        Row: {
          created_at: string
          currency: string
          id: string
          name: string
          receipt_seq: number
          slug: string
          timezone: string
          phone: string | null
          address: string | null
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          name: string
          receipt_seq?: number
          slug: string
          timezone?: string
          phone?: string | null
          address?: string | null
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          name?: string
          receipt_seq?: number
          slug?: string
          timezone?: string
          phone?: string | null
          address?: string | null
        }
        Relationships: []
      }
      courses: {
        Row: {
          center_id: string
          code: string
          created_at: string
          default_monthly_fee: number
          description: string | null
          duration_weeks: number | null
          id: string
          level: Database["public"]["Enums"]["cefr_level"] | null
          name: string
          status: Database["public"]["Enums"]["record_status"]
        }
        Insert: {
          center_id: string
          code: string
          created_at?: string
          default_monthly_fee?: number
          description?: string | null
          duration_weeks?: number | null
          id?: string
          level?: Database["public"]["Enums"]["cefr_level"] | null
          name: string
          status?: Database["public"]["Enums"]["record_status"]
        }
        Update: {
          center_id?: string
          code?: string
          created_at?: string
          default_monthly_fee?: number
          description?: string | null
          duration_weeks?: number | null
          id?: string
          level?: Database["public"]["Enums"]["cefr_level"] | null
          name?: string
          status?: Database["public"]["Enums"]["record_status"]
        }
        Relationships: [
          {
            foreignKeyName: "courses_center_id_fkey"
            columns: ["center_id"]
            isOneToOne: false
            referencedRelation: "centers"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollments: {
        Row: {
          center_id: string
          created_at: string
          discount_percent: number
          due_day: number
          end_date: string | null
          group_id: string
          id: string
          monthly_fee: number
          start_date: string
          status: Database["public"]["Enums"]["enrollment_status"]
          student_id: string
        }
        Insert: {
          center_id: string
          created_at?: string
          discount_percent?: number
          due_day?: number
          end_date?: string | null
          group_id: string
          id?: string
          monthly_fee: number
          start_date?: string
          status?: Database["public"]["Enums"]["enrollment_status"]
          student_id: string
        }
        Update: {
          center_id?: string
          created_at?: string
          discount_percent?: number
          due_day?: number
          end_date?: string | null
          group_id?: string
          id?: string
          monthly_fee?: number
          start_date?: string
          status?: Database["public"]["Enums"]["enrollment_status"]
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_group_id_center_id_fkey"
            columns: ["group_id", "center_id"]
            isOneToOne: false
            referencedRelation: "group_overview"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "enrollments_group_id_center_id_fkey"
            columns: ["group_id", "center_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "enrollments_student_id_center_id_fkey"
            columns: ["student_id", "center_id"]
            isOneToOne: false
            referencedRelation: "student_overview"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "enrollments_student_id_center_id_fkey"
            columns: ["student_id", "center_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "center_id"]
          },
        ]
      }
      group_schedule_slots: {
        Row: {
          center_id: string
          end_time: string
          group_id: string
          id: string
          room_id: string | null
          start_time: string
          weekday: number
        }
        Insert: {
          center_id: string
          end_time: string
          group_id: string
          id?: string
          room_id?: string | null
          start_time: string
          weekday: number
        }
        Update: {
          center_id?: string
          end_time?: string
          group_id?: string
          id?: string
          room_id?: string | null
          start_time?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "group_schedule_slots_group_id_center_id_fkey"
            columns: ["group_id", "center_id"]
            isOneToOne: false
            referencedRelation: "group_overview"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "group_schedule_slots_group_id_center_id_fkey"
            columns: ["group_id", "center_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "group_schedule_slots_room_id_center_id_fkey"
            columns: ["room_id", "center_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id", "center_id"]
          },
        ]
      }
      groups: {
        Row: {
          branch_id: string
          capacity: number | null
          center_id: string
          course_id: string
          created_at: string
          end_date: string | null
          id: string
          mentor_id: string | null
          name: string
          room_id: string | null
          short_name: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["record_status"]
          updated_at: string
        }
        Insert: {
          branch_id: string
          capacity?: number | null
          center_id: string
          course_id: string
          created_at?: string
          end_date?: string | null
          id?: string
          mentor_id?: string | null
          name: string
          room_id?: string | null
          short_name?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Update: {
          branch_id?: string
          capacity?: number | null
          center_id?: string
          course_id?: string
          created_at?: string
          end_date?: string | null
          id?: string
          mentor_id?: string | null
          name?: string
          room_id?: string | null
          short_name?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_branch_id_center_id_fkey"
            columns: ["branch_id", "center_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "groups_center_id_fkey"
            columns: ["center_id"]
            isOneToOne: false
            referencedRelation: "centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groups_course_id_center_id_fkey"
            columns: ["course_id", "center_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "groups_mentor_id_center_id_fkey"
            columns: ["mentor_id", "center_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "groups_room_id_center_id_fkey"
            columns: ["room_id", "center_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id", "center_id"]
          },
        ]
      }
      guardians: {
        Row: {
          center_id: string
          created_at: string
          full_name: string
          id: string
          is_primary: boolean
          membership_id: string | null
          phone: string | null
          relationship: string | null
          student_id: string
        }
        Insert: {
          center_id: string
          created_at?: string
          full_name: string
          id?: string
          is_primary?: boolean
          membership_id?: string | null
          phone?: string | null
          relationship?: string | null
          student_id: string
        }
        Update: {
          center_id?: string
          created_at?: string
          full_name?: string
          id?: string
          is_primary?: boolean
          membership_id?: string | null
          phone?: string | null
          relationship?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guardians_membership_id_center_id_fkey"
            columns: ["membership_id", "center_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "guardians_student_id_center_id_fkey"
            columns: ["student_id", "center_id"]
            isOneToOne: false
            referencedRelation: "student_overview"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "guardians_student_id_center_id_fkey"
            columns: ["student_id", "center_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "center_id"]
          },
        ]
      }
      homework: {
        Row: {
          assigned_at: string
          assigned_by: string
          assignment_id: string
          center_id: string
          due_at: string
          group_id: string
          id: string
          note: string | null
        }
        Insert: {
          assigned_at?: string
          assigned_by: string
          assignment_id: string
          center_id: string
          due_at: string
          group_id: string
          id?: string
          note?: string | null
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          assignment_id?: string
          center_id?: string
          due_at?: string
          group_id?: string
          id?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "homework_assigned_by_center_id_fkey"
            columns: ["assigned_by", "center_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "homework_assignment_id_center_id_fkey"
            columns: ["assignment_id", "center_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "homework_group_id_center_id_fkey"
            columns: ["group_id", "center_id"]
            isOneToOne: false
            referencedRelation: "group_overview"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "homework_group_id_center_id_fkey"
            columns: ["group_id", "center_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id", "center_id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          center_id: string
          created_at: string
          due_date: string
          enrollment_id: string
          id: string
          last_reminded_at: string | null
          period: string
          status: Database["public"]["Enums"]["invoice_status"]
          student_id: string
        }
        Insert: {
          amount: number
          center_id: string
          created_at?: string
          due_date: string
          enrollment_id: string
          id?: string
          last_reminded_at?: string | null
          period: string
          status?: Database["public"]["Enums"]["invoice_status"]
          student_id: string
        }
        Update: {
          amount?: number
          center_id?: string
          created_at?: string
          due_date?: string
          enrollment_id?: string
          id?: string
          last_reminded_at?: string | null
          period?: string
          status?: Database["public"]["Enums"]["invoice_status"]
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_enrollment_id_center_id_fkey"
            columns: ["enrollment_id", "center_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "invoices_student_id_center_id_fkey"
            columns: ["student_id", "center_id"]
            isOneToOne: false
            referencedRelation: "student_overview"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "invoices_student_id_center_id_fkey"
            columns: ["student_id", "center_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "center_id"]
          },
        ]
      }
      lessons: {
        Row: {
          center_id: string
          created_at: string
          ends_at: string
          group_id: string
          id: string
          mentor_id: string | null
          room_id: string | null
          starts_at: string
          status: Database["public"]["Enums"]["lesson_status"]
          topic: string | null
        }
        Insert: {
          center_id: string
          created_at?: string
          ends_at: string
          group_id: string
          id?: string
          mentor_id?: string | null
          room_id?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["lesson_status"]
          topic?: string | null
        }
        Update: {
          center_id?: string
          created_at?: string
          ends_at?: string
          group_id?: string
          id?: string
          mentor_id?: string | null
          room_id?: string | null
          starts_at?: string
          status?: Database["public"]["Enums"]["lesson_status"]
          topic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lessons_group_id_center_id_fkey"
            columns: ["group_id", "center_id"]
            isOneToOne: false
            referencedRelation: "group_overview"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "lessons_group_id_center_id_fkey"
            columns: ["group_id", "center_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "lessons_mentor_id_center_id_fkey"
            columns: ["mentor_id", "center_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "lessons_room_id_center_id_fkey"
            columns: ["room_id", "center_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id", "center_id"]
          },
        ]
      }
      library_answer_keys: {
        Row: {
          answers: Json
          item_id: string
        }
        Insert: {
          answers?: Json
          item_id: string
        }
        Update: {
          answers?: Json
          item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_answer_keys_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "library_items"
            referencedColumns: ["id"]
          },
        ]
      }
      library_test_keys: {
        Row: { answers: Json; test_id: string; transcripts: Json }
        Insert: { answers?: Json; test_id: string; transcripts?: Json }
        Update: { answers?: Json; test_id?: string; transcripts?: Json }
        Relationships: [
          {
            foreignKeyName: "library_test_keys_test_id_fkey"
            columns: ["test_id"]
            isOneToOne: true
            referencedRelation: "library_tests"
            referencedColumns: ["id"]
          },
        ]
      }
      library_tests: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          level: Database["public"]["Enums"]["cefr_level"] | null
          published_at: string | null
          question_count: number
          sections: Json
          skill: Database["public"]["Enums"]["skill"]
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          level?: Database["public"]["Enums"]["cefr_level"] | null
          published_at?: string | null
          question_count?: number
          sections?: Json
          skill: Database["public"]["Enums"]["skill"]
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          level?: Database["public"]["Enums"]["cefr_level"] | null
          published_at?: string | null
          question_count?: number
          sections?: Json
          skill?: Database["public"]["Enums"]["skill"]
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      library_items: {
        Row: {
          attribution: string | null
          audio_path: string | null
          audio_url: string | null
          created_by: string | null
          updated_at: string | null
          author: string | null
          body_format: string
          body_html: string | null
          created_at: string
          description: string | null
          discussion: Json
          duration_seconds: number | null
          id: string
          kind: string
          level_max: Database["public"]["Enums"]["cefr_level"] | null
          level_min: Database["public"]["Enums"]["cefr_level"] | null
          licence: string | null
          minutes: number | null
          questions: Json
          skill: Database["public"]["Enums"]["skill"]
          source_name: string | null
          source_url: string | null
          status: string
          summary: string | null
          title: string
          topics: string[]
          transcript: Json | null
          vocabulary: Json
        }
        Insert: {
          attribution?: string | null
          audio_path?: string | null
          audio_url?: string | null
          created_by?: string | null
          updated_at?: string | null
          author?: string | null
          body_format?: string
          body_html?: string | null
          created_at?: string
          description?: string | null
          discussion?: Json
          duration_seconds?: number | null
          id: string
          kind: string
          level_max?: Database["public"]["Enums"]["cefr_level"] | null
          level_min?: Database["public"]["Enums"]["cefr_level"] | null
          licence?: string | null
          minutes?: number | null
          questions?: Json
          skill: Database["public"]["Enums"]["skill"]
          source_name?: string | null
          source_url?: string | null
          status?: string
          summary?: string | null
          title: string
          topics?: string[]
          transcript?: Json | null
          vocabulary?: Json
        }
        Update: {
          attribution?: string | null
          audio_path?: string | null
          audio_url?: string | null
          created_by?: string | null
          updated_at?: string | null
          author?: string | null
          body_format?: string
          body_html?: string | null
          created_at?: string
          description?: string | null
          discussion?: Json
          duration_seconds?: number | null
          id?: string
          kind?: string
          level_max?: Database["public"]["Enums"]["cefr_level"] | null
          level_min?: Database["public"]["Enums"]["cefr_level"] | null
          licence?: string | null
          minutes?: number | null
          questions?: Json
          skill?: Database["public"]["Enums"]["skill"]
          source_name?: string | null
          source_url?: string | null
          status?: string
          summary?: string | null
          title?: string
          topics?: string[]
          transcript?: Json | null
          vocabulary?: Json
        }
        Relationships: []
      }
      memberships: {
        Row: {
          branch_id: string | null
          center_id: string
          created_at: string
          email: string | null
          full_name: string
          id: string
          invite_code: string | null
          invite_expires_at: string | null
          invited_by: string | null
          phone: string | null
          role: Database["public"]["Enums"]["member_role"]
          status: Database["public"]["Enums"]["member_status"]
          user_id: string | null
        }
        Insert: {
          branch_id?: string | null
          center_id: string
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          invite_code?: string | null
          invite_expires_at?: string | null
          invited_by?: string | null
          phone?: string | null
          role: Database["public"]["Enums"]["member_role"]
          status?: Database["public"]["Enums"]["member_status"]
          user_id?: string | null
        }
        Update: {
          branch_id?: string | null
          center_id?: string
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          invite_code?: string | null
          invite_expires_at?: string | null
          invited_by?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          status?: Database["public"]["Enums"]["member_status"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "memberships_branch_id_center_id_fkey"
            columns: ["branch_id", "center_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "memberships_center_id_fkey"
            columns: ["center_id"]
            isOneToOne: false
            referencedRelation: "centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      mock_attempts: {
        Row: {
          answers: Json
          band: number | null
          center_id: string
          deadline_at: string
          disqualified_at: string | null
          disqualify_reason: string | null
          focus_lost: number
          id: string
          marks: Json | null
          mock_session_id: string
          raw_score: number | null
          skill: Database["public"]["Enums"]["skill"]
          started_at: string
          student_id: string
          submitted_at: string | null
          test_id: string
          total: number | null
        }
        Insert: { center_id: string; deadline_at: string; mock_session_id: string; skill: Database["public"]["Enums"]["skill"]; student_id: string; test_id: string }
        Update: { answers?: Json }
        Relationships: [
          {
            foreignKeyName: "mock_attempts_student_id_center_id_fkey"
            columns: ["student_id", "center_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "center_id"]
          },
        ]
      }
      mock_results: {
        Row: {
          listening_raw: number | null
          reading_raw: number | null
          released_at: string | null
          center_id: string
          id: string
          listening_band: number | null
          mock_session_id: string
          notes: string | null
          reading_band: number | null
          speaking_band: number | null
          status: Database["public"]["Enums"]["mock_result_status"]
          student_id: string
          updated_at: string
          weaknesses: string[]
          writing_band: number | null
        }
        Insert: {
          listening_raw?: number | null
          reading_raw?: number | null
          released_at?: string | null
          center_id: string
          id?: string
          listening_band?: number | null
          mock_session_id: string
          notes?: string | null
          reading_band?: number | null
          speaking_band?: number | null
          status?: Database["public"]["Enums"]["mock_result_status"]
          student_id: string
          updated_at?: string
          weaknesses?: string[]
          writing_band?: number | null
        }
        Update: {
          listening_raw?: number | null
          reading_raw?: number | null
          released_at?: string | null
          center_id?: string
          id?: string
          listening_band?: number | null
          mock_session_id?: string
          notes?: string | null
          reading_band?: number | null
          speaking_band?: number | null
          status?: Database["public"]["Enums"]["mock_result_status"]
          student_id?: string
          updated_at?: string
          weaknesses?: string[]
          writing_band?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mock_results_mock_session_id_center_id_fkey"
            columns: ["mock_session_id", "center_id"]
            isOneToOne: false
            referencedRelation: "mock_sessions"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "mock_results_student_id_center_id_fkey"
            columns: ["student_id", "center_id"]
            isOneToOne: false
            referencedRelation: "student_overview"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "mock_results_student_id_center_id_fkey"
            columns: ["student_id", "center_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "center_id"]
          },
        ]
      }
      mock_sessions: {
        Row: {
          listening_test_id: string | null
          reading_test_id: string | null
          center_id: string
          created_at: string
          examiner_id: string | null
          group_id: string | null
          id: string
          modules: Database["public"]["Enums"]["skill"][]
          name: string
          room_id: string | null
          scheduled_at: string
          status: Database["public"]["Enums"]["mock_status"]
          version: string | null
        }
        Insert: {
          listening_test_id?: string | null
          reading_test_id?: string | null
          center_id: string
          created_at?: string
          examiner_id?: string | null
          group_id?: string | null
          id?: string
          modules?: Database["public"]["Enums"]["skill"][]
          name: string
          room_id?: string | null
          scheduled_at: string
          status?: Database["public"]["Enums"]["mock_status"]
          version?: string | null
        }
        Update: {
          listening_test_id?: string | null
          reading_test_id?: string | null
          center_id?: string
          created_at?: string
          examiner_id?: string | null
          group_id?: string | null
          id?: string
          modules?: Database["public"]["Enums"]["skill"][]
          name?: string
          room_id?: string | null
          scheduled_at?: string
          status?: Database["public"]["Enums"]["mock_status"]
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mock_sessions_center_id_fkey"
            columns: ["center_id"]
            isOneToOne: false
            referencedRelation: "centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mock_sessions_examiner_id_center_id_fkey"
            columns: ["examiner_id", "center_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "mock_sessions_group_id_center_id_fkey"
            columns: ["group_id", "center_id"]
            isOneToOne: false
            referencedRelation: "group_overview"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "mock_sessions_group_id_center_id_fkey"
            columns: ["group_id", "center_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "mock_sessions_room_id_center_id_fkey"
            columns: ["room_id", "center_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id", "center_id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          center_id: string
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          data: Json
          id: string
          read_at: string | null
          recipient_id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["notification_status"]
          title: string
        }
        Insert: {
          body?: string | null
          center_id: string
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          data?: Json
          id?: string
          read_at?: string | null
          recipient_id: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          title: string
        }
        Update: {
          body?: string | null
          center_id?: string
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          data?: Json
          id?: string
          read_at?: string | null
          recipient_id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["notification_status"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_center_id_fkey"
            columns: ["recipient_id", "center_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "center_id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          center_id: string
          created_at: string
          id: string
          invoice_id: string | null
          kind: Database["public"]["Enums"]["payment_kind"]
          method: Database["public"]["Enums"]["payment_method"]
          note: string | null
          paid_at: string
          provider_txn_id: string | null
          receipt_no: string
          received_by: string | null
          refund_of: string | null
          student_id: string
        }
        Insert: {
          amount: number
          center_id: string
          created_at?: string
          id?: string
          invoice_id?: string | null
          kind?: Database["public"]["Enums"]["payment_kind"]
          method: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          paid_at?: string
          provider_txn_id?: string | null
          receipt_no: string
          received_by?: string | null
          refund_of?: string | null
          student_id: string
        }
        Update: {
          amount?: number
          center_id?: string
          created_at?: string
          id?: string
          invoice_id?: string | null
          kind?: Database["public"]["Enums"]["payment_kind"]
          method?: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          paid_at?: string
          provider_txn_id?: string | null
          receipt_no?: string
          received_by?: string | null
          refund_of?: string | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_invoice_id_center_id_fkey"
            columns: ["invoice_id", "center_id"]
            isOneToOne: false
            referencedRelation: "invoice_balances"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "payments_invoice_id_center_id_fkey"
            columns: ["invoice_id", "center_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "payments_received_by_center_id_fkey"
            columns: ["received_by", "center_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "payments_refund_of_fkey"
            columns: ["refund_of"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_student_id_center_id_fkey"
            columns: ["student_id", "center_id"]
            isOneToOne: false
            referencedRelation: "student_overview"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "payments_student_id_center_id_fkey"
            columns: ["student_id", "center_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "center_id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          locale: string | null
          phone: string | null
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          locale?: string | null
          phone?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          locale?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      rooms: {
        Row: {
          branch_id: string
          capacity: number | null
          center_id: string
          id: string
          name: string
        }
        Insert: {
          branch_id: string
          capacity?: number | null
          center_id: string
          id?: string
          name: string
        }
        Update: {
          branch_id?: string
          capacity?: number | null
          center_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "rooms_branch_id_center_id_fkey"
            columns: ["branch_id", "center_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "rooms_center_id_fkey"
            columns: ["center_id"]
            isOneToOne: false
            referencedRelation: "centers"
            referencedColumns: ["id"]
          },
        ]
      }
      students: {
        Row: {
          branch_id: string | null
          center_id: string
          created_at: string
          date_of_birth: string | null
          email: string | null
          full_name: string
          id: string
          joined_on: string
          membership_id: string | null
          notes: string | null
          phone: string | null
          status: Database["public"]["Enums"]["student_status"]
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          center_id: string
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          full_name: string
          id?: string
          joined_on?: string
          membership_id?: string | null
          notes?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["student_status"]
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          center_id?: string
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          full_name?: string
          id?: string
          joined_on?: string
          membership_id?: string | null
          notes?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["student_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "students_branch_id_center_id_fkey"
            columns: ["branch_id", "center_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "students_center_id_fkey"
            columns: ["center_id"]
            isOneToOne: false
            referencedRelation: "centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "students_membership_id_center_id_fkey"
            columns: ["membership_id", "center_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "center_id"]
          },
        ]
      }
      submissions: {
        Row: {
          answers: Json
          center_id: string
          feedback: string | null
          homework_id: string
          id: string
          reviewed_at: string | null
          reviewed_by: string | null
          score: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["submission_status"]
          student_id: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          answers?: Json
          center_id: string
          feedback?: string | null
          homework_id: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["submission_status"]
          student_id: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          answers?: Json
          center_id?: string
          feedback?: string | null
          homework_id?: string
          id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          score?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["submission_status"]
          student_id?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "submissions_homework_id_center_id_fkey"
            columns: ["homework_id", "center_id"]
            isOneToOne: false
            referencedRelation: "homework"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "submissions_reviewed_by_center_id_fkey"
            columns: ["reviewed_by", "center_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "submissions_student_id_center_id_fkey"
            columns: ["student_id", "center_id"]
            isOneToOne: false
            referencedRelation: "student_overview"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "submissions_student_id_center_id_fkey"
            columns: ["student_id", "center_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "center_id"]
          },
        ]
      }
    }
    Views: {
      group_overview: {
        Row: {
          branch_id: string | null
          capacity: number | null
          center_id: string | null
          course_id: string | null
          id: string | null
          mentor_id: string | null
          name: string | null
          next_lesson_at: string | null
          room_id: string | null
          short_name: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["record_status"] | null
          student_count: number | null
        }
        Insert: {
          branch_id?: string | null
          capacity?: number | null
          center_id?: string | null
          course_id?: string | null
          id?: string | null
          mentor_id?: string | null
          name?: string | null
          next_lesson_at?: never
          room_id?: string | null
          short_name?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["record_status"] | null
          student_count?: never
        }
        Update: {
          branch_id?: string | null
          capacity?: number | null
          center_id?: string | null
          course_id?: string | null
          id?: string | null
          mentor_id?: string | null
          name?: string | null
          next_lesson_at?: never
          room_id?: string | null
          short_name?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["record_status"] | null
          student_count?: never
        }
        Relationships: [
          {
            foreignKeyName: "groups_branch_id_center_id_fkey"
            columns: ["branch_id", "center_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "groups_center_id_fkey"
            columns: ["center_id"]
            isOneToOne: false
            referencedRelation: "centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "groups_course_id_center_id_fkey"
            columns: ["course_id", "center_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "groups_mentor_id_center_id_fkey"
            columns: ["mentor_id", "center_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "groups_room_id_center_id_fkey"
            columns: ["room_id", "center_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id", "center_id"]
          },
        ]
      }
      invoice_balances: {
        Row: {
          amount: number | null
          balance: number | null
          center_id: string | null
          due_date: string | null
          enrollment_id: string | null
          id: string | null
          paid: number | null
          payment_status: string | null
          period: string | null
          student_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_enrollment_id_center_id_fkey"
            columns: ["enrollment_id", "center_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "invoices_student_id_center_id_fkey"
            columns: ["student_id", "center_id"]
            isOneToOne: false
            referencedRelation: "student_overview"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "invoices_student_id_center_id_fkey"
            columns: ["student_id", "center_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "center_id"]
          },
        ]
      }
      mock_result_scores: {
        Row: {
          listening_raw: number | null
          reading_raw: number | null
          released_at: string | null
          center_id: string | null
          id: string | null
          listening_band: number | null
          mock_session_id: string | null
          notes: string | null
          overall_band: number | null
          reading_band: number | null
          speaking_band: number | null
          status: Database["public"]["Enums"]["mock_result_status"] | null
          student_id: string | null
          updated_at: string | null
          weaknesses: string[] | null
          writing_band: number | null
        }
        Insert: {
          center_id?: string | null
          id?: string | null
          listening_band?: number | null
          mock_session_id?: string | null
          notes?: string | null
          overall_band?: never
          reading_band?: number | null
          speaking_band?: number | null
          status?: Database["public"]["Enums"]["mock_result_status"] | null
          student_id?: string | null
          updated_at?: string | null
          weaknesses?: string[] | null
          writing_band?: number | null
        }
        Update: {
          center_id?: string | null
          id?: string | null
          listening_band?: number | null
          mock_session_id?: string | null
          notes?: string | null
          overall_band?: never
          reading_band?: number | null
          speaking_band?: number | null
          status?: Database["public"]["Enums"]["mock_result_status"] | null
          student_id?: string | null
          updated_at?: string | null
          weaknesses?: string[] | null
          writing_band?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mock_results_mock_session_id_center_id_fkey"
            columns: ["mock_session_id", "center_id"]
            isOneToOne: false
            referencedRelation: "mock_sessions"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "mock_results_student_id_center_id_fkey"
            columns: ["student_id", "center_id"]
            isOneToOne: false
            referencedRelation: "student_overview"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "mock_results_student_id_center_id_fkey"
            columns: ["student_id", "center_id"]
            isOneToOne: false
            referencedRelation: "students"
            referencedColumns: ["id", "center_id"]
          },
        ]
      }
      student_overview: {
        Row: {
          attendance_pct: number | null
          attended: number | null
          branch_id: string | null
          center_id: string | null
          full_name: string | null
          hw_assigned: number | null
          hw_completed: number | null
          id: string | null
          joined_on: string | null
          last_activity_at: string | null
          last_overall_band: number | null
          open_balance: number | null
          overdue_count: number | null
          phone: string | null
          status: Database["public"]["Enums"]["student_status"] | null
          total_marked: number | null
        }
        Relationships: [
          {
            foreignKeyName: "students_branch_id_center_id_fkey"
            columns: ["branch_id", "center_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id", "center_id"]
          },
          {
            foreignKeyName: "students_center_id_fkey"
            columns: ["center_id"]
            isOneToOne: false
            referencedRelation: "centers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_invite: { Args: { p_code: string }; Returns: string }
      telegram_queue_health: { Args: { p_center: string }; Returns: Json }
      issue_telegram_link: { Args: { p_guardian: string }; Returns: { token: string; expires_at: string; membership_id: string }[] }
      attach_guardian_to_parent: { Args: { p_guardian: string; p_parent: string }; Returns: undefined }
      revoke_telegram_link: { Args: { p_membership: string }; Returns: number }
      approve_assignment: { Args: { p_assignment: string }; Returns: undefined }
      assign_homework: {
        Args: { p_assignment: string; p_due_at: string; p_group: string }
        Returns: string
      }
      create_center: {
        Args: { p_name: string; p_owner_name: string; p_slug: string }
        Returns: string
      }
      create_group: {
        Args: {
          p_branch: string
          p_capacity?: number
          p_center: string
          p_course: string
          p_end_time?: string
          p_mentor?: string
          p_name: string
          p_room_name?: string
          p_start_date?: string
          p_start_time?: string
          p_weekdays?: number[]
        }
        Returns: string
      }
      create_student: {
        Args: {
          p_branch?: string
          p_center: string
          p_date_of_birth?: string
          p_discount_percent?: number
          p_due_day?: number
          p_email?: string
          p_full_name: string
          p_group?: string
          p_monthly_fee?: number
          p_parent_name?: string
          p_parent_phone?: string
          p_parent_relationship?: string
          p_phone?: string
        }
        Returns: string
      }
      enroll_student: {
        Args: {
          p_discount_percent?: number
          p_due_day?: number
          p_group: string
          p_monthly_fee?: number
          p_start_date?: string
          p_student: string
        }
        Returns: string
      }
      generate_invoices: {
        Args: { p_center: string; p_period: string }
        Returns: number
      }
      assign_library_item: {
        Args: { p_center: string; p_due_at: string; p_group: string; p_instructions?: string; p_item: string }
        Returns: string
      }
      my_homework_result: { Args: { p_homework: string }; Returns: Json }
      submission_marks: { Args: { p_submission: string }; Returns: Json }
      set_mock_tests: { Args: { p_listening?: string | null; p_reading?: string | null; p_session: string }; Returns: undefined }
      close_expired_attempts: { Args: { p_session: string }; Returns: number }
      release_mock_results: { Args: { p_session: string; p_students?: string[] }; Returns: number }
      my_online_mocks: { Args: never; Returns: Json }
      start_mock_module: { Args: { p_session: string; p_skill: Database["public"]["Enums"]["skill"] }; Returns: Json }
      save_mock_answers: { Args: { p_answers: Json; p_attempt: string }; Returns: undefined }
      submit_mock_module: { Args: { p_answers?: Json; p_attempt: string }; Returns: undefined }
      report_mock_focus: { Args: { p_attempt: string }; Returns: undefined }
      leave_mock_module: { Args: { p_attempt: string; p_reason: string }; Returns: undefined }
      mark_my_notifications_read: { Args: { p_center: string }; Returns: undefined }
      am_platform_admin: { Args: never; Returns: boolean }
      claim_admin_ai_request: { Args: { p_kind: string }; Returns: number }
      new_library_test: {
        Args: { p_level?: Database["public"]["Enums"]["cefr_level"]; p_skill: Database["public"]["Enums"]["skill"]; p_title: string }
        Returns: string
      }
      save_library_test: {
        Args: {
          p_answers: Json
          p_id: string
          p_level: Database["public"]["Enums"]["cefr_level"] | null
          p_sections: Json
          p_skill: Database["public"]["Enums"]["skill"]
          p_title: string
          p_transcripts?: Json
        }
        Returns: string
      }
      set_library_test_status: { Args: { p_id: string; p_status: string }; Returns: undefined }
      delete_library_test: { Args: { p_id: string }; Returns: undefined }
      claim_ai_request: { Args: { p_center: string; p_kind: string }; Returns: number }
      finish_ai_request: {
        Args: { p_completion: number; p_cost: number; p_id: number; p_model: string; p_ok: boolean; p_prompt: number }
        Returns: undefined
      }
      create_custom_assignment: {
        Args: {
          p_answers: Json
          p_audio_path?: string
          p_audio_url?: string
          p_groups?: Json
          p_center: string
          p_level: Database["public"]["Enums"]["cefr_level"]
          p_passage: string
          p_questions: Json
          p_skill: Database["public"]["Enums"]["skill"]
          p_source: Database["public"]["Enums"]["assignment_source"]
          p_title: string
        }
        Returns: string
      }
      assign_assignment: {
        Args: { p_assignment: string; p_due_at: string; p_group: string; p_note?: string }
        Returns: string
      }
      create_mock_session: {
        Args: {
          p_center: string
          p_examiner?: string
          p_group: string
          p_modules?: Database["public"]["Enums"]["skill"][]
          p_name: string
          p_room?: string
          p_scheduled_at: string
          p_version?: string
        }
        Returns: string
      }
      save_mock_results: {
        Args: { p_records: Json; p_session: string }
        Returns: number
      }
      group_mentor_name: { Args: { p_group: string }; Returns: string }
      generate_lessons: {
        Args: { p_from: string; p_group: string; p_to: string }
        Returns: number
      }
      invite_member: {
        Args: {
          p_branch?: string
          p_center: string
          p_email?: string
          p_full_name: string
          p_guardian?: string
          p_phone?: string
          p_role: Database["public"]["Enums"]["member_role"]
          p_student?: string
        }
        Returns: {
          invite_code: string
          membership_id: string
        }[]
      }
      invite_preview: {
        Args: { p_code: string }
        Returns: {
          center_name: string
          email: string
          full_name: string
          role: Database["public"]["Enums"]["member_role"]
        }[]
      }
      mark_attendance: {
        Args: { p_lesson: string; p_records: Json }
        Returns: number
      }
      reissue_invite: { Args: { p_membership: string }; Returns: string }
      practice_library_item: { Args: { p_item: string; p_answers: Json }; Returns: Json }
      my_practice_blocked: { Args: Record<string, never>; Returns: string[] }
      center_report: { Args: { p_center: string; p_from: string; p_to: string }; Returns: Json }
      remind_payment: { Args: { p_invoice: string }; Returns: number }
      enqueue_audio_job: {
        Args: {
          p_center: string | null; p_purpose: string; p_provider: string; p_bucket: string; p_path: string; p_idempotency_key: string; p_token_hash: string
          p_draft_key: string; p_script_hash: string; p_answers_expected?: number
        }
        Returns: Json
      }
      audio_job_update: {
        Args: {
          p_job: string; p_token_hash: string; p_attempt: number; p_status: string; p_progress: number
          p_segments_done?: number | null; p_segments_total?: number | null; p_seconds?: number | null; p_qa?: Json | null; p_error?: string | null
        }
        Returns: Json
      }
      review_audio_job: { Args: { p_job: string; p_approve: boolean }; Returns: string }
      retry_audio_job: { Args: { p_job: string; p_token_hash: string; p_path: string }; Returns: number }
      attach_audio_job: { Args: { p_job: string }; Returns: string }
      dismiss_audio_job: { Args: { p_job: string }; Returns: undefined }
      claim_audio_segment: {
        Args: { p_center: string | null; p_hash: string; p_provider: string; p_model: string; p_voice: string; p_text_bytes: number }
        Returns: Json
      }
      finish_audio_segment: { Args: { p_center: string | null; p_hash: string; p_audio_bytes: number }; Returns: string }
      release_audio_segment: { Args: { p_center: string | null; p_hash: string }; Returns: undefined }
      save_library_podcast: {
        Args: {
          p_answers: Json
          p_audio_path: string | null
          p_audio_url: string | null
          p_description: string
          p_id: string | null
          p_level_max: Database["public"]["Enums"]["cefr_level"]
          p_level_min: Database["public"]["Enums"]["cefr_level"]
          p_questions: Json
          p_seconds: number
          p_title: string
          p_topics: string[]
          p_transcript: Json
          p_vocabulary: Json
        }
        Returns: string
      }
      set_library_podcast_status: { Args: { p_id: string; p_status: string }; Returns: undefined }
      delete_library_podcast: { Args: { p_id: string }; Returns: undefined }
      record_payment: {
        Args: {
          p_amount: number
          p_invoice: string
          p_method: Database["public"]["Enums"]["payment_method"]
          p_note?: string
          p_paid_at?: string
          p_provider_txn_id?: string
        }
        Returns: {
          payment_id: string
          receipt_no: string
        }[]
      }
      refund_payment: {
        Args: { p_amount: number; p_payment: string; p_reason: string }
        Returns: {
          payment_id: string
          receipt_no: string
        }[]
      }
      review_submission: {
        Args: { p_feedback: string; p_score: number; p_submission: string }
        Returns: undefined
      }
      save_submission: {
        Args: { p_answers: Json; p_homework: string; p_submit?: boolean }
        Returns: Database["public"]["Enums"]["submission_status"]
      }
      set_member_status: {
        Args: {
          p_membership: string
          p_status: Database["public"]["Enums"]["member_status"]
        }
        Returns: undefined
      }
      void_invoice: { Args: { p_invoice: string }; Returns: undefined }
    }
    Enums: {
      activity_type:
        | "enrollment"
        | "attendance"
        | "payment"
        | "homework"
        | "mock"
        | "note"
      assignment_source: "library" | "upload" | "ai"
      assignment_status: "draft" | "pending_approval" | "approved" | "archived"
      attendance_status: "present" | "late" | "absent" | "excused"
      cefr_level: "A1" | "A2" | "B1" | "B2" | "C1" | "C2"
      enrollment_status: "active" | "paused" | "completed" | "dropped"
      invoice_status: "open" | "void"
      lesson_status: "scheduled" | "held" | "cancelled"
      member_role:
        | "owner"
        | "admin"
        | "academic_manager"
        | "mentor"
        | "student"
        | "parent"
      member_status: "invited" | "active" | "suspended"
      mock_result_status: "pending" | "in_progress" | "completed" | "absent"
      mock_status: "scheduled" | "in_progress" | "completed" | "cancelled"
      notification_channel: "in_app" | "sms" | "telegram" | "push"
      notification_status: "queued" | "sent" | "failed"
      payment_kind: "payment" | "refund"
      payment_method:
        | "cash"
        | "card"
        | "bank_transfer"
        | "click"
        | "payme"
        | "uzum"
      record_status: "active" | "archived"
      skill:
        | "reading"
        | "listening"
        | "writing"
        | "speaking"
        | "vocabulary"
        | "grammar"
      student_status: "lead" | "active" | "paused" | "graduated" | "left"
      submission_status:
        | "not_started"
        | "in_progress"
        | "submitted"
        | "reviewed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
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
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
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
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      activity_type: [
        "enrollment",
        "attendance",
        "payment",
        "homework",
        "mock",
        "note",
      ],
      assignment_source: ["library", "upload", "ai"],
      assignment_status: ["draft", "pending_approval", "approved", "archived"],
      attendance_status: ["present", "late", "absent", "excused"],
      cefr_level: ["A1", "A2", "B1", "B2", "C1", "C2"],
      enrollment_status: ["active", "paused", "completed", "dropped"],
      invoice_status: ["open", "void"],
      lesson_status: ["scheduled", "held", "cancelled"],
      member_role: [
        "owner",
        "admin",
        "academic_manager",
        "mentor",
        "student",
        "parent",
      ],
      member_status: ["invited", "active", "suspended"],
      mock_result_status: ["pending", "in_progress", "completed", "absent"],
      mock_status: ["scheduled", "in_progress", "completed", "cancelled"],
      notification_channel: ["in_app", "sms", "telegram", "push"],
      notification_status: ["queued", "sent", "failed"],
      payment_kind: ["payment", "refund"],
      payment_method: [
        "cash",
        "card",
        "bank_transfer",
        "click",
        "payme",
        "uzum",
      ],
      record_status: ["active", "archived"],
      skill: [
        "reading",
        "listening",
        "writing",
        "speaking",
        "vocabulary",
        "grammar",
      ],
      student_status: ["lead", "active", "paused", "graduated", "left"],
      submission_status: [
        "not_started",
        "in_progress",
        "submitted",
        "reviewed",
      ],
    },
  },
} as const
