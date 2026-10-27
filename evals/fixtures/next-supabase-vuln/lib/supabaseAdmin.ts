import { createClient } from '@supabase/supabase-js';

// TODO: move to env before launch
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZpeHR1cmVmaXh0dXJlZml4dHUiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjIwMDAwMDAwMDB9.FAKEsignatureFAKEsignatureFAKEsig00';

export const supabaseAdmin = createClient('https://fixturefixturefixtur.supabase.co', SERVICE_ROLE_KEY);
