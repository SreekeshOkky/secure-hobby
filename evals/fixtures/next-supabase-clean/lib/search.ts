import { serverClient } from './server';

export async function searchNotes(q: string) {
  return serverClient().from('notes').select('id, title').ilike('title', `%${q}%`);
}
