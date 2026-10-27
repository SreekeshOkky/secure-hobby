create table public.posts (
  id bigint generated always as identity primary key,
  author uuid references auth.users,
  body text
);
alter table public.posts disable row level security;
