import { createClient } from '@supabase/supabase-js';

// Using the service role so the admin page can see all orders.
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY);
