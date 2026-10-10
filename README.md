# bellyrubs-qa — qa.bellyrubs.co.in

The public screen-by-screen testing page for the Bellyrubs final-preview builds. Testers drop a screenshot, say which phone and screen, write what is wrong. Cowork reads every tester's findings on the admin page, replies, marks fixed. Same look and fields as the founder's private "Bellyrubs Screen Tests" page on claude.ai; only the storage underneath is different.

**Not switched on yet.** `config.js` still has placeholders. `SETUP.md` is the founder's numbered walk-through: create the Supabase project, paste the SQL, set passcodes, fill `config.js`, push, Pages, DNS.

## What is here

| Path | What it is |
|------|-----------|
| `index.html` | Testers' page: the entry form, "Saved as finding #N", a list of this phone's own findings. Needs the tester passcode. |
| `admin.html` | Cowork's page: every finding, Open/Fixed/All, Android/iPhone, lightbox, Edit, Mark fixed/Reopen, Delete (two taps), Cowork reply. Needs the admin passcode. Refreshes every 60 s. |
| `config.js` | Supabase URL, anon key (public by design), default build name. |
| `qa.css`, `qa-shared.js` | The private page's styles and helpers, shared by both pages. |
| `supabase/qa-schema.sql` | One idempotent file for the Supabase SQL editor: tables with RLS and no anon policies, four passcode-checked `security definer` functions, the `screenshots` bucket and its upload rule, a VERIFY block. The header explains every rule in plain words. |
| `scripts/export-findings.mjs` | `npm run export` on the founder's PC (service-role key from gitignored `scripts/.env`). Writes `..\exports\<date>\findings.md`, `findings.json`, `NN-<screen>-<phone>.<ext>`. `--since YYYY-MM-DD`. |
| `scripts/check-syntax.mjs` | `npm run check`: `node --check` on every script, including the inline ones in the HTML. |
| `tests/schema.test.mjs` | Loads the SQL into a scratch database on a local Postgres and proves the rules (anon denied, passcodes, CRUD, rate limit at 31). |
| `tests/pages.test.mjs` | Playwright: both pages at 390 px and 1280 px, no sideways scroll, form validation, admin gate, and the full save/list/edit/delete flows against a stubbed backend. |
| `SETUP.md` | The founder's one page. |
| `docs/` | The build report. |
| `CNAME`, `.nojekyll`, `robots.txt` | GitHub Pages plumbing; `noindex, nofollow` on both pages too. |

## Running the checks

```powershell
npm install                 # once
npm run check               # syntax of every script
npm run test:schema         # needs a local Postgres with the roles anon/authenticated
                            # default: the local Supabase stack on port 54322; override with QA_TEST_PG=postgresql://...
npm run test:pages          # Playwright (Chromium is installed by `npx playwright install chromium`)
npm test                    # all three
npm run serve               # serves the folder at http://127.0.0.1:8787 for a look
```

The schema test creates a database `qa_scratch`, runs the SQL twice (idempotency), runs the checks, and drops the database. It touches nothing else on that server.

## How the security works, in one paragraph

The browser holds only the anon key, which is public. The `findings` and `qa_config` tables have Row Level Security on and no policies for anon, so the key cannot read or write them at all. The only way in is four database functions that run as the owner and check the passcode first: `submit_finding` (tester passcode; at most 30 per tester name per 10 minutes), and `list_findings` / `update_finding` / `delete_finding` (admin passcode). Screenshots go to a public bucket under a random 32-hex name: anyone with the exact link can open one, nobody can list the bucket, anon can only add files that match the name pattern (at most 200 per 10 minutes bucket-wide), never change or remove them. The service-role key exists only in `scripts/.env` on the founder's PC.
