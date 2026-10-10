# QA site build report — qa.bellyrubs.co.in — 10 Oct 2026

## First screen, in plain words

The public testing page is built and sits in `Project Review\Final QA Testing\qa-site\`. It looks and works like your private Bellyrubs Screen Tests page, with two additions on the tester side (your name, a tester passcode) and a separate admin page for Cowork behind an admin passcode. Nothing in it touches the Bellyrubs product or its database: it is a plain static site plus a Supabase project of its own that only you can create. Until you create that project and fill in `config.js`, both pages open fine but say "not switched on yet" and save nothing.

Everything that can be proven without your project has been proven and passes: the SQL file was loaded into a scratch Postgres and every rule held (anon locked out, wrong passcode refused on all four functions, right passcode inserts/lists/updates/deletes, rate limit trips at the 31st finding); both pages render at phone and desktop width with no sideways scroll; the form refuses an empty note and a non-image file; the admin page refuses without a passcode; and the whole save, list, edit, mark-fixed, delete flow runs end to end against a stand-in server. The export script was run against a stand-in too and produced the same folder shape as `exports\2026-10-10\`.

What is left is yours: the ten numbered steps in `SETUP.md` (create the project, paste the SQL, set the passcodes, fill `config.js`, create the repo and push after Cowork's review, Pages, the GoDaddy CNAME, a test from your phone). One thing can only be confirmed on the real project: that a screenshot upload works with the upload-only storage rule. It is the documented Supabase pattern, so it should; if your phone test says "refused by the server", the one-line fix is in the "could not verify" list below.

Nothing has been pushed. The repo is initialised locally with one commit, for Cowork to review.

## What was built

**Pages.** `index.html` is the private page's entry form plus *Your name* (required, remembered on the phone) and *Tester passcode* (remembered after the first successful save; forgotten again if it is ever refused). Save compresses images over 4 MB the same way the private page does, uploads to `screenshots/<32 random hex>.<ext>`, calls `submit_finding`, shows "Saved as finding #N", and adds the finding to a list kept in that browser only, with the thumbnail from the public link. There is no way to see anyone else's findings on this page. `admin.html` asks for the admin passcode once, then shows the full list exactly like the private page, with the tester's name on each card, Open/Fixed/All, Android/iPhone, lightbox, Edit (with a *Cowork reply* field), Mark fixed/Reopen, Delete with the two-tap confirm, a Refresh button, a Lock button, and an auto-refresh every 60 s that pauses while a card is being edited. Both pages carry `noindex, nofollow`, load supabase-js from jsdelivr pinned to 2.117.2, and share `qa.css` (the private page's tokens, unchanged) and `qa-shared.js`.

**Database.** `supabase/qa-schema.sql`, one idempotent file with a plain-words header and a VERIFY table at the end. Tables `findings` and `qa_config` with RLS on and no anon policies, plus the default anon grants revoked so a direct attempt says "permission denied" rather than returning nothing. Four `security definer` functions with `search_path = public`, EXECUTE granted to anon and authenticated, each checking the passcode first and raising `invalid_passcode`; while a passcode is still the `CHANGE-ME` placeholder they raise `passcode_not_set` instead, so a half-finished setup fails loudly. `submit_finding` also validates lengths, the screenshot name pattern, and refuses the 31st finding from one tester name in 10 minutes. The storage section creates the public `screenshots` bucket (20 MB cap, image types only) and a single INSERT policy for names matching `^[0-9a-f]{32}\.(png|jpe?g|webp)$`; there is deliberately no SELECT policy (a public bucket serves by exact path without one, and without one the bucket cannot be listed) and no UPDATE or DELETE policy. One addition beyond the brief: a bucket-wide brake of 200 new files per 10 minutes, because the anon key is public and the bucket must accept uploads before any passcode can be checked. The storage section skips itself with a notice where the storage schema does not exist, which is how the same file runs in the local test.

**Export.** `scripts/export-findings.mjs` (`npm run export`) reads with the service-role key from gitignored `scripts/.env`, downloads every screenshot, and writes `..\exports\<YYYY-MM-DD>\findings.md`, `findings.json` and `NN-<screen-slug>-<phone>.<ext>`. `--since YYYY-MM-DD` and `--out <dir>` are the flags. The JSON keeps every key of the existing export and adds `tester`, `step`, `reply`, `fixedAt`.

**Deviations worth knowing.** (1) Screenshot files in the export keep their real extension (`.jpg` for a compressed upload) instead of always `.png`, because a JPEG named `.png` would mislead anyone opening it; the existing export happened to be all PNG. (2) GIF is not accepted by the form, because the bucket rule in the brief allows only PNG, JPEG and WebP. (3) Deleting a finding removes the row but leaves its file in the bucket, since the public key may not delete objects; the orphan is harmless (random name, nothing links to it) and can be cleared from the Storage tab. (4) On the tester page the status filters are gone: a tester cannot read status changes, so Open/Fixed would be meaningless there; the phone chips remain.

## Proof

| Check | How | Result |
|-------|-----|--------|
| `node --check` on every script | `npm run check`: 9 files, including both pages' inline scripts | 9 ok, 0 failed |
| Schema rules | `npm run test:schema`: `qa_scratch` on the local Postgres 17 (Supabase stack, port 54322), SQL run twice, dropped after | 7 tests pass |
| — anon cannot select/insert/update/delete `findings`, read `qa_config`, use the sequence or the helper | role switch to `anon` | permission denied each time |
| — wrong passcode refused on every function; tester passcode does not open the admin list | | `invalid_passcode` each time |
| — placeholders refused | | `passcode_not_set` each time |
| — right passcode inserts, lists newest-first, updates (fixed_at stamped and cleared), deletes | also through the `anon` role | pass |
| — rate limit | 30 inserts ok, 31st `rate_limited`, other tester unaffected, window expiry releases | pass |
| Pages at 390 px and 1280 px | Playwright, Chromium, static server | no sideways scroll, no script errors, screenshots in `test-results/` |
| Form refuses empty note / non-image | | pass |
| Admin refuses without a passcode | | pass |
| Full flows against a stubbed backend | wrong passcode in words, save → #7, local list + reload, admin list/filters/lightbox/mark fixed/edit+reply/two-tap delete/refresh/lock | pass |
| Export shape | script run against a stand-in Supabase server, `--since`, bad date, bad key | files and text match the existing export's shape |

The scratch database was confirmed dropped. The local product database was not read or written; the only thing shared with it was the Postgres server process.

## Could not verify (needs your project)

1. **Upload with an INSERT-only storage policy.** This is the pattern in Supabase's own docs, but it was not exercised against a real storage service. If the phone test says "The screenshot was refused by the server", run this once in the SQL editor and try again; it lets the key read back only the row it has just written, and still does not allow listing:
   `create policy "qa screenshots: read own name pattern" on storage.objects for select to anon, authenticated using (bucket_id = 'screenshots' and name ~ '^[0-9a-f]{32}\.(png|jpe?g|webp)$');`
   (Cowork should then also decide whether listing-by-pattern matters; the names are random and carry nothing.)
2. **Bucket creation from SQL.** Hosted projects allow `insert into storage.buckets` from the editor; if yours does not, `SETUP.md` step 4 creates it by hand.
3. **Fonts and the CDN on a phone.** The pages load Google Fonts and supabase-js from jsdelivr; both pinned, both ordinary.

## How the work was done

Plain agents: none. The main Claude Code session did every step itself; no `agent(` call was made and no workflow script was run, so there are no journals to commit. The session model is the one Cowork launched it with.

## PENDING FOUNDER RULINGS (built on the defaults)

1. Separate QA Supabase project named `bellyrubs-qa` in Mumbai — default **yes**, built that way.
2. Screenshots public by exact link, bucket never listable — default **yes**, built that way.
3. Passcodes instead of accounts (one tester passcode, one admin passcode, both in `qa_config`) — default **yes**, built that way.
4. Keep the private claude.ai page in parallel, Cowork merges — default **yes**; the export writes to the same `exports\` folder in the same shape so the two sources merge by hand or by Cowork.
5. New from this round: the bucket-wide brake of 200 uploads per 10 minutes — keep, raise, or drop.
6. New from this round: GIF not accepted on the public form — keep (the bucket rule from the brief) or widen the rule.

## Files

```
qa-site/
  index.html  admin.html  config.js  qa.css  qa-shared.js
  CNAME  .nojekyll  robots.txt  .gitignore  package.json  package-lock.json
  SETUP.md  README.md
  supabase/qa-schema.sql
  scripts/export-findings.mjs  scripts/check-syntax.mjs  scripts/.env.example
  tests/schema.test.mjs  tests/pages.test.mjs  tests/static-server.mjs
  docs/qa-site-build-report-2026-10-10.md
```

Also touched outside the folder: one paragraph appended to `..\README-how-we-test.md` under "The public page (qa.bellyrubs.co.in)". Nothing in the product repo, nothing in any database, nothing pushed.
