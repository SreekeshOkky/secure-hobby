import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
  const { data } = await supabaseAdmin.auth.admin.listUsers();
  return NextResponse.json(data);
}
