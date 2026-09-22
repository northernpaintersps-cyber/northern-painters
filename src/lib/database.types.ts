export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface Database {
  public: {
    Tables: {
      np_jobs: {
        Row: {
          id: string
          user_id: string
          client: string | null
          address: string | null
          type: string | null
          terms: string | null
          job_desc: string | null
          status: string | null
          quote_status: string | null
          quote_ex_gst: number | null
          agreed_ex_gst: number | null
          est_labour_ex: number | null
          est_materials_ex: number | null
          labour_rate: number | null
          sched_start: string | null
          est_days: number | null
          quote_no: string | null
          weather: string | null
          on_books: string | null
          lead_source: string | null
          notes: string | null
          quote_sent: string | null
          drive_link: string | null
          assigned_crew: string | null
          scheduled_dates: Json | null
          attachments: Json | null
          extra: Json | null
          updated_at: string | null
          created_at: string | null
        }
        Insert: Omit<Database['public']['Tables']['np_jobs']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['np_jobs']['Insert']>
      }
      np_labour: {
        Row: {
          id: string
          user_id: string
          job_id: string | null
          client: string | null
          date: string | null
          sub: string | null
          hours: number | null
          rate: number | null
          cost: number | null
          charge_rate: number | null
          billable: number | null
          billing_type: string | null
          paid: boolean | null
          worker_payment_type: string | null
          labour_desc: string | null
          notes: string | null
          clock_in: string | null
          clock_out: string | null
          updated_at: string | null
          created_at: string | null
        }
        Insert: Omit<Database['public']['Tables']['np_labour']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['np_labour']['Insert']>
      }
      np_invoices: {
        Row: {
          id: string
          user_id: string
          job_id: string | null
          client: string | null
          date: string | null
          date_paid: string | null
          agreed_ex_gst: number | null
          gst: number | null
          total_inc_gst: number | null
          deposit: number | null
          deposit_date: string | null
          notes: string | null
          inv_status: string | null
          received: number | null
          manual_paid: boolean | null
          due_date: string | null
          extra: Json | null
          updated_at: string | null
          created_at: string | null
        }
        Insert: Omit<Database['public']['Tables']['np_invoices']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['np_invoices']['Insert']>
      }
      np_materials: {
        Row: {
          id: string
          user_id: string
          job_id: string | null
          client: string | null
          date: string | null
          supplier: string | null
          mat_desc: string | null
          cost_ex_gst: number | null
          gst: number | null
          total_inc_gst: number | null
          category: string | null
          billing_type: string | null
          notes: string | null
          receipt_no: string | null
          updated_at: string | null
          created_at: string | null
        }
        Insert: Omit<Database['public']['Tables']['np_materials']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['np_materials']['Insert']>
      }
      np_crew: {
        Row: {
          id: string
          user_id: string
          name: string | null
          role: string | null
          rate: number | null
          charge_rate: number | null
          payment_type: string | null
          phone: string | null
          email: string | null
          notes: string | null
          updated_at: string | null
          created_at: string | null
        }
        Insert: Omit<Database['public']['Tables']['np_crew']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['np_crew']['Insert']>
      }
      np_assignments: {
        Row: {
          id: string
          user_id: string
          job_id: string | null
          crew_name: string | null
          date: string | null
          hours: number | null
          notes: string | null
          updated_at: string | null
          created_at: string | null
        }
        Insert: Omit<Database['public']['Tables']['np_assignments']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['np_assignments']['Insert']>
      }
      np_enquiries: {
        Row: {
          id: string
          user_id: string
          date: string | null
          client: string | null
          address: string | null
          phone: string | null
          email: string | null
          source: string | null
          notes: string | null
          enq_status: string | null
          converted_to_job: string | null
          job_id: string | null
          updated_at: string | null
          created_at: string | null
        }
        Insert: Omit<Database['public']['Tables']['np_enquiries']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['np_enquiries']['Insert']>
      }
      np_variations: {
        Row: {
          id: string
          user_id: string
          job_id: string | null
          date: string | null
          var_desc: string | null
          amount_ex_gst: number | null
          var_status: string | null
          notes: string | null
          updated_at: string | null
          created_at: string | null
        }
        Insert: Omit<Database['public']['Tables']['np_variations']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['np_variations']['Insert']>
      }
      np_todos: {
        Row: {
          id: string
          user_id: string
          todo_text: string | null
          done: boolean | null
          due: string | null
          job_id: string | null
          priority: string | null
          updated_at: string | null
          created_at: string | null
        }
        Insert: Omit<Database['public']['Tables']['np_todos']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['np_todos']['Insert']>
      }
      np_expenses: {
        Row: {
          id: string
          user_id: string
          job_id: string | null
          date: string | null
          exp_desc: string | null
          amount_ex_gst: number | null
          gst: number | null
          category: string | null
          notes: string | null
          updated_at: string | null
          created_at: string | null
        }
        Insert: Omit<Database['public']['Tables']['np_expenses']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['np_expenses']['Insert']>
      }
      np_receipts: {
        Row: {
          id: string
          user_id: string
          job_id: string | null
          client: string | null
          date: string | null
          supplier: string | null
          rec_desc: string | null
          cost_ex_gst: number | null
          gst: number | null
          total_inc_gst: number | null
          category: string | null
          notes: string | null
          updated_at: string | null
          created_at: string | null
        }
        Insert: Omit<Database['public']['Tables']['np_receipts']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['np_receipts']['Insert']>
      }
      np_pay_schedules: {
        Row: {
          id: string
          user_id: string
          worker: string | null
          period_start: string | null
          period_end: string | null
          amount: number | null
          paid: boolean | null
          notes: string | null
          updated_at: string | null
          created_at: string | null
        }
        Insert: Omit<Database['public']['Tables']['np_pay_schedules']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['np_pay_schedules']['Insert']>
      }
      np_site_visits: {
        Row: {
          id: string
          user_id: string
          job_id: string | null
          date: string | null
          notes: string | null
          photos: Json | null
          updated_at: string | null
          created_at: string | null
        }
        Insert: Omit<Database['public']['Tables']['np_site_visits']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['np_site_visits']['Insert']>
      }
      np_ads_spend: {
        Row: {
          id: string
          user_id: string
          date: string | null
          platform: string | null
          amount: number | null
          notes: string | null
          updated_at: string | null
          created_at: string | null
        }
        Insert: Omit<Database['public']['Tables']['np_ads_spend']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['np_ads_spend']['Insert']>
      }
      np_calendar_events: {
        Row: {
          id: string
          user_id: string
          title: string | null
          date: string | null
          end_date: string | null
          color: string | null
          notes: string | null
          job_id: string | null
          time: string | null
          updated_at: string | null
          created_at: string | null
        }
        Insert: Omit<Database['public']['Tables']['np_calendar_events']['Row'], 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['np_calendar_events']['Insert']>
      }
      np_settings: {
        Row: {
          key: string
          user_id: string
          value: Json | null
          updated_at: string | null
        }
        Insert: Database['public']['Tables']['np_settings']['Row']
        Update: Partial<Database['public']['Tables']['np_settings']['Row']>
      }
    }
  }
}
