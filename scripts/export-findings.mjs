#!/usr/bin/env node
// Export the QA findings from the bellyrubs-qa Supabase project to an offline
// folder, in the same shape as the hand-made exports:
//
//   ..\exports\<YYYY-MM-DD>\findings.md      readable
//   ..\exports\<YYYY-MM-DD>\findings.json    machine
//   ..\exports\<YYYY-MM-DD>\NN-<screen-slug>-<phone>.<ext>   every screenshot
//
// Runs on the founder's PC only: it reads with the SERVICE ROLE key from
// scripts/.env (gitignored; see scripts/.env.example).
//
//   npm run export                     everything
//   npm run export -- --since 2026-10-12   only findings logged on/after that date
//   npm run export -- --out "D:\somewhere"  write there instead of ..\exports\<today>
//
// Nothing here writes to the database.

import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(here, '..');

// ---------- .env (Node 20.12+ has loadEnvFile built in)
const envPath = join(here, '.env');
try {
  await access(envPath);
  process.loadEnvFile(envPath);
} catch {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    fail(`No scripts/.env found. Copy scripts/.env.example to scripts/.env and fill in the two values.`);
  }
}
const URL_ = (process.env.SUPABASE_URL || '').trim();
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!/^https?:\/\/\S+$/.test(URL_)) fail('SUPABASE_URL in scripts/.env does not look like a URL (expected https://<ref>.supabase.co)');
if (!KEY || /^paste-/.test(KEY)) fail('SUPABASE_SERVICE_ROLE_KEY in scripts/.env is not filled in.');

// ---------- arguments
const args = process.argv.slice(2);
function flag(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; }
const since = flag('--since');
if (since !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(since)) fail('--since wants a date like 2026-10-12');
const today = new Date().toISOString().slice(0, 10);
const outDir = flag('--out') ? resolve(flag('--out')) : resolve(siteRoot, '..', 'exports', today);

// ---------- read
const sb = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let q = sb.from('findings').select('*').order('num', { ascending: true });
if (since) q = q.gte('created_at', since + 'T00:00:00Z');
const { data: rows, error } = await q;
if (error) fail('Could not read findings: ' + error.message);
if (!rows.length) { console.log(since ? `No findings since ${since}. Nothing written.` : 'No findings yet. Nothing written.'); process.exit(0); }

await mkdir(outDir, { recursive: true });

// ---------- screenshots
const pad = String(rows.length).length > 2 ? 3 : 2;
const out = [];
let shots = 0, missing = 0;
for (const r of rows) {
  const file = r.screenshot_path
    ? `${String(r.num).padStart(pad, '0')}-${slug(r.screen) || 'screen'}-${r.phone || 'phone'}.${extOf(r.screenshot_path)}`
    : null;
  if (file) {
    const { data: blob, error: e2 } = await sb.storage.from('screenshots').download(r.screenshot_path);
    if (e2 || !blob) { missing++; console.warn(`  ! #${r.num}: screenshot ${r.screenshot_path} could not be downloaded (${e2 ? e2.message : 'empty'})`); }
    else { await writeFile(join(outDir, file), Buffer.from(await blob.arrayBuffer())); shots++; }
  }
  out.push({
    num: r.num, screen: r.screen || '', phone: r.phone, role: r.role, severity: r.severity, status: r.status, build: r.build,
    createdAt: r.created_at, screenshot: r.screenshot_path, id: r.id, note: r.note, file,
    tester: r.tester, step: r.step || '', reply: r.reply || '', fixedAt: r.fixed_at
  });
}

// ---------- findings.json
await writeFile(join(outDir, 'findings.json'), JSON.stringify(out, null, 2) + '\n');

// ---------- findings.md
const SEV = { blocks: 'Blocks me', wrong: 'Wrong', looks: 'Looks off' };
const PHONE = { android: 'Android', iphone: 'iPhone' };
const STATUS = { open: 'open', fixed: 'fixed', cannot: 'could not reproduce', notbug: 'not a bug' };
const builds = [...new Set(out.map((r) => r.build))];
const md = [];
md.push(`# Final QA findings — export of ${longDate(today)} (build${builds.length > 1 ? 's' : ''} ${builds.join(', ')})`);
md.push('');
md.push(`Source: qa.bellyrubs.co.in (Supabase project bellyrubs-qa). This is an offline copy; the site is the live record.${since ? ` Only findings logged on or after ${since}.` : ''}`);
md.push('');
for (const r of out) {
  md.push(`## #${r.num} · ${r.screen || 'Screen not named'} · ${PHONE[r.phone] || r.phone || ''} · ${SEV[r.severity] || r.severity || ''} · ${STATUS[r.status] || r.status}`);
  const bits = [];
  bits.push(r.file ? `Screenshot: \`${r.file}\`` : 'No screenshot');
  bits.push(`logged ${utc(r.createdAt)}`);
  bits.push(`by ${r.tester}`);
  if (r.step) bits.push(`step ${r.step}`);
  if (r.fixedAt) bits.push(`fixed ${utc(r.fixedAt)}`);
  md.push(bits.join(' · '));
  md.push('');
  md.push(r.note);
  if (r.reply) { md.push(''); md.push(`> Cowork: ${r.reply}`); }
  md.push('');
}
await writeFile(join(outDir, 'findings.md'), md.join('\n'));

console.log(`Wrote ${out.length} finding${out.length === 1 ? '' : 's'}, ${shots} screenshot${shots === 1 ? '' : 's'}${missing ? ` (${missing} missing)` : ''} to`);
console.log('  ' + outDir);

// ---------- helpers
function slug(s) { return String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60); }
function extOf(path) { const m = /\.(png|jpe?g|webp)$/i.exec(path || ''); return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'png'; }
function utc(iso) { const d = new Date(iso); return isNaN(d) ? '' : d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; }
function longDate(ymd) { const d = new Date(ymd + 'T00:00:00Z'); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
function fail(msg) { console.error('export-findings: ' + msg); process.exit(1); }
