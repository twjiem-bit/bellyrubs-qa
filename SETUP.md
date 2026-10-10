# Switching on qa.bellyrubs.co.in — the founder's one page

Ten steps, about 30 minutes, all from your laptop. Nothing here touches the Bellyrubs product or its database: this is a separate Supabase project and a separate public GitHub repo that holds only this folder.

**1 · Create the Supabase project.**
Go to supabase.com → your organisation → **New project**. Name `bellyrubs-qa`, region **Mumbai (ap-south-1)**, Free plan. Let it generate the database password and keep it in your password manager (the site never needs it). Wait for the green "project ready" tick.

**2 · Put your two passcodes into the SQL file.**
Open `supabase/qa-schema.sql` in Notepad. Near the middle, find the two lines under `>>> EDIT ME <<<` and replace `CHANGE-ME-tester` and `CHANGE-ME-admin` with your own two passcodes. Keep them different; letters and digits, 8 or more. The tester one goes to the testers; the admin one stays with you and Cowork.

**3 · Run the SQL.**
Select the whole file (Ctrl+A, Ctrl+C). Supabase → **SQL Editor** → **New query** → paste → **Run**. The result table at the bottom should show: 2 tables "RLS on", 5 functions "security definer", 2 passcodes "set", 1 storage bucket "public read by exact link", 1 storage policy "INSERT". If a passcode says "STILL THE PLACEHOLDER", you skipped step 2: edit and run again. Running the file twice is harmless.

**4 · If the run stopped with an error that mentions `storage.buckets`.**
Create the bucket by hand: **Storage** → **New bucket** → name `screenshots` → **Public bucket ON** → file size limit `20 MB` → allowed MIME types `image/png, image/jpeg, image/webp` → Save. Then run the SQL file again (step 3) so the upload rule lands. If the run had no error, skip this step.

**5 · Copy the project URL and the public key into config.js.**
Supabase → **Project Settings** → **API** (in the newer dashboard: **API Keys**). Copy **Project URL** and the **anon / public** key (if the dashboard shows a *publishable* key starting `sb_publishable_`, that one works too). Open `config.js` in this folder and paste them over the two placeholders. This key is meant to be public; it cannot read the findings. **Never** paste the `service_role` key anywhere in this folder except `scripts/.env` (step 10).

**6 · Create the GitHub repo and push (after Cowork's review).**
GitHub → **New repository** → name `bellyrubs-qa` → **Public** → no README → Create. Then in PowerShell:

```powershell
cd "C:\Users\Arindam\Documents\BellyRub\Project Review\Final QA Testing\qa-site"
git add -A
git commit -m "QA site: filled-in config.js"
git remote add origin https://github.com/twjiem-bit/bellyrubs-qa.git
git branch -M main
git push -u origin main
```

**7 · Turn on GitHub Pages and the custom domain.**
GitHub → `bellyrubs-qa` → **Settings → Pages** → Source **Deploy from a branch** → Branch **main** / **(root)** → Save. In **Custom domain** type `qa.bellyrubs.co.in` → Save. Tick **Enforce HTTPS** once it becomes available (after step 8 resolves).

**8 · Add the DNS record at GoDaddy.**
GoDaddy → My Products → **bellyrubs.co.in → DNS** → Add record:

| Type  | Name | Value                  | TTL |
|-------|------|------------------------|-----|
| CNAME | qa   | `twjiem-bit.github.io` | 1 h |

DNS and the certificate usually take 15–60 minutes. When GitHub shows "DNS check successful", the site is at **https://qa.bellyrubs.co.in** and the admin view at **https://qa.bellyrubs.co.in/admin.html**.

**9 · Test from your own phone.**
Open the site, type your name and the tester passcode, add a screenshot, write a note, Save → "Saved as finding #1". Tap the thumbnail: it must open full size (that proves the bucket serves by link). Open `/admin.html`, type the admin passcode: the finding is there with your name on it. Mark fixed, Reopen, Edit (add a Cowork reply), then Delete (tap twice). If the upload step says "refused by the server", send Cowork the exact words: the fix is one extra storage line, described in the build report.

**10 · The export on your PC (whenever Cowork asks for one).**
Copy `scripts\.env.example` to `scripts\.env`. Supabase → Project Settings → API → reveal the **service_role** key → paste it and the project URL into `scripts\.env`. Then, once: `npm install`. From then on `npm run export` writes `..\exports\<today>\findings.md`, `findings.json` and the screenshots. `npm run export -- --since 2026-10-15` exports only newer findings.

---

**Hand to testers:** the link `https://qa.bellyrubs.co.in`, the tester passcode, and the build name to type in the Build box (or change `DEFAULT_BUILD` in `config.js` and push). The page remembers their name, passcode and build after the first save.

**To change a passcode later:** SQL Editor → run just the matching `update public.qa_config …` line with the new value. Testers type the new one once.

**To take the site down:** GitHub → Settings → Pages → disable, or delete the repo. To wipe the findings: Supabase → Table Editor → `findings` → delete rows, and Storage → `screenshots` → delete files.
