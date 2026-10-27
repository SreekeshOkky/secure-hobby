import { admin } from '$lib/server/admin';

export const actions = {
  delete: async ({ request }) => {
    const form = await request.formData();
    await admin.from('posts').delete().eq('id', form.get('id'));
  },
};
