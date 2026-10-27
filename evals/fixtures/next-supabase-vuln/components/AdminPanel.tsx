'use client';
import { supabaseAdmin } from '../lib/supabaseAdmin';

export default function AdminPanel({ notes }: { notes: { id: string; body: string }[] }) {
  async function wipe(id: string) {
    await supabaseAdmin.from('notes').delete().eq('id', id);
  }
  return (
    <ul>
      {notes.map((n) => (
        <li key={n.id}>
          <div dangerouslySetInnerHTML={{ __html: n.body }} />
          <button onClick={() => wipe(n.id)}>delete</button>
        </li>
      ))}
    </ul>
  );
}
