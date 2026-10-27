import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function Admin({ user }: { user: { email: string } | null }) {
  const isAdmin = user?.email === 'owner@myapp.dev';
  const [orders, setOrders] = useState<any[]>([]);
  useEffect(() => {
    if (isAdmin) supabase.from('orders').select('*').then(({ data }) => setOrders(data ?? []));
  }, [isAdmin]);
  if (!isAdmin) return <Navigate to="/" />;
  return <pre>{JSON.stringify(orders, null, 2)}</pre>;
}
