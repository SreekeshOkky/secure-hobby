create table public.posts (
  id bigint generated always as identity primary key,
  author uuid not null references auth.users default auth.uid(),
  body text
);
alter table public.posts enable row level security;
create policy "posts are readable" on public.posts for select to anon, authenticated using (true);
create policy "authors write own posts" on public.posts for all to authenticated
  using ((select auth.uid()) = author) with check ((select auth.uid()) = author);
create policy "admins delete posts" on public.posts for delete to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
