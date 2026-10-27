create schema if not exists private;

create table public.profiles (
  id uuid primary key references auth.users,
  display_name text
);
alter table public.profiles enable row level security;
create policy "own profile read" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "own profile update" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users default auth.uid(),
  title text,
  body text,
  created_at timestamptz default now()
);
alter table public.notes enable row level security;
create policy "own notes" on public.notes for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create view public.my_notes with (security_invoker = true) as
  select id, title from public.notes;

insert into storage.buckets (id, name, public) values ('attachments', 'attachments', false);
