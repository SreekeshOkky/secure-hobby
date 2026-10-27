import { createServerClient } from '@supabase/ssr';
import { redirect, type Handle } from '@sveltejs/kit';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.supabase = createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    cookies: { getAll: () => event.cookies.getAll(), setAll: () => {} },
  });
  const { data: { session } } = await event.locals.supabase.auth.getSession();
  event.locals.session = session;
  if (event.url.pathname === '/admin' && !session) throw redirect(303, '/login');
  return resolve(event);
};
