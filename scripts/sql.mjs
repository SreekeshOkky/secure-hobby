// Small SQL helpers: a statement splitter that respects quotes, dollar-quoted
// bodies and comments, and the "catalog-only" check the guard applies to
// live execute_sql calls.

export function splitStatements(sql) {
  const out = [];
  const n = sql.length;
  let start = 0;
  let i = 0;
  const push = (end) => {
    const raw = sql.slice(start, end);
    const lead = /^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/.exec(raw)[0].length;
    if (raw.slice(lead).trim()) out.push({ text: raw.slice(lead), start: start + lead });
  };
  while (i < n) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === '-' && d === '-') { const e = sql.indexOf('\n', i); i = e === -1 ? n : e; continue; }
    if (c === '/' && d === '*') { const e = sql.indexOf('*/', i + 2); i = e === -1 ? n : e + 2; continue; }
    if (c === "'" || c === '"') {
      i++;
      while (i < n) {
        if (sql[i] === c) { if (sql[i + 1] === c) { i += 2; continue; } break; }
        i++;
      }
      i++;
      continue;
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (m) {
        const e = sql.indexOf(m[0], i + m[0].length);
        i = e === -1 ? n : e + m[0].length;
        continue;
      }
    }
    if (c === ';') { push(i); start = i + 1; }
    i++;
  }
  push(n);
  return out;
}

export const stripComments = (s) => s.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
export const normalize = (s) => stripComments(s).replace(/\s+/g, ' ').trim().toLowerCase();

// "public.notes", "notes", '"public"."notes"' -> "public.notes"
export function tableName(raw) {
  const name = raw.replace(/"/g, '').replace(/\($/, '');
  return name.includes('.') ? name : `public.${name}`;
}

const SAFE_FUNCS = new Set([
  'count', 'coalesce', 'array_agg', 'string_agg', 'json_agg', 'jsonb_agg', 'json_build_object', 'jsonb_build_object',
  'row_to_json', 'to_json', 'to_jsonb', 'lower', 'upper', 'format_type', 'pg_get_functiondef', 'pg_get_function_arguments',
  'pg_get_viewdef', 'pg_get_expr', 'pg_get_userbyid', 'obj_description', 'has_table_privilege', 'has_function_privilege',
  'quote_ident', 'array_to_string', 'unnest', 'bool_or', 'bool_and', 'max', 'min', 'nullif', 'length', 'cardinality',
  'pg_catalog.pg_get_functiondef', 'pg_catalog.obj_description', 'pg_catalog.format_type', 'pg_catalog.pg_get_expr',
]);
const SQL_KEYWORDS_BEFORE_PAREN = new Set([
  'in', 'exists', 'any', 'all', 'as', 'over', 'filter', 'values', 'cast', 'and', 'or', 'not', 'on', 'using', 'select',
  'where', 'when', 'then', 'else', 'case', 'from', 'join', 'array', 'distinct', 'by', 'with', 'is',
]);
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|do|execute|prepare|set|reset|lock|vacuum|analyze|refresh|comment|listen|notify|import|security|into)\b/i;
const DANGEROUS_FUNCS = /\b(pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|lo_\w+|dblink\w*|pg_sleep\w*|pg_terminate_backend|pg_cancel_backend|set_config|current_setting|query_to_xml|http\w*|net\.\w+)\s*\(/i;
const CATALOG_REL = /^(pg_catalog\.\w+|information_schema\.\w+|pg_\w+|storage\.buckets)$/;

// Returns null when the query only reads Postgres catalogs / bucket metadata,
// otherwise a reason string. Strict on purpose: the live checker uses the
// canned queries in providers/supabase/live.md, which pass this check.
export function catalogOnlyViolation(sql) {
  if (typeof sql !== 'string' || !sql.trim()) return 'empty query';
  const s = stripComments(sql).trim().replace(/;\s*$/, '');
  const noStrings = s.replace(/'(?:[^']|'')*'/g, "''");
  if (noStrings.includes(';')) return 'multiple statements are not allowed';
  if (/\$\w*\$/.test(noStrings)) return 'dollar-quoted bodies are not allowed';
  if (!/^\s*(select|with)\b/i.test(noStrings)) return 'only SELECT / WITH queries are allowed';
  const f = FORBIDDEN.exec(noStrings);
  if (f) return `keyword "${f[1]}" is not allowed`;
  const d = DANGEROUS_FUNCS.exec(noStrings);
  if (d) return `function "${d[1]}" is not allowed`;
  const ctes = new Set([...noStrings.matchAll(/(?:\bwith|,)\s*([a-z_][a-z0-9_]*)\s+as\s*\(/gi)].map((m) => m[1].toLowerCase()));
  for (const m of noStrings.matchAll(/\b(?:from|join)\s+([a-z_"][a-z0-9_."]*)/gi)) {
    const rel = m[1].replace(/"/g, '').toLowerCase();
    if (!CATALOG_REL.test(rel) && !ctes.has(rel)) return `relation "${rel}" is not a catalog table (user data is off-limits)`;
  }
  for (const m of noStrings.matchAll(/([a-z_][a-z0-9_.]*)\s*\(/gi)) {
    const fn = m[1].toLowerCase();
    if (SQL_KEYWORDS_BEFORE_PAREN.has(fn) || SAFE_FUNCS.has(fn) || ctes.has(fn)) continue;
    return `function "${fn}" is not on the safe list`;
  }
  return null;
}
