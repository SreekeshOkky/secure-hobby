import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
  await supabaseAdmin.from('notes').delete().lt('created_at', cutoff);
  return Response.json({ ok: true });
}
