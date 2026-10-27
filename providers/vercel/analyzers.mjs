// Vercel analyzer: cron routes declared in vercel.json without a CRON_SECRET
// check, missing security headers, open proxy rewrites, committed .vercel/.

const CRON_GUARD = /CRON_SECRET|authorization|verifySignature|x-vercel-signature/i;

export default function analyze(ctx) {
  const raw = ctx.read('vercel.json');
  let conf = {};
  try { conf = raw ? JSON.parse(raw) : {}; } catch { /* invalid JSON is not our finding */ }

  for (const c of conf.crons || []) {
    const route = String(c.path || '').split('?')[0].replace(/^\/+|\/+$/g, '');
    if (!route) continue;
    const candidates = [
      `app/${route}/route.ts`, `app/${route}/route.js`, `src/app/${route}/route.ts`, `src/app/${route}/route.js`,
      `pages/${route}.ts`, `pages/${route}.js`, `src/pages/${route}.ts`, `${route}.ts`, `${route}.js`,
      `src/routes/${route}/+server.ts`, `src/routes/${route}/+server.js`,
    ];
    const file = candidates.find((f) => ctx.read(f) !== null);
    const coveredByRule = ctx.provider.surfaces.cron?.files.includes(file);
    if (file && !coveredByRule && !CRON_GUARD.test(ctx.read(file))) {
      ctx.lead({ id: 'VERCEL-001', title: `Cron route /${route} does not check CRON_SECRET`, severity: 'high', file, line: 1, note: 'Cron paths are public URLs, so anyone can trigger the job.' });
    }
  }

  const nextConfig = ['next.config.js', 'next.config.mjs', 'next.config.ts'].map((f) => ctx.read(f)).find(Boolean) || '';
  const hasHeaders = (conf.headers || []).length || /async\s+headers\s*\(|headers\s*:\s*async/.test(nextConfig) || ctx.files.some((f) => /(^|\/)(middleware|hooks\.server)\.(ts|js)$/.test(f.path) && /Content-Security-Policy|Strict-Transport-Security|X-Frame-Options/i.test(ctx.read(f.path) || ''));
  if (!hasHeaders) {
    ctx.lead({ id: 'VERCEL-002', title: 'No security headers configured (CSP, X-Frame-Options, Referrer-Policy)', severity: 'low', file: raw ? 'vercel.json' : (nextConfig ? 'next.config' : 'package.json'), line: null });
  }

  for (const r of conf.rewrites || []) {
    if (/^https?:\/\//.test(r.destination || '') && /:[\w]+\*?|\$\d/.test(r.destination.replace(/^https?:\/\//, ''))) {
      ctx.lead({ id: 'VERCEL-006', title: `Rewrite proxies request-controlled paths to ${r.destination.split('/').slice(0, 3).join('/')}`, severity: 'medium', file: 'vercel.json', line: null, snippet: JSON.stringify(r) });
    }
  }

  if (ctx.tracked && [...ctx.tracked].some((f) => f.startsWith('.vercel/'))) {
    ctx.lead({ id: 'VERCEL-003', title: '.vercel/ directory committed', severity: 'low', file: '.vercel/project.json', line: null, note: 'It holds project and org IDs and sometimes env files pulled with `vercel env pull`.' });
  }
}
