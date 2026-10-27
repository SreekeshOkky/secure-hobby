import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_SERVICE_KEY } from '$env/static/public';

export const admin = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_SERVICE_KEY);
