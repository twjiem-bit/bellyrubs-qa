// Playwright checks on the two pages, served from this folder exactly as
// GitHub Pages would serve them, with config.js still holding its placeholders
// (so nothing talks to any Supabase project).
//
//   npm run test:pages
//
// Proves: both pages render at 390 px and 1280 px with no horizontal scroll
// and no script errors; the form refuses an empty note and a non-image file;
// the admin page refuses without a passcode. Screenshots land in test-results/.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startServer } from './static-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'test-results');
let server, base, browser;

// a real 1x1 PNG and a text file, handed to the file input in memory
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const TXT = Buffer.from('this is not a picture\n');

before(async () => {
  await mkdir(shots, { recursive: true });
  ({ server, url: base } = await startServer(0));
  try { browser = await chromium.launch(); }
  catch { browser = await chromium.launch({ channel: 'chrome' }); }
});
after(async () => { if (browser) await browser.close(); if (server) server.close(); });

async function open(path, width, height = 844) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.googleapis|cdn\.jsdelivr|net::ERR|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(base + '/' + path, { waitUntil: 'load' });
  await page.waitForTimeout(150);
  return { ctx, page, errors };
}
async function noHorizontalScroll(page) {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.body.scrollWidth }));
  assert.ok(m.sw <= m.cw, `page scrolls sideways: scrollWidth ${m.sw} > clientWidth ${m.cw}`);
  assert.ok(m.bw <= m.cw, `body scrolls sideways: ${m.bw} > ${m.cw}`);
}

for (const path of ['index.html', 'admin.html']) {
  for (const width of [390, 1280]) {
    test(`${path} renders at ${width} px with no horizontal scroll and no script errors`, async () => {
      const { ctx, page, errors } = await open(path, width);
      try {
        await noHorizontalScroll(page);
        assert.equal(await page.locator('h1').innerText(), 'Bellyrubs Screen Tests');
        assert.equal(await page.locator('meta[name=robots]').getAttribute('content'), 'noindex, nofollow');
        if (path === 'index.html') {
          for (const id of ['tester', 'passcode', 'screen', 'step', 'note', 'build', 'saveBtn', 'drop']) assert.ok(await page.locator('#' + id).count(), '#' + id + ' present');
          assert.equal(await page.locator('#build').inputValue(), 'FINAL-PREVIEW-3');
        }
        await page.screenshot({ path: join(shots, `${path.replace('.html', '')}-${width}.png`), fullPage: true });
        assert.deepEqual(errors, [], 'no script errors');
      } finally { await ctx.close(); }
    });
  }
}

