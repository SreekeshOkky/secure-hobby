create table public.orders (
  id bigint generated always as identity primary key,
  customer_id uuid not null references auth.users default auth.uid(),
  total_cents int not null
);
alter table public.orders enable row level security;
create policy "own orders" on public.orders for select to authenticated using ((select auth.uid()) = customer_id);
create policy "orders_admin_read" on public.orders for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create table public.products (
  id bigint generated always as identity primary key,
  name text not null
);
alter table public.products enable row level security;
create policy "products are public" on public.products for select to anon, authenticated using (true);
