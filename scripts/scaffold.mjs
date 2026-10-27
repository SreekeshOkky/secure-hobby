#!/usr/bin/env node
// Creates providers/<id>/ from providers/_template. Development-time only.
//   scaffold.mjs <id> <PREFIX> [--kind platform|framework]
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, die, PLUGIN_ROOT } from './lib.mjs';

const { positional, flags } = parseArgs(process.argv.slice(2));
const [id, prefix] = positional;
if (!/^[a-z][a-z0-9-]*$/.test(id || '') || !/^[A-Z][A-Z0-9]*$/.test(prefix || '')) die('usage: scaffold.mjs <id: lowercase> <PREFIX: uppercase> [--kind platform|framework]');
const src = path.join(PLUGIN_ROOT, 'providers', '_template');
const dest = path.join(PLUGIN_ROOT, 'providers', id);
if (fs.existsSync(dest)) die(`providers/${id} already exists`);
fs.mkdirSync(dest);
for (const f of fs.readdirSync(src).filter((x) => x !== 'README.md')) {
  const text = fs.readFileSync(path.join(src, f), 'utf8')
    .replaceAll('__ID__', id).replaceAll('__PREFIX__', prefix).replaceAll('__KIND__', flags.kind || 'platform');
  fs.writeFileSync(path.join(dest, f), text);
}
console.log(`created providers/${id}: edit provider.json (detect, surfaces), checks.md and prescan.json`);
