import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
import { splitStatements, catalogOnlyViolation } from '../scripts/sql.mjs';
import { globToRegExp, matchGlob } from '../scripts/lib.mjs';

test('splitStatements respects dollar quotes, strings and comments', () => {
  const sql = `-- c1
create table a (x text default 'a;b');
create function f() returns void language plpgsql as $$ begin perform 1; end; $$;
/* c2 */ alter table a enable row level security;`;
  const st = splitStatements(sql);
  assert.equal(st.length, 3);
  assert.match(st[0].text, /^create table a/);
  assert.match(st[1].text, /perform 1; end; \$\$$/);
  assert.match(st[2].text, /^alter table a/);
});

test('catalog-only SQL: the canned live.md queries pass', () => {
  const md = fs.readFileSync(path.join(ROOT, 'providers', 'supabase', 'live.md'), 'utf8');
  const queries = [...md.matchAll(/```sql\n([\s\S]*?)```/g)].map((m) => m[1].trim());
  assert.ok(queries.length >= 2);
  for (const q of queries) assert.equal(catalogOnlyViolation(q), null, q);
});

test('catalog-only SQL: user data, writes and side effects are blocked', () => {
  const bad = [
    'select * from public.orders',
    'select * from orders',
    'select email from auth.users',
    'delete from pg_catalog.pg_class',
    'select 1; drop table x',
    'with x as (select * from public.notes) select * from x',
    'select public.make_admin(1)',
    'select pg_read_file(\'/etc/passwd\')',
    'select current_setting(\'app.secret\')',
    'select * into newtab from pg_catalog.pg_class',
    'update pg_catalog.pg_class set relname = 1',
    'do $$ begin end $$',
  ];
  for (const q of bad) assert.notEqual(catalogOnlyViolation(q), null, q);
});

test('globs', () => {
  assert.ok(matchGlob('app/api/x/route.ts', '{app,src/app}/**/route.{ts,js}'));
  assert.ok(matchGlob('src/app/route.js', '{app,src/app}/**/route.{ts,js}'));
  assert.ok(matchGlob('deep/dir/.env.local', '**/.env*'));
  assert.ok(matchGlob('x/y/z.sql', '*.sql'));
  assert.ok(!matchGlob('app/api/x/route.tsx', '{app,src/app}/**/route.{ts,js}'));
  assert.ok(globToRegExp('supabase/**/*.sql').test('supabase/migrations/1.sql'));
});
