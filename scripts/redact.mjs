#!/usr/bin/env node
// Secret patterns, masking and redaction. Used by prescan (to report secrets
// without their values) and on every findings file before it is written.
import { readJSON, writeJSON, die, isMain } from './lib.mjs';

function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(part, 'base64').toString('utf8'));
  } catch { return null; }
}

// Supabase anon keys are public by design: skip them. service_role keys bypass RLS.
function classifyJwt(token) {
  const p = decodeJwtPayload(token);
  if (!p) return null;
  if (p.role === 'anon') return null;
  if (p.role === 'service_role') return { severity: 'critical', title: 'Supabase service_role JWT (bypasses RLS)' };
  return { severity: 'low', title: 'Hard-coded JWT' };
}

export const SECRET_PATTERNS = [
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, classify: classifyJwt },
  { id: 'supabase-secret', re: /\bsb_secret_[A-Za-z0-9_-]{16,}/g, severity: 'critical', title: 'Supabase secret key' },
  { id: 'stripe-live', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}/g, severity: 'critical', title: 'Stripe live secret key' },
  { id: 'stripe-test', re: /\b(?:sk|rk)_test_[A-Za-z0-9]{16,}/g, severity: 'low', title: 'Stripe test secret key' },
  { id: 'anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, severity: 'high', title: 'Anthropic API key' },
  { id: 'openai', re: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g, severity: 'high', title: 'OpenAI API key' },
  { id: 'aws', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, severity: 'critical', title: 'AWS access key' },
  { id: 'github', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/g, severity: 'high', title: 'GitHub token' },
  { id: 'slack', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, severity: 'medium', title: 'Slack token' },
  { id: 'sendgrid', re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, severity: 'high', title: 'SendGrid API key' },
  { id: 'resend', re: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/g, severity: 'medium', title: 'Resend API key' },
  { id: 'vercel-blob', re: /\bvercel_blob_rw_[A-Za-z0-9_]{16,}/g, severity: 'high', title: 'Vercel Blob read-write token' },
  { id: 'google-api', re: /\bAIza[0-9A-Za-z_-]{35}/g, severity: 'info', title: 'Google API key (Firebase web keys are public by design; restrict it in Google Cloud)' },
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----/g, severity: 'critical', title: 'Private key' },
  { id: 'db-url', re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss):\/\/[^:\s'"`/@]+:[^@\s'"`]{3,}@[^\s'"`]+/g, severity: 'critical', title: 'Database URL with password' },
];

export const isPlaceholder = (v) => /your[-_]|example|placeholder|changeme|dummy|xxxx|<[^>]*>|\.\.\.|\*\*\*/i.test(v);

export function mask(v) {
  if (!v) return v;
  if (/^[a-z+]+:\/\//i.test(v)) return v.replace(/(:\/\/[^:/@]+:)[^@]+@/, '$1****@');
  if (v.startsWith('-----BEGIN')) return v;
  if (v.length <= 12) return '****';
  return `${v.slice(0, Math.min(8, Math.floor(v.length / 4)))}…${v.slice(-4)}`;
}

// Yields { pattern, value, index, severity, title } for every secret in text.
export function* findSecrets(text) {
  for (const p of SECRET_PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text))) {
      const value = m[0];
      if (isPlaceholder(value)) continue;
      const cls = p.classify ? p.classify(value) : { severity: p.severity, title: p.title };
      if (!cls) continue;
      yield { pattern: p.id, value, index: m.index, ...cls };
    }
  }
}

const NAMED_VALUE = /((?:["'`]?)[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|SERVICE_ROLE|API_KEY|APIKEY|ACCESS_KEY)[A-Za-z0-9_]*["'`]?\s*[:=]\s*["'`]?)([^\s"'`,;]{8,})/gi;

export function redactText(s) {
  if (typeof s !== 'string') return s;
  let out = s;
  for (const p of SECRET_PATTERNS) out = out.replace(p.re, (v) => mask(v));
  out = out.replace(NAMED_VALUE, (all, name, value) => (value.includes('…') || value.includes('****') || /^(process|import|env|Deno)\b/.test(value) ? all : name + mask(value)));
  return out;
}

export function redactDeep(obj) {
  if (typeof obj === 'string') return redactText(obj);
  if (Array.isArray(obj)) return obj.map(redactDeep);
  if (obj && typeof obj === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(obj)) o[k] = k === 'patch' || k === 'sql' ? redactText(v) : redactDeep(v);
    return o;
  }
  return obj;
}

// CLI: node redact.mjs <file.json>  — redacts a JSON file under ~/.secure-hobby in place.
if (isMain(import.meta.url)) {
  const file = process.argv[2];
  if (!file) die('usage: redact.mjs <file.json>');
  writeJSON(file, redactDeep(readJSON(file)));
  console.log(`redacted ${file}`);
}
