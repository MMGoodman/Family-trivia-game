import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_KEY

if (!url || !key) {
  throw new Error('חסרים פרטי החיבור ל-Supabase. בדוק את קובץ .env')
}

export const supabase = createClient(url, key)
