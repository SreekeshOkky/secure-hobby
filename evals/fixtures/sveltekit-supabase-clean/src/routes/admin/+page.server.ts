import { error } from '@sveltejs/kit';

export const actions = {
  delete: async ({ request, locals }) => {
    const { user } = await locals.safeGetSession();
    if (user?.app_metadata?.role !== 'admin') throw error(403, 'Forbidden');
    const form = await request.formData();
    await locals.supabase.from('posts').delete().eq('id', form.get('id'));
  },
};
