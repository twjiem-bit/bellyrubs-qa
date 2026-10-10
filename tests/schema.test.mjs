// Loads supabase/qa-schema.sql into a scratch database on a local Postgres and
// proves the security rules hold. The scratch database `qa_scratch` is created
// at the start and dropped at the end; nothing else on the server is touched.
//
//   npm run test:schema
//   QA_TEST_PG=postgresql://user:pass@host:port/postgres npm run test:schema
//
// Default connection: the local Supabase stack's Postgres (port 54322). The
// server must already have the roles `anon` and `authenticated`; a Supabase
// Postgres does. On a plain Postgres the test creates them (NOLOGIN).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_URL = process.env.QA_TEST_PG || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SCRATCH = 'qa_scratch';
const TESTER = 'tester-pass-123';
const ADMIN = 'admin-pass-456';
const GOOD_PATH = '0123456789abcdef0123456789abcdef.png';

let admin;   // connection to the maintenance DB
let db;      // connection to qa_scratch

function scratchUrl() { const u = new URL(ADMIN_URL); u.pathname = '/' + SCRATCH; return u.toString(); }
async function rejects(promise, re) {
  let err = null;
  try { await promise; } catch (e) { err = e; }
  assert.ok(err, 'expected the call to be refused');
  assert.match(String(err.message), re);
  return err;
}
async function asAnon(sql, params) {
  // run one statement as the anon role, then step back
  const c = await db.connect();
  try { await c.query('set role anon'); return await c.query(sql, params); }
  finally { try { await c.query('reset role'); } catch { /* ignore */ } c.release(); }
}
const submit = (passcode, tester, extra = {}) => db.query(
  'select public.submit_finding($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as num',
  [passcode, tester, extra.phone ?? 'iphone', extra.role ?? 'customer', extra.screen ?? 'Your Care Cart', extra.step ?? '3',
   extra.note ?? 'The total jumps from 1000 to 1049.', extra.severity ?? 'blocks', extra.build ?? 'FINAL-PREVIEW-3',
   'screenshot_path' in extra ? extra.screenshot_path : GOOD_PATH, extra.screenshot_bytes ?? 123456]
).then((r) => r.rows[0].num);
const list = (passcode) => db.query('select * from public.list_findings($1)', [passcode]).then((r) => r.rows);

