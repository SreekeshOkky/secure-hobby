create table public.orders (
  id bigint generated always as identity primary key,
  customer_email text not null,
  total_cents int not null
);

create table public.feedback (
  id bigint generated always as identity primary key,
  message text
);
alter table public.feedback enable row level security;
create policy "anyone can do anything" on public.feedback for all to anon using (true) with check (true);
