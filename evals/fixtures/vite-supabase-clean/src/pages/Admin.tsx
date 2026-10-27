import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// The redirect is UX only; the orders_admin_read policy decides what this query returns.
export default function Admin({ role }: { role: string | null }) {
  const isAdmin = role === 'admin';
  const [orders, setOrders] = useState<any[]>([]);
  useEffect(() => {
    if (isAdmin) supabase.from('orders').select('id, total_cents').then(({ data }) => setOrders(data ?? []));
  }, [isAdmin]);
  if (!isAdmin) return <Navigate to="/" />;
  return <pre>{JSON.stringify(orders, null, 2)}</pre>;
}
