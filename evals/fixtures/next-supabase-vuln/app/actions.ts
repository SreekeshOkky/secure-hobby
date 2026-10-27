'use server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function deleteNote(id: string) {
  await supabaseAdmin.from('notes').delete().eq('id', id);
}
