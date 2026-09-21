export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  api: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_court: {
        Args: { p_session_id: string; p_side_a?: number; p_side_b?: number }
        Returns: undefined
      }
      authorize_staff: {
        Args: { p_email: string; p_role: string }
        Returns: undefined
      }
      claim_staff_access: { Args: never; Returns: string }
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
      current_staff_role: { Args: never; Returns: string }
      delete_court: { Args: { p_court_id: string }; Returns: undefined }
      delete_push_subscription: {
        Args: { p_endpoint: string }
        Returns: undefined
      }
      delete_session: { Args: { p_session_id: string }; Returns: undefined }
      end_session: { Args: { p_session_id: string }; Returns: undefined }
      finish_round: { Args: { p_round_id: string }; Returns: undefined }
      get_active_session_code: { Args: never; Returns: string }
      get_display_name: { Args: never; Returns: string }
      get_session_summary: { Args: { p_session_id: string }; Returns: Json }
      get_snapshot: { Args: { p_code: string }; Returns: Json }
      join_queue: {
        Args: { p_court_id?: string; p_session_id: string }
        Returns: undefined
      }
      leave_queue: { Args: { p_session_id: string }; Returns: undefined }
      list_sessions: { Args: never; Returns: Json }
      list_staff: { Args: never; Returns: Json }
      ops_health: { Args: never; Returns: Json }
      pause_round: { Args: { p_round_id: string }; Returns: undefined }
      push_ack: { Args: { p_msg_id: number }; Returns: undefined }
      push_claim: {
        Args: { p_limit?: number; p_visibility_seconds?: number }
        Returns: Json
      }
      push_forget_subscription: {
        Args: { p_endpoint: string }
        Returns: undefined
      }
      push_retry: {
        Args: { p_delay_seconds: number; p_msg_id: number }
        Returns: undefined
      }
      push_subscriptions_of: { Args: { p_user_id: string }; Returns: Json }
      remove_player: {
        Args: { p_participant_id: string; p_session_id: string }
        Returns: undefined
      }
      resume_round: { Args: { p_round_id: string }; Returns: undefined }
      revoke_staff: { Args: { p_email: string }; Returns: undefined }
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
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      [_ in never]: never
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
  api: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

