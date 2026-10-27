'use server';
import { serverClient } from '@/lib/server';

export async function deleteNote(id: string) {
  const supabase = serverClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('unauthorized');
  // RLS also restricts deletes to the owner.
  await supabase.from('notes').delete().eq('id', id).eq('user_id', user.id);
}
