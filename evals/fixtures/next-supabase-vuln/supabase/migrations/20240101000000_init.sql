-- profiles
create table public.profiles (
  id uuid primary key references auth.users,
  display_name text,
  is_admin boolean default false
);
alter table public.profiles enable row level security;
create policy "profiles are editable" on public.profiles for update using (true);

-- notes
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users,
  title text,
  body text,
  created_at timestamptz default now()
);

create policy "admins read profiles" on public.profiles for select to authenticated
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'admin');

create or replace function public.make_admin(target uuid) returns void
language plpgsql security definer as $$
begin
  update public.profiles set is_admin = true where id = target;
end;
$$;
grant execute on function public.make_admin(uuid) to anon;

create view public.user_emails as select id, email from auth.users;

insert into storage.buckets (id, name, public) values ('invoices', 'invoices', true);
