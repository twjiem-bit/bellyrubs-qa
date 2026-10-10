/* qa.bellyrubs.co.in — helpers shared by index.html (testers) and admin.html.
   Everything here is the private page's code, lifted out so both pages use
   one copy, plus the Supabase client, the random file name and the
   plain-words error messages. */
(function () {
  'use strict';

  const SEV = { blocks: ['Blocks me', 'bad'], wrong: ['Wrong', 'warn'], looks: ['Looks off', 'idle'] };
  const STATUS = { open: ['Open', 'now'], fixed: ['Fixed', 'ok'], cannot: ['Could not reproduce', 'idle'], notbug: ['Not a bug', 'idle'] };
  const PHONE = { android: 'Android', iphone: 'iPhone' };
  const ROLE = { customer: 'Customer', partner: 'Walker / Sitter', admin: 'Admin' };
  const BUCKET = 'screenshots';
  const NAME_RE = /^[0-9a-f]{32}\.(png|jpe?g|webp)$/;

  const $ = (id) => document.getElementById(id);
  function seg(el) { const b = el.querySelector('[aria-pressed="true"]'); return b ? b.dataset.v : null; }
  function setSeg(el, v) { el.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v))); }
  function wireSeg(el) { el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setSeg(el, b.dataset.v); }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function when(iso) { try { const d = new Date(iso); return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
  function pill(map, key) { const m = map[key] || [key, 'idle']; return '<span class="pill ' + m[1] + '">' + esc(m[0]) + '</span>'; }
  function readLocal(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function writeLocal(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private mode: fine */ } }
  function readJSON(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }

  // ---------- configuration + client
  const cfg = window.QA_CONFIG || {};
  function configured() {
    return !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY
      && !/YOUR-PROJECT/.test(cfg.SUPABASE_URL) && !/^PASTE/.test(cfg.SUPABASE_ANON_KEY));
  }
  let client = null;
  function getClient() {
    if (client) return client;
    if (!configured() || !window.supabase || typeof window.supabase.createClient !== 'function') return null;
    client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    return client;
  }
  function publicUrl(path) {
    if (!path) return '';
    return cfg.SUPABASE_URL.replace(/\/+$/, '') + '/storage/v1/object/public/' + BUCKET + '/' + encodeURIComponent(path);
  }

  // ---------- screenshots
  // Shrink very large screenshots so each one stays well inside the storage budget.
  async function shrinkIfLarge(file) {
    if (file.size < 4 * 1024 * 1024) return file;
    try {
      const bmp = await createImageBitmap(file);
      const max = 2000, s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
      return blob && blob.size < file.size ? blob : file;
    } catch (e) { return file; }
  }
  function isImage(file) { return !!file && /^image\/(png|jpeg|webp)$/.test(file.type); }
  function extFor(type) { return type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg'; }
  function randomName(type) {
    const a = new Uint8Array(16); crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('') + '.' + extFor(type);
  }

  // ---------- plain words for whatever went wrong
  function plain(err, fallback) {
    const msg = String((err && (err.message || err.error_description || err.error)) || err || '');
    if (/invalid_passcode/.test(msg)) return 'That passcode is not right. Check it and try again.';
    if (/passcode_not_set/.test(msg)) return 'The site is not switched on yet: the passcodes have not been set. Tell the founder.';
    if (/rate_limited/.test(msg)) return 'You have saved 30 findings in the last 10 minutes. Have a break; try again in a few minutes.';
    if (/tester_name_required/.test(msg)) return 'Type your name first.';
    if (/note_required/.test(msg)) return 'Write what is wrong first.';
    if (/build_required/.test(msg)) return 'The Build field is empty.';
    if (/field_too_long/.test(msg)) return 'The screen or step text is too long.';
    if (/bad_screenshot_path|row-level security|violates/.test(msg)) return 'The screenshot was refused by the server. Try once more.';
    if (/not_found/.test(msg)) return 'That finding is no longer there. Refresh the list.';
    if (/Payload too large|exceeded the maximum allowed size|413/.test(msg)) return 'That screenshot is over 20 MB. Save a smaller copy and try again.';
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) return 'Could not reach the server. Check the connection and try again.';
    if (/Could not find the function|PGRST202/.test(msg)) return 'The database is missing the functions. The founder needs to run qa-schema.sql.';
    if (/Invalid API key|JWT|401/.test(msg)) return 'config.js has the wrong project URL or key.';
    return (fallback || 'Something went wrong') + (msg ? ' (' + msg.slice(0, 140) + ')' : '') + '. Try once more.';
  }

  window.QA = {
    SEV, STATUS, PHONE, ROLE, BUCKET, NAME_RE,
    $, seg, setSeg, wireSeg, esc, when, pill, readLocal, writeLocal, readJSON,
    cfg, configured, getClient, publicUrl,
    shrinkIfLarge, isImage, extFor, randomName, plain
  };
})();
