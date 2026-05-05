import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co"
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-key"

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          name: string
          role: string
          created_at: string
        }
      }
      farms: {
        Row: {
          id: string
          user_id: string
          name: string
          location: string
          area: number
          created_at: string
        }
      }
      tanks: {
        Row: {
          id: string
          farm_id: string
          name: string
          volume: number
          status: string
          stocking_density: number
          created_at: string
        }
      }
      water_quality: {
        Row: {
          id: string
          tank_id: string
          temperature: number
          ph: number
          do_level: number
          salinity: number
          ammonia: number
          nitrite: number
          nitrate: number
          alkalinity: number
          turbidity: number
          recorded_at: string
          created_at: string
        }
      }
    }
  }
}
