import { json } from '@sveltejs/kit';
import { admin } from '$lib/server/admin';

export async function GET() {
  const { data } = await admin.from('profiles').select('*');
  return json(data);
}
