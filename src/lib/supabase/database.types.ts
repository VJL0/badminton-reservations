export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      courts: {
        Row: {
          capacity: number | null
          court_number: number
          created_at: string
          id: string
          removed_at: string | null
          session_id: string
          side_a_size: number
          side_b_size: number
        }
        Insert: {
          capacity?: number | null
          court_number: number
          created_at?: string
          id?: string
          removed_at?: string | null
          session_id: string
          side_a_size?: number
          side_b_size?: number
        }
        Update: {
          capacity?: number | null
          court_number?: number
          created_at?: string
          id?: string
          removed_at?: string | null
          session_id?: string
          side_a_size?: number
          side_b_size?: number
        }
        Relationships: [
          {
            foreignKeyName: "courts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "open_play_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      open_play_sessions: {
        Row: {
          auto_finish: boolean
          auto_requeue_on_finish: boolean
          auto_start: boolean
          code: string
          created_at: string
          ended_at: string | null
          game_duration_seconds: number
          id: string
          max_queue_size: number
          name: string
          start_delay_seconds: number
          started_at: string
          status: Database["public"]["Enums"]["session_status"]
        }
        Insert: {
          auto_finish?: boolean
          auto_requeue_on_finish?: boolean
          auto_start?: boolean
          code: string
          created_at?: string
          ended_at?: string | null
          game_duration_seconds?: number
          id?: string
          max_queue_size?: number
          name: string
          start_delay_seconds?: number
          started_at?: string
          status?: Database["public"]["Enums"]["session_status"]
        }
        Update: {
          auto_finish?: boolean
          auto_requeue_on_finish?: boolean
          auto_start?: boolean
          code?: string
          created_at?: string
          ended_at?: string | null
          game_duration_seconds?: number
          id?: string
          max_queue_size?: number
          name?: string
          start_delay_seconds?: number
          started_at?: string
          status?: Database["public"]["Enums"]["session_status"]
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string
          id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          p256dh: string
          player_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          p256dh: string
          player_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          p256dh?: string
          player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      queue_entries: {
        Row: {
          ended_at: string | null
          id: string
          outcome: Database["public"]["Enums"]["queue_outcome"] | null
          player_id: string
          queued_at: string
          round_id: string | null
          session_id: string
        }
        Insert: {
          ended_at?: string | null
          id?: string
          outcome?: Database["public"]["Enums"]["queue_outcome"] | null
          player_id: string
          queued_at: string
          round_id?: string | null
          session_id: string
        }
        Update: {
          ended_at?: string | null
          id?: string
          outcome?: Database["public"]["Enums"]["queue_outcome"] | null
          player_id?: string
          queued_at?: string
          round_id?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "queue_entries_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_entries_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "rounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_entries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "open_play_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      round_players: {
        Row: {
          id: string
          joined_at: string
          left_at: string | null
          player_id: string
          round_id: string
          slot: number
        }
        Insert: {
          id?: string
          joined_at?: string
          left_at?: string | null
          player_id: string
          round_id: string
          slot: number
        }
        Update: {
          id?: string
          joined_at?: string
          left_at?: string | null
          player_id?: string
          round_id?: string
          slot?: number
        }
        Relationships: [
          {
            foreignKeyName: "round_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_players_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "rounds"
            referencedColumns: ["id"]
          },
        ]
      }
      rounds: {
        Row: {
          court_id: string
          created_at: string
          ended_at: string | null
          ends_at: string | null
          id: string
          paused_at: string | null
          session_id: string
          start_at: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["round_status"]
        }
        Insert: {
          court_id: string
          created_at?: string
          ended_at?: string | null
          ends_at?: string | null
          id?: string
          paused_at?: string | null
          session_id: string
          start_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["round_status"]
        }
        Update: {
          court_id?: string
          created_at?: string
          ended_at?: string | null
          ends_at?: string | null
          id?: string
          paused_at?: string | null
          session_id?: string
          start_at?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["round_status"]
        }
        Relationships: [
          {
            foreignKeyName: "rounds_court_id_fkey"
            columns: ["court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rounds_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "open_play_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_players: {
        Row: {
          current_round_id: string | null
          joined_at: string
          notified_next: boolean
          notified_round_id: string | null
          player_id: string
          preferred_court_id: string | null
          queued_at: string | null
          session_id: string
          state: Database["public"]["Enums"]["player_state"]
          updated_at: string
        }
        Insert: {
          current_round_id?: string | null
          joined_at?: string
          notified_next?: boolean
          notified_round_id?: string | null
          player_id: string
          preferred_court_id?: string | null
          queued_at?: string | null
          session_id: string
          state?: Database["public"]["Enums"]["player_state"]
          updated_at?: string
        }
        Update: {
          current_round_id?: string | null
          joined_at?: string
          notified_next?: boolean
          notified_round_id?: string | null
          player_id?: string
          preferred_court_id?: string | null
          queued_at?: string | null
          session_id?: string
          state?: Database["public"]["Enums"]["player_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_players_current_round_id_fkey"
            columns: ["current_round_id"]
            isOneToOne: false
            referencedRelation: "rounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_players_preferred_court_id_fkey"
            columns: ["preferred_court_id"]
            isOneToOne: false
            referencedRelation: "courts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_players_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "open_play_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["staff_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          role: Database["public"]["Enums"]["staff_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["staff_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _allocate: { Args: { p_session_id: string }; Returns: undefined }
      _broadcast: { Args: { p_session_id: string }; Returns: undefined }
      _finish_overdue_rounds: { Args: never; Returns: number }
      _finish_round: { Args: { p_round_id: string }; Returns: undefined }
      _leave: {
        Args: {
          p_allow_active: boolean
          p_player_id: string
          p_session_id: string
        }
        Returns: undefined
      }
      _lock_session: {
        Args: { p_session_id: string }
        Returns: {
          auto_finish: boolean
          auto_requeue_on_finish: boolean
          auto_start: boolean
          code: string
          created_at: string
          ended_at: string | null
          game_duration_seconds: number
          id: string
          max_queue_size: number
          name: string
          start_delay_seconds: number
          started_at: string
          status: Database["public"]["Enums"]["session_status"]
        }
        SetofOptions: {
          from: "*"
          to: "open_play_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _notify: { Args: { p_session_id: string }; Returns: undefined }
      _release_from_filling: {
        Args: { p_player_id: string; p_requeue: boolean; p_round_id: string }
        Returns: undefined
      }
      _require_staff: { Args: { p_admin_only?: boolean }; Returns: undefined }
      _require_user: { Args: never; Returns: string }
      _staff_role: {
        Args: never
        Returns: Database["public"]["Enums"]["staff_role"]
      }
      _start_round: { Args: { p_round_id: string }; Returns: undefined }
      _sync_round: { Args: { p_round_id: string }; Returns: undefined }
      add_court: {
        Args: { p_session_id: string; p_side_a?: number; p_side_b?: number }
        Returns: undefined
      }
      create_session: {
        Args: {
          p_auto_requeue?: boolean
          p_code?: string
          p_court_count?: number
          p_game_duration_seconds?: number
          p_name: string
        }
        Returns: string
      }
      delete_court: { Args: { p_court_id: string }; Returns: undefined }
      delete_push_subscription: {
        Args: { p_endpoint: string }
        Returns: undefined
      }
      delete_session: { Args: { p_session_id: string }; Returns: undefined }
      end_session: { Args: { p_session_id: string }; Returns: undefined }
      finish_round: { Args: { p_round_id: string }; Returns: undefined }
      get_active_session_code: { Args: never; Returns: string }
      get_session_summary: { Args: { p_session_id: string }; Returns: Json }
      get_snapshot: { Args: { p_code: string }; Returns: Json }
      join_queue: {
        Args: { p_court_id?: string; p_session_id: string }
        Returns: undefined
      }
      leave_queue: { Args: { p_session_id: string }; Returns: undefined }
      list_sessions: { Args: never; Returns: Json }
      list_staff: { Args: never; Returns: Json }
      pause_round: { Args: { p_round_id: string }; Returns: undefined }
      remove_player: {
        Args: { p_player_id: string; p_session_id: string }
        Returns: undefined
      }
      resume_round: { Args: { p_round_id: string }; Returns: undefined }
      save_push_subscription: {
        Args: { p_auth: string; p_endpoint: string; p_p256dh: string }
        Returns: undefined
      }
      set_display_name: { Args: { p_name: string }; Returns: undefined }
      start_round: { Args: { p_round_id: string }; Returns: undefined }
      update_court: {
        Args: { p_court_id: string; p_side_a: number; p_side_b: number }
        Returns: undefined
      }
      update_session_settings: {
        Args: {
          p_auto_finish: boolean
          p_auto_requeue: boolean
          p_auto_start: boolean
          p_game_duration_seconds: number
          p_session_id: string
          p_start_delay_seconds: number
        }
        Returns: undefined
      }
    }
    Enums: {
      player_state: "IDLE" | "QUEUED" | "PLAYING"
      queue_outcome: "ASSIGNED" | "LEFT" | "REMOVED" | "SESSION_ENDED"
      round_status: "FILLING" | "ACTIVE" | "COMPLETED" | "CANCELLED"
      session_status: "ACTIVE" | "ENDED"
      staff_role: "ADMIN" | "OPERATOR"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      player_state: ["IDLE", "QUEUED", "PLAYING"],
      queue_outcome: ["ASSIGNED", "LEFT", "REMOVED", "SESSION_ENDED"],
      round_status: ["FILLING", "ACTIVE", "COMPLETED", "CANCELLED"],
      session_status: ["ACTIVE", "ENDED"],
      staff_role: ["ADMIN", "OPERATOR"],
    },
  },
} as const

