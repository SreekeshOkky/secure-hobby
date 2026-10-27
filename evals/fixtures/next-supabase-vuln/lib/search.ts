import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

export async function searchNotes(q: string) {
  return supabase.from('notes').select('*').or(`title.ilike.%${q}%,body.ilike.%${q}%`);
}
