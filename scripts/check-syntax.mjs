#!/usr/bin/env node
// `node --check` on every script in the repo: the .js/.mjs files and the
// <script> blocks inside the two HTML pages (pulled out to temp files first).
// Exit code 1 if any of them fails to parse.

import { readFile, readdir, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import process from 'node:process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', 'test-results']);

async function walk(dir, acc = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, acc);
    else if (/\.(m?js|html)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const tmp = join(tmpdir(), 'qa-site-check-' + process.pid);
await mkdir(tmp, { recursive: true });
let failed = 0, checked = 0;

function check(file, label) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  checked++;
  if (r.status === 0) { console.log('  ok   ' + label); return; }
  failed++;
  console.log('  FAIL ' + label + '\n' + (r.stderr || r.stdout).split('\n').map((l) => '       ' + l).join('\n'));
}

for (const f of await walk(root)) {
  const rel = relative(root, f).replace(/\\/g, '/');
  if (f.endsWith('.html')) {
    const html = await readFile(f, 'utf8');
    let i = 0;
    for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      i++;
      const out = join(tmp, rel.replace(/[\\/]/g, '__') + '.' + i + '.js');
      await writeFile(out, m[1]);
      check(out, `${rel} <script> #${i}`);
    }
  } else {
    check(f, rel);
  }
}

await rm(tmp, { recursive: true, force: true });
console.log(`${checked} checked, ${failed} failed`);
process.exit(failed ? 1 : 0);
