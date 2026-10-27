// Supabase migration analyzer: RLS coverage, permissive policies, security
// definer functions, views that bypass RLS, public buckets, grants to anon.
// Reads every SQL file in the migrations surface in filename order, so a later
// migration that enables RLS clears an earlier "create table".

const EXPOSED_DEFAULT = new Set(['public', 'graphql_public']);

export default function analyze(ctx) {
  const files = ctx.provider.surfaces.migrations?.files || [];
  const exposed = exposedSchemas(ctx.read('supabase/config.toml') || '');
  const tables = new Map();
  const rlsOn = new Set();
  const realtime = new Set();

  for (const file of [...files].sort()) {
    const text = ctx.read(file);
    if (!text) continue;
    const lineOf = ctx.lineIndex(text);
    for (const st of ctx.sql.splitStatements(text)) {
      const s = ctx.sql.normalize(st.text);
      const line = lineOf(st.start);
      const at = { file, line, snippet: st.text.split('\n')[0].trim() };
      let m;
      if ((m = /^create (?:unlogged )?table (?:if not exists )?([\w".]+)/.exec(s))) {
        const t = ctx.sql.tableName(m[1]);
        if (exposed.has(t.split('.')[0]) && !tables.has(t)) tables.set(t, at);
      } else if ((m = /^alter table (?:only )?(?:if exists )?([\w".]+) (enable|disable) row level security/.exec(s))) {
        const t = ctx.sql.tableName(m[1]);
        if (m[2] === 'enable') rlsOn.add(t);
        else {
          rlsOn.delete(t);
          ctx.lead({ id: 'SUPA-002', title: `RLS explicitly disabled on ${t}`, severity: 'high', ...at });
        }
      } else if (/^create policy/.test(s)) {
        const cmd = (/ for (all|select|insert|update|delete)\b/.exec(s) || [, 'all'])[1];
        if (/\b(using|with check) \(\s*true\s*\)/.test(s)) {
          const roles = (/ to ([\w, ]+?)(?: using| with check|$)/.exec(s) || [, 'public'])[1];
          ctx.lead({
            id: 'SUPA-003', title: `Policy allows every row (${cmd} to ${roles.trim()})`, severity: cmd === 'select' ? 'info' : 'medium', ...at,
            note: cmd === 'select' ? 'Fine for genuinely public data. Confirm nothing private is in this table.' : 'Anyone matching the role can write any row.',
          });
        }
        if (/user_metadata|raw_user_meta_data/.test(s)) {
          ctx.lead({ id: 'SUPA-005', title: 'Policy trusts user_metadata, which users can edit themselves', severity: 'high', ...at });
        }
        if (cmd === 'update' && /using \(/.test(s) && !/with check/.test(s)) {
          ctx.lead({ id: 'SUPA-004', title: 'UPDATE policy without WITH CHECK (users may reassign row ownership)', severity: 'low', ...at });
        }
      } else if (/^create (?:or replace )?function/.test(s) && /security definer/.test(s)) {
        const fname = (/function ([\w".]+)/.exec(s) || [, '?'])[1];
        if (!/search_path/.test(s)) {
          ctx.lead({ id: 'SUPA-007', title: `SECURITY DEFINER function ${fname} without a fixed search_path`, severity: 'medium', ...at });
        }
        if (exposed.has(ctx.sql.tableName(fname).split('.')[0])) {
          ctx.lead({ id: 'SUPA-105', title: `SECURITY DEFINER function ${fname} in an exposed schema (callable via /rpc)`, severity: 'medium', ...at, note: 'Runs with owner rights and bypasses RLS. Confirm it checks auth.uid() and is revoked from anon if not needed.' });
        }
      } else if ((m = /^create (?:or replace )?(?:materialized )?view ([\w".]+)/.exec(s))) {
        const v = ctx.sql.tableName(m[1]);
        if (exposed.has(v.split('.')[0]) && !/security_invoker\s*=\s*(true|on)/.test(s)) {
          ctx.lead({ id: 'SUPA-008', title: `View ${v} runs with owner rights and bypasses RLS`, severity: 'medium', ...at });
        }
      } else if (/storage\.buckets/.test(s) && /^(insert|update)/.test(s) && /\bpublic\b/.test(s) && /\btrue\b/.test(s)) {
        ctx.lead({ id: 'SUPA-009', title: 'Public storage bucket', severity: 'medium', ...at, note: 'Every file is downloadable by URL without auth. Fine for avatars, not for invoices or IDs.' });
      } else if (/^grant /.test(s) && /\bto [\w, ]*\banon\b/.test(s) && !/^grant usage on schema/.test(s)) {
        ctx.lead({ id: 'SUPA-105', title: 'Explicit grant to anon', severity: 'low', ...at });
      } else if ((m = /^alter publication supabase_realtime add table ([\w"., ]+)/.exec(s))) {
        m[1].split(',').forEach((t) => realtime.add(ctx.sql.tableName(t.trim())));
      }
    }
  }
  for (const [t, at] of tables) {
    if (rlsOn.has(t)) continue;
    ctx.lead({
      id: 'SUPA-001', title: `Table ${t} has no Row Level Security`, severity: 'high', ...at,
      note: `Anyone with the public anon key can read and write every row.${realtime.has(t) ? ' It is also broadcast over Realtime.' : ''}`,
    });
  }
}

function exposedSchemas(toml) {
  const m = /\[api\][^[]*?schemas\s*=\s*\[([^\]]*)\]/s.exec(toml);
  if (!m) return EXPOSED_DEFAULT;
  return new Set(m[1].split(',').map((x) => x.trim().replace(/["']/g, '')).filter(Boolean));
}
