import { error, json } from '@sveltejs/kit';

export async function GET({ locals }) {
  const { user } = await locals.safeGetSession();
  if (!user) throw error(401, 'Unauthorized');
  const { data } = await locals.supabase.from('profiles').select('id, display_name').eq('id', user.id);
  return json(data);
}
