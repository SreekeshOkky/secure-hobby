import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
  const { data: { user } } = await serverClient().auth.getUser();
  if (user?.app_metadata?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { data } = await supabaseAdmin.auth.admin.listUsers();
  return NextResponse.json(data.users.map((u) => ({ id: u.id, created_at: u.created_at })));
}
