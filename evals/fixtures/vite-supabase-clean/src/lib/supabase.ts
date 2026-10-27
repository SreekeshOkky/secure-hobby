import { createClient } from '@supabase/supabase-js';

// Anon key only. Admin access is enforced by RLS (app_metadata.role), not by this client.
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