before(async () => {
  admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [SCRATCH]);
  await admin.query(`drop database if exists ${SCRATCH}`);
  await admin.query(`create database ${SCRATCH}`);
  for (const role of ['anon', 'authenticated']) {
    await admin.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$`);
  }
  db = new pg.Pool({ connectionString: scratchUrl(), max: 3 });
  const sql = await readFile(join(root, 'supabase', 'qa-schema.sql'), 'utf8');
  await db.query(sql);            // first run
  await db.query(sql);            // second run: must be idempotent
});

after(async () => {
  if (db) await db.end();
  if (admin) {
    await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [SCRATCH]);
    await admin.query(`drop database if exists ${SCRATCH}`);
    await admin.end();
  }
});

test('the VERIFY block reports what we expect', async () => {
  const sql = await readFile(join(root, 'supabase', 'qa-schema.sql'), 'utf8');
  const results = await db.query(sql);
  const last = Array.isArray(results) ? results[results.length - 1] : results;
  const rows = last.rows.map((r) => `${r.kind}|${r.name}|${r.detail}`);
  assert.ok(rows.includes('table|findings|RLS on'));
  assert.ok(rows.includes('table|qa_config|RLS on'));
  assert.ok(!rows.some((r) => r.startsWith('policy on public table|')), 'no policies on public tables');
  for (const f of ['submit_finding', 'list_findings', 'update_finding', 'delete_finding', 'qa_passcode_ok']) {
    assert.ok(rows.includes(`function|${f}|security definer`), f + ' is security definer');
  }
});

test('every function refuses while the passcodes are still the placeholders', async () => {
  await rejects(submit('anything', 'Ari'), /passcode_not_set/);
  await rejects(list('anything'), /passcode_not_set/);
  await rejects(db.query('select * from public.update_finding($1, gen_random_uuid(), null,null,null,null,$2,null)', ['x', 'fixed']), /passcode_not_set/);
  await rejects(db.query('select public.delete_finding($1, gen_random_uuid())', ['x']), /passcode_not_set/);
  // now set them for the rest of the tests
  await db.query(`update public.qa_config set value = $1 where key = 'tester_passcode'`, [TESTER]);
  await db.query(`update public.qa_config set value = $1 where key = 'admin_passcode'`, [ADMIN]);
});

test('anon cannot touch the tables directly', async () => {
  await rejects(asAnon('select * from public.findings'), /permission denied for table findings/);
  await rejects(asAnon(`insert into public.findings (tester, note, build) values ('x','y','z')`), /permission denied for table findings/);
  await rejects(asAnon(`update public.findings set status = 'fixed'`), /permission denied for table findings/);
  await rejects(asAnon('delete from public.findings'), /permission denied for table findings/);
  await rejects(asAnon('select * from public.qa_config'), /permission denied for table qa_config/);
  await rejects(asAnon(`select nextval('public.findings_num_seq')`), /permission denied for sequence/);
  await rejects(asAnon(`select public.qa_passcode_ok('admin_passcode', 'x')`), /permission denied for function qa_passcode_ok/);
});

test('the wrong passcode is refused on every function', async () => {
  await rejects(submit('wrong', 'Ari'), /invalid_passcode/);
  await rejects(submit('', 'Ari'), /invalid_passcode/);
  await rejects(submit(null, 'Ari'), /invalid_passcode/);
  await rejects(list('wrong'), /invalid_passcode/);
  await rejects(list(TESTER), /invalid_passcode/);                 // tester passcode does not open the admin list
  await rejects(db.query('select * from public.update_finding($1, gen_random_uuid(), null,null,null,null,$2,null)', ['wrong', 'fixed']), /invalid_passcode/);
  await rejects(db.query('select public.delete_finding($1, gen_random_uuid())', ['wrong']), /invalid_passcode/);
});

test('the right passcode inserts, lists, updates and deletes — also through the anon role', async () => {
  const n1 = await submit(TESTER, 'Ari');
  assert.equal(n1, 1);
  const n2 = await submit(ADMIN, 'Priya', { phone: 'android', role: 'partner', screen: 'Your walks', step: '', screenshot_path: null, screenshot_bytes: null });
  assert.equal(n2, 2);
  // the page calls through the anon role: the function must still work there
  const viaAnon = await asAnon('select public.submit_finding($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as num',
    [TESTER, 'Ravi', 'iphone', 'customer', 'Pay', '9', 'Button says Review and Pay', 'wrong', 'FINAL-PREVIEW-3', GOOD_PATH.replace('.png', '.jpg'), 1000]);
  assert.equal(viaAnon.rows[0].num, 3);

  let rows = await list(ADMIN);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.num), [3, 2, 1], 'newest first');
  assert.equal(rows[2].tester, 'Ari');
  assert.equal(rows[2].status, 'open');
  assert.equal(rows[2].screenshot_path, GOOD_PATH);
  assert.equal(rows[1].step, null, 'empty step stored as null');
  const anonList = await asAnon('select num from public.list_findings($1)', [ADMIN]);
  assert.equal(anonList.rows.length, 3);

  // update: mark fixed with a reply, everything else untouched
  const id1 = rows[2].id;
  let u = await db.query('select * from public.update_finding($1,$2,null,null,null,null,$3,$4)', [ADMIN, id1, 'fixed', 'Shipped in FINAL-PREVIEW-4']);
  assert.equal(u.rows[0].status, 'fixed');
  assert.ok(u.rows[0].fixed_at, 'fixed_at stamped');
  assert.equal(u.rows[0].reply, 'Shipped in FINAL-PREVIEW-4');
  assert.equal(u.rows[0].note, 'The total jumps from 1000 to 1049.', 'note untouched when null passed');
  // reopen clears fixed_at; edit text + severity
  u = await db.query('select * from public.update_finding($1,$2,$3,$4,$5,$6,$7,$8)', [ADMIN, id1, 'Care Cart', '4', 'Edited note', 'wrong', 'open', '']);
  assert.equal(u.rows[0].status, 'open');
  assert.equal(u.rows[0].fixed_at, null);
  assert.equal(u.rows[0].screen, 'Care Cart');
  assert.equal(u.rows[0].step, '4');
  assert.equal(u.rows[0].note, 'Edited note');
  assert.equal(u.rows[0].severity, 'wrong');
  assert.equal(u.rows[0].reply, null, 'empty reply clears it');
  await rejects(db.query('select * from public.update_finding($1,$2,null,null,null,null,$3,null)', [ADMIN, id1, 'bogus']), /violates check constraint/);
  await rejects(db.query('select * from public.update_finding($1, gen_random_uuid(), null,null,null,null,null,null)', [ADMIN]), /not_found/);

  // delete returns the screenshot path and removes the row
  const d = await db.query('select public.delete_finding($1,$2) as path', [ADMIN, id1]);
  assert.equal(d.rows[0].path, GOOD_PATH);
  await rejects(db.query('select public.delete_finding($1,$2)', [ADMIN, id1]), /not_found/);
  rows = await list(ADMIN);
  assert.deepEqual(rows.map((r) => r.num), [3, 2]);
});

test('submit validates its inputs', async () => {
  await rejects(submit(TESTER, ''), /tester_name_required/);
  await rejects(submit(TESTER, 'Ari', { note: '   ' }), /note_required/);
  await rejects(submit(TESTER, 'Ari', { build: '' }), /build_required/);
  await rejects(submit(TESTER, 'Ari', { screenshot_path: '../etc/passwd' }), /bad_screenshot_path/);
  await rejects(submit(TESTER, 'Ari', { screenshot_path: 'ABCDEF0123456789ABCDEF0123456789.png' }), /bad_screenshot_path/);
  await rejects(submit(TESTER, 'Ari', { screenshot_path: '0123456789abcdef0123456789abcdef.gif' }), /bad_screenshot_path/);
  await rejects(submit(TESTER, 'Ari', { phone: 'blackberry' }), /violates check constraint/);
  await rejects(submit(TESTER, 'Ari', { severity: 'meh' }), /violates check constraint/);
});

test('the rate limit trips at the 31st finding from one tester name in 10 minutes', async () => {
  for (let i = 1; i <= 30; i++) await submit(TESTER, 'Rapid', { note: 'finding ' + i });
  await rejects(submit(TESTER, 'Rapid', { note: 'finding 31' }), /rate_limited/);
  await rejects(submit(TESTER, '  Rapid  ', { note: 'trimmed name counts as the same tester' }), /rate_limited/);
  // another tester is not affected
  const n = await submit(TESTER, 'Someone else', { note: 'still fine' });
  assert.ok(n > 30);
  // and once the window has passed the same tester may continue
  await db.query(`update public.findings set created_at = created_at - interval '11 minutes' where tester = 'Rapid'`);
  const again = await submit(TESTER, 'Rapid', { note: 'after the window' });
  assert.ok(again > n);
});
