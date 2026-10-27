import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function Search() {
  const [rows, setRows] = useState<any[]>([]);
  async function run(q: string) {
    const { data } = await supabase.from('products').select('id, name').ilike('name', `%${q}%`);
    setRows(data ?? []);
  }
  return <input onChange={(e) => run(e.target.value)} placeholder={`${rows.length} results`} />;
}