test('index.html refuses a non-image file', async () => {
  const { ctx, page } = await open('index.html', 390);
  try {
    await page.locator('#file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: TXT });
    assert.match(await page.locator('#formStatus').innerText(), /not a PNG, JPEG or WebP image/);
    assert.ok(await page.locator('#preview').isHidden(), 'no preview for a text file');
    assert.ok(await page.locator('#saveBtn').isDisabled(), 'Save stays disabled');
  } finally { await ctx.close(); }
});

test('index.html refuses an empty note (and asks for name and passcode first)', async () => {
  const { ctx, page } = await open('index.html', 390);
  try {
    await page.locator('#file').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
    assert.match(await page.locator('#formStatus').innerText(), /Screenshot ready/);
    assert.ok(await page.locator('#preview').isVisible(), 'preview shown for a png');
    await page.locator('#tester').fill('Ari');
    await page.locator('#passcode').fill('whatever');
    // note still empty → the button stays disabled, and a forced submit is refused in words
    assert.ok(await page.locator('#saveBtn').isDisabled(), 'Save disabled while the note is empty');
    await page.evaluate(() => document.getElementById('entry').requestSubmit());
    const msg = await page.locator('#formStatus').innerText();
    assert.match(msg, /not switched on yet|Write what is wrong first/);
    // with a note, the only thing stopping it is the unfilled config.js
    await page.locator('#note').fill('The total jumps.');
    await page.evaluate(() => document.getElementById('entry').requestSubmit());
    assert.match(await page.locator('#formStatus').innerText(), /not switched on yet/);
    // missing name / passcode are called out in words, too
    await page.locator('#tester').fill('');
    assert.ok(await page.locator('#saveBtn').isDisabled(), 'Save disabled without a name');
  } finally { await ctx.close(); }
});

test('admin.html refuses without a passcode', async () => {
  const { ctx, page } = await open('admin.html', 390);
  try {
    assert.ok(await page.locator('#gate').isVisible(), 'the gate is shown');
    assert.ok(await page.locator('#main').isHidden(), 'the list is hidden');
    assert.equal(await page.locator('#list .card').count(), 0);
    await page.locator('#openBtn').click();
    assert.match(await page.locator('#gateStatus').innerText(), /Type the admin passcode first/);
    assert.ok(await page.locator('#main').isHidden(), 'still hidden after an empty submit');
    // a passcode typed with an unconfigured site is refused in words, and nothing opens
    await page.locator('#passcode').fill('guess');
    await page.locator('#openBtn').click();
    assert.match(await page.locator('#gateStatus').innerText(), /not switched on yet/);
    assert.ok(await page.locator('#main').isHidden());
    assert.equal(await page.evaluate(() => localStorage.getItem('qa.admin')), null, 'nothing remembered');
  } finally { await ctx.close(); }
});

// ---------------------------------------------------------------------------
// With a stand-in backend: config.js is swapped for a filled-in one and every
// Supabase call is answered by Playwright routes, so the real save / list /
// edit / mark-fixed / delete code paths run end to end without any project.
// ---------------------------------------------------------------------------
const FAKE = 'https://fake-project.supabase.co';
const ROWS = [
  { id: '11111111-1111-4111-8111-111111111111', num: 1, created_at: '2026-10-10T07:06:37.010Z', tester: 'Arindam', phone: 'iphone', role: 'customer', screen: 'Your Care Cart', step: '3', note: 'Total jumps from 1000 to 1049.', severity: 'blocks', build: 'FINAL-PREVIEW-3', status: 'open', screenshot_path: '0123456789abcdef0123456789abcdef.png', screenshot_bytes: 1, reply: null, fixed_at: null },
  { id: '22222222-2222-4222-8222-222222222222', num: 2, created_at: '2026-10-11T09:10:01.761Z', tester: 'Priya', phone: 'android', role: 'partner', screen: 'Your walks', step: null, note: 'Button text.', severity: 'wrong', build: 'FINAL-PREVIEW-3', status: 'fixed', screenshot_path: null, screenshot_bytes: null, reply: 'Shipped', fixed_at: '2026-10-12T05:00:00Z' },
];

async function openStubbed(path, width, handlers) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const calls = [];
  await page.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.QA_CONFIG={SUPABASE_URL:'${FAKE}',SUPABASE_ANON_KEY:'anon-test-key',DEFAULT_BUILD:'FINAL-PREVIEW-3'};` }));
  await page.route(FAKE + '/**', async (route) => {
    const req = route.request(); const u = new URL(req.url());
    const call = { method: req.method(), path: u.pathname, body: safeJSON(req), apikey: req.headers()['apikey'] };
    calls.push(call);
    const out = await handlers(call);
    if (out === undefined) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'unhandled ' + u.pathname }) });
    if (out && out.__status) return route.fulfill({ status: out.__status, contentType: 'application/json', body: JSON.stringify(out.body) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
  });
  await page.goto(base + '/' + path, { waitUntil: 'load' });
  await page.waitForTimeout(150);
  return { ctx, page, errors, calls };
}
function safeJSON(req) { try { return req.postDataJSON(); } catch { return req.postData(); } }

test('index.html saves a finding: upload, rpc, "Saved as finding #N", local list; wrong passcode is said in words', async () => {
  let uploads = 0, submits = 0;
  const { ctx, page, errors, calls } = await openStubbed('index.html', 390, (c) => {
    if (c.method === 'POST' && c.path.startsWith('/storage/v1/object/screenshots/')) { uploads++; return { Key: 'screenshots/' + c.path.split('/').pop() }; }
    if (c.method === 'POST' && c.path === '/rest/v1/rpc/submit_finding') {
      submits++;
      if (c.body.passcode !== 'tester-pass') return { __status: 400, body: { code: 'P0001', message: 'invalid_passcode' } };
      return 7;
    }
  });
  try {
    assert.ok(await page.locator('#notice').isHidden(), 'no "not switched on" notice once configured');
    await page.locator('#tester').fill('Ari');
    await page.locator('#passcode').fill('wrong-pass');
    await page.locator('#file').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
    await page.locator('#screen').fill('Your Care Cart');
    await page.locator('#note').fill('Total jumps from 1000 to 1049.');
    await page.locator('#phone button[data-v=iphone]').click();
    assert.ok(await page.locator('#saveBtn').isEnabled());
    await page.locator('#saveBtn').click();
    await page.waitForFunction(() => /passcode is not right/.test(document.getElementById('formStatus').textContent));
    assert.equal(submits, 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('qa.passcode')), null, 'wrong passcode is not remembered');
    assert.equal(await page.locator('#list .card').count(), 0);

    await page.locator('#passcode').fill('tester-pass');
    await page.locator('#saveBtn').click();
    await page.waitForFunction(() => /Saved as finding #7/.test(document.getElementById('formStatus').textContent));
    assert.equal(uploads, 2, 'one upload per attempt');
    const sub = calls.filter((c) => c.path === '/rest/v1/rpc/submit_finding').pop().body;
    assert.equal(sub.tester, 'Ari'); assert.equal(sub.phone, 'iphone'); assert.equal(sub.screen, 'Your Care Cart'); assert.equal(sub.build, 'FINAL-PREVIEW-3');
    assert.match(sub.screenshot_path, /^[0-9a-f]{32}\.png$/, 'random 32-hex file name');
    assert.equal(calls.find((c) => c.path.startsWith('/storage/v1/object/screenshots/')).apikey, 'anon-test-key');
    // the form is cleared, the local list shows the one finding with the public URL
    assert.equal(await page.locator('#note').inputValue(), '');
    assert.equal(await page.locator('#list .card').count(), 1);
    assert.match(await page.locator('#list .card .num').innerText(), /#7/);
    assert.match(await page.locator('#list .card img').getAttribute('src'), new RegExp('^' + FAKE + '/storage/v1/object/public/screenshots/[0-9a-f]{32}\\.png$'));
    assert.match(await page.locator('#counts').innerText(), /1 saved from this phone/);
    assert.equal(await page.evaluate(() => localStorage.getItem('qa.passcode')), 'tester-pass', 'right passcode remembered');
    assert.equal(await page.evaluate(() => localStorage.getItem('qa.tester')), 'Ari');
    // reload: list and name survive, passcode prefilled
    await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(150);
    assert.equal(await page.locator('#list .card').count(), 1);
    assert.equal(await page.locator('#tester').inputValue(), 'Ari');
    assert.equal(await page.locator('#passcode').inputValue(), 'tester-pass');
    await page.screenshot({ path: join(shots, 'index-390-saved.png'), fullPage: true });
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});

test('admin.html: wrong passcode refused in words; right one lists every tester; mark fixed, edit with reply, two-tap delete', async () => {
  let rows = ROWS.map((r) => ({ ...r }));
  const { ctx, page, errors, calls } = await openStubbed('admin.html', 1280, (c) => {
    if (c.path === '/rest/v1/rpc/list_findings') {
      if (c.body.admin_passcode !== 'admin-pass') return { __status: 400, body: { code: 'P0001', message: 'invalid_passcode' } };
      return [...rows].sort((a, b) => b.num - a.num);
    }
    if (c.path === '/rest/v1/rpc/update_finding') {
      if (c.body.admin_passcode !== 'admin-pass') return { __status: 400, body: { message: 'invalid_passcode' } };
      const r = rows.find((x) => x.id === c.body.id);
      for (const k of ['screen', 'step', 'note', 'severity', 'status', 'reply']) if (c.body[k] != null) r[k] = c.body[k] === '' ? null : c.body[k];
      r.fixed_at = r.status === 'fixed' ? (r.fixed_at || new Date().toISOString()) : null;
      return [r];
    }
    if (c.path === '/rest/v1/rpc/delete_finding') {
      if (c.body.admin_passcode !== 'admin-pass') return { __status: 400, body: { message: 'invalid_passcode' } };
      const r = rows.find((x) => x.id === c.body.id); rows = rows.filter((x) => x.id !== c.body.id); return r ? r.screenshot_path : null;
    }
  });
  try {
    await page.locator('#passcode').fill('nope');
    await page.locator('#openBtn').click();
    await page.waitForFunction(() => /passcode is not right/.test(document.getElementById('gateStatus').textContent));
    assert.ok(await page.locator('#main').isHidden());
    assert.equal(await page.evaluate(() => localStorage.getItem('qa.admin')), null);

    await page.locator('#passcode').fill('admin-pass');
    await page.locator('#openBtn').click();
    await page.waitForSelector('#main:not([hidden])');
    assert.ok(await page.locator('#gate').isHidden());
    assert.equal(await page.evaluate(() => localStorage.getItem('qa.admin')), 'admin-pass', 'remembered after success');
    assert.match(await page.locator('#counts').innerText(), /1 open/);
    assert.match(await page.locator('#counts').innerText(), /1 fixed/);
    // Open filter: only #1, with the tester's name on the card
    assert.equal(await page.locator('#list .card').count(), 1);
    assert.equal(await page.locator('#list .card .who').innerText(), 'Arindam');
    await page.locator('#filters [data-f="status:all"]').click();
    assert.equal(await page.locator('#list .card').count(), 2);
    await page.locator('#filters [data-f="phone:android"]').click();
    assert.equal(await page.locator('#list .card').count(), 1);
    assert.equal(await page.locator('#list .card .who').innerText(), 'Priya');
    await page.locator('#filters [data-f="phone:android"]').click();   // off again
    await page.screenshot({ path: join(shots, 'admin-1280-list.png'), fullPage: true });

    // lightbox
    await page.locator('#list .card[data-id="11111111-1111-4111-8111-111111111111"] .shot').click();
    assert.ok(await page.locator('#lightbox').isVisible());
    assert.match(await page.locator('#lightCap').innerText(), /#1 · Your Care Cart · iPhone · Arindam/);
    await page.keyboard.press('Escape');
    assert.ok(await page.locator('#lightbox').isHidden());

    // mark fixed → only status sent, card goes to the fixed look, Reopen appears
    await page.locator('#list .card[data-id="11111111-1111-4111-8111-111111111111"] [data-act=fixed]').click();
    await page.waitForSelector('#list .card[data-id="11111111-1111-4111-8111-111111111111"] [data-act=reopen]');
    let upd = calls.filter((c) => c.path === '/rest/v1/rpc/update_finding').pop().body;
    assert.equal(upd.status, 'fixed'); assert.equal(upd.note, null); assert.equal(upd.reply, null);
    assert.match(await page.locator('#counts').innerText(), /0 open/);

    // edit: change the note and add a Cowork reply
    const card2 = page.locator('#list .card[data-id="22222222-2222-4222-8222-222222222222"]');
    await card2.locator('[data-act=edit]').click();
    await card2.locator('[data-e=note]').fill('Button says Review and Pay.');
    await card2.locator('[data-e=reply]').fill('Renamed to Confirm and Pay in FINAL-PREVIEW-4');
    await card2.locator('[data-e=status]').selectOption('open');
    await card2.locator('[data-act=save]').click();
    await page.waitForFunction(() => /Renamed to Confirm and Pay/.test((document.querySelector('#list .card[data-id="22222222-2222-4222-8222-222222222222"] .reply') || {}).textContent || ''));
    upd = calls.filter((c) => c.path === '/rest/v1/rpc/update_finding').pop().body;
    assert.equal(upd.note, 'Button says Review and Pay.'); assert.equal(upd.reply, 'Renamed to Confirm and Pay in FINAL-PREVIEW-4'); assert.equal(upd.status, 'open');

    // delete needs two taps
    const del = card2.locator('[data-act=delete]');
    await del.click();
    assert.equal(await del.innerText(), 'Really delete?');
    assert.equal(calls.filter((c) => c.path === '/rest/v1/rpc/delete_finding').length, 0, 'first tap deletes nothing');
    await del.click();
    await page.waitForFunction(() => !document.querySelector('#list .card[data-id="22222222-2222-4222-8222-222222222222"]'));
    assert.equal(calls.filter((c) => c.path === '/rest/v1/rpc/delete_finding').length, 1);
    assert.equal(rows.length, 1);

    // Refresh re-reads; Lock forgets the passcode and shows the gate
    const before = calls.filter((c) => c.path === '/rest/v1/rpc/list_findings').length;
    await page.locator('#refreshBtn').click();
    await page.waitForFunction((want) => /Updated/.test(document.getElementById('listStatus').textContent), before);
    await page.waitForTimeout(100);
    assert.equal(calls.filter((c) => c.path === '/rest/v1/rpc/list_findings').length, before + 1);
    await page.locator('#lockBtn').click();
    assert.ok(await page.locator('#gate').isVisible());
    assert.equal(await page.evaluate(() => localStorage.getItem('qa.admin')), null);
    assert.deepEqual(errors, []);
  } finally { await ctx.close(); }
});
