-- =====================================================================
--  Bellyrubs QA site  ·  qa.bellyrubs.co.in  ·  Supabase schema
--  Project: bellyrubs-qa (a SEPARATE Supabase project, nothing to do
--  with the product database). Paste this whole file into the SQL
--  editor of that project and run it. Safe to run again: every step
--  is "create if not exists" or "replace".
--
--  BEFORE YOU RUN IT: find the two UPDATE lines marked  >>> EDIT ME <<<
--  at the end of section 2 and put your own two passcodes in them.
--
--  WHAT THIS BUILDS, IN PLAIN WORDS
--
--  1. A table `findings` — one row per screenshot a tester saves.
--     Row Level Security is ON and there are NO policies for the
--     public (anon) key. That means a visitor with the page's public
--     key can NOT read, add, change or delete rows in the table
--     directly. The only doors in are the four functions below.
--
--  2. A table `qa_config` that holds the two passcodes
--     (tester_passcode, admin_passcode). Same rule: locked to anon.
--     Only the SQL editor (you) and the functions can read it.
--
--  3. Four functions the pages call. Each one checks the passcode
--     FIRST and refuses with the error `invalid_passcode` otherwise:
--       submit_finding(...)  — tester passcode (or admin) → adds one row,
--                              refuses more than 30 rows from one tester
--                              name in 10 minutes (error `rate_limited`).
--       list_findings(...)   — admin passcode → every row, newest first.
--       update_finding(...)  — admin passcode → edit text, severity,
--                              status and the Cowork reply on one row.
--       delete_finding(...)  — admin passcode → removes one row.
--     They run as the database owner ("security definer"), which is
--     how they can touch the locked tables on the caller's behalf.
--     While a passcode is still the CHANGE-ME placeholder every function
--     refuses with `passcode_not_set`.
--
--  4. A storage bucket `screenshots`, public for READ BY EXACT LINK:
--     anyone who has a screenshot's full URL can open it; nobody can
--     list what is in the bucket. The public key may UPLOAD a file
--     only if its name is 32 random hex characters plus .png / .jpg /
--     .jpeg / .webp (that is how the page names files). The public key
--     can NOT overwrite, rename or delete anything in the bucket.
--     The bucket caps uploads at 20 MB and image types only, and takes
--     at most 200 new files in any 10 minutes from everyone together.
--
--  5. A VERIFY block at the end that lists what exists, so you can
--     see at a glance that it all landed.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1 · findings
-- ---------------------------------------------------------------------
create table if not exists public.findings (
  id               uuid        primary key default gen_random_uuid(),
  num              serial,
  created_at       timestamptz not null default now(),
  tester           text        not null,
  phone            text        check (phone in ('android','iphone')),
  role             text        check (role in ('customer','partner','admin')),
  screen           text,
  step             text,
  note             text        not null,
  severity         text        check (severity in ('blocks','wrong','looks')),
  build            text        not null,
  status           text        not null default 'open'
                               check (status in ('open','fixed','cannot','notbug')),
  screenshot_path  text,
  screenshot_bytes int,
  reply            text,
  fixed_at         timestamptz
);

create index if not exists findings_tester_recent_idx
  on public.findings (tester, created_at desc);

alter table public.findings enable row level security;

-- Supabase hands new tables to anon/authenticated by default privilege.
-- Take that back: with RLS on and no policies they could not read rows
-- anyway, but "permission denied" is clearer than "zero rows".
revoke all on table public.findings from anon, authenticated;
revoke all on sequence public.findings_num_seq from anon, authenticated;


-- ---------------------------------------------------------------------
-- 2 · qa_config (the two passcodes)
-- ---------------------------------------------------------------------
create table if not exists public.qa_config (
  key   text primary key,
  value text
);

alter table public.qa_config enable row level security;
revoke all on table public.qa_config from anon, authenticated;

insert into public.qa_config (key, value) values
  ('tester_passcode', 'CHANGE-ME-tester'),
  ('admin_passcode',  'CHANGE-ME-admin')
on conflict (key) do nothing;

-- >>> EDIT ME <<<  Put your real passcodes between the quotes, then run.
-- Keep them different. Letters and digits, 8 characters or more.
-- The functions refuse to work while a value still starts with CHANGE-ME.
update public.qa_config set value = 'CHANGE-ME-tester' where key = 'tester_passcode';
update public.qa_config set value = 'CHANGE-ME-admin'  where key = 'admin_passcode';


-- ---------------------------------------------------------------------
-- 3 · functions
-- ---------------------------------------------------------------------

-- Internal helper: compares a given passcode with a stored one.
-- Raises passcode_not_set while the placeholder is still in place.
create or replace function public.qa_passcode_ok(p_key text, p_given text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stored text;
begin
  select value into v_stored from public.qa_config where key = p_key;
  if v_stored is null or v_stored = '' or v_stored like 'CHANGE-ME%' then
    raise exception 'passcode_not_set' using errcode = 'P0001';
  end if;
  return coalesce(trim(p_given), '') = v_stored;
end;
$$;
revoke all on function public.qa_passcode_ok(text, text) from public, anon, authenticated;


-- submit_finding — tester passcode (the admin passcode also works).
create or replace function public.submit_finding(
  passcode         text,
  tester           text,
  phone            text,
  role             text,
  screen           text,
  step             text,
  note             text,
  severity         text,
  build            text,
  screenshot_path  text,
  screenshot_bytes int
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tester text := trim(coalesce(tester, ''));
  v_recent int;
  v_num    int;
begin
  if not (public.qa_passcode_ok('tester_passcode', passcode)
          or public.qa_passcode_ok('admin_passcode', passcode)) then
    raise exception 'invalid_passcode' using errcode = 'P0001';
  end if;

  if v_tester = '' or length(v_tester) > 60 then
    raise exception 'tester_name_required' using errcode = 'P0001';
  end if;
  if trim(coalesce(note, '')) = '' or length(note) > 5000 then
    raise exception 'note_required' using errcode = 'P0001';
  end if;
  if trim(coalesce(build, '')) = '' or length(build) > 60 then
    raise exception 'build_required' using errcode = 'P0001';
  end if;
  if length(coalesce(screen, '')) > 200 or length(coalesce(step, '')) > 40 then
    raise exception 'field_too_long' using errcode = 'P0001';
  end if;
  if screenshot_path is not null
     and screenshot_path !~ '^[0-9a-f]{32}\.(png|jpe?g|webp)$' then
    raise exception 'bad_screenshot_path' using errcode = 'P0001';
  end if;

  -- Rate limit: at most 30 findings per tester name per 10 minutes.
  select count(*) into v_recent
    from public.findings f
   where f.tester = v_tester
     and f.created_at > now() - interval '10 minutes';
  if v_recent >= 30 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.findings
    (tester, phone, role, screen, step, note, severity, build, screenshot_path, screenshot_bytes)
  values
    (v_tester, phone, role, nullif(trim(screen), ''), nullif(trim(step), ''),
     trim(note), severity, trim(build), screenshot_path, screenshot_bytes)
  returning num into v_num;

  return v_num;
end;
$$;


-- list_findings — admin passcode → every row, newest first.
create or replace function public.list_findings(admin_passcode text)
returns setof public.findings
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.qa_passcode_ok('admin_passcode', admin_passcode) then
    raise exception 'invalid_passcode' using errcode = 'P0001';
  end if;
  return query select * from public.findings order by num desc;
end;
$$;


-- update_finding — admin passcode → change one row.
-- Pass null for a field to leave it as it is. Setting status to 'fixed'
-- stamps fixed_at; any other status clears it.
create or replace function public.update_finding(
  admin_passcode text,
  id             uuid,
  screen         text,
  step           text,
  note           text,
  severity       text,
  status         text,
  reply          text
)
returns setof public.findings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := id;
begin
  if not public.qa_passcode_ok('admin_passcode', admin_passcode) then
    raise exception 'invalid_passcode' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.findings f where f.id = v_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  update public.findings f set
    screen   = coalesce(nullif(trim(update_finding.screen), ''), f.screen),
    step     = case when update_finding.step is null then f.step else nullif(trim(update_finding.step), '') end,
    note     = coalesce(nullif(trim(update_finding.note), ''), f.note),
    severity = coalesce(update_finding.severity, f.severity),
    status   = coalesce(update_finding.status, f.status),
    reply    = case when update_finding.reply is null then f.reply else nullif(trim(update_finding.reply), '') end,
    fixed_at = case
                 when coalesce(update_finding.status, f.status) = 'fixed'
                   then coalesce(f.fixed_at, now())
                 else null
               end
  where f.id = v_id;

  return query select * from public.findings f where f.id = v_id;
end;
$$;


-- delete_finding — admin passcode → remove one row. Returns the
-- screenshot path that was on it (the file itself stays in the bucket;
-- the export script on the founder's PC can tidy those up).
create or replace function public.delete_finding(admin_passcode text, id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text;
begin
  if not public.qa_passcode_ok('admin_passcode', admin_passcode) then
    raise exception 'invalid_passcode' using errcode = 'P0001';
  end if;
  delete from public.findings f where f.id = delete_finding.id
    returning f.screenshot_path into v_path;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return v_path;
end;
$$;


-- Who may call what: the four doors are open to the public key and to
-- signed-in users (there are none, but harmless); the helper is not.
revoke all on function public.submit_finding(text,text,text,text,text,text,text,text,text,text,int) from public;
revoke all on function public.list_findings(text) from public;
revoke all on function public.update_finding(text,uuid,text,text,text,text,text,text) from public;
revoke all on function public.delete_finding(text,uuid) from public;

grant execute on function public.submit_finding(text,text,text,text,text,text,text,text,text,text,int) to anon, authenticated;
grant execute on function public.list_findings(text) to anon, authenticated;
grant execute on function public.update_finding(text,uuid,text,text,text,text,text,text) to anon, authenticated;
grant execute on function public.delete_finding(text,uuid) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 4 · storage bucket `screenshots`
--     Skipped automatically where the storage schema does not exist
--     (e.g. a plain Postgres used for the local test).
-- ---------------------------------------------------------------------
do $storage$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema not present here - bucket and its policies skipped';
    return;
  end if;

  -- The bucket: public = served by exact URL without a key.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('screenshots', 'screenshots', true, 20971520,
          array['image/png','image/jpeg','image/webp'])
  on conflict (id) do update
    set public = true,
        file_size_limit = 20971520,
        allowed_mime_types = array['image/png','image/jpeg','image/webp'];

  -- A bucket-wide brake: the public key may add at most 200 files to the
  -- bucket in any 10 minutes, all testers together. A tester saves one
  -- screenshot per finding, so real use never gets near it; a stranger who
  -- found the public key and tried to fill the bucket would be stopped.
  -- (Runs as the owner so it can count; anon may call it but learns only yes/no.)
  execute $f$
    create or replace function public.qa_upload_budget_ok()
    returns boolean
    language sql
    security definer
    set search_path = public
    stable
    as $b$
      select count(*) < 200
        from storage.objects
       where bucket_id = 'screenshots'
         and created_at > now() - interval '10 minutes'
    $b$
  $f$;
  execute 'revoke all on function public.qa_upload_budget_ok() from public';
  execute 'grant execute on function public.qa_upload_budget_ok() to anon, authenticated';

  -- Upload: allowed ONLY for a name of 32 hex characters + image extension,
  -- and only while the bucket-wide brake above says there is room.
  drop policy if exists "qa screenshots: anon upload by random name" on storage.objects;
  create policy "qa screenshots: anon upload by random name"
    on storage.objects for insert to anon, authenticated
    with check (
      bucket_id = 'screenshots'
      and name ~ '^[0-9a-f]{32}\.(png|jpe?g|webp)$'
      and public.qa_upload_budget_ok()
    );

  -- No SELECT policy on purpose: a public bucket serves files by exact
  -- path without one, and without it the bucket cannot be listed.
  -- No UPDATE or DELETE policy on purpose: nothing can be overwritten
  -- or removed with the public key.
end
$storage$;


-- ---------------------------------------------------------------------
-- 5 · VERIFY — what landed (one result table)
-- ---------------------------------------------------------------------
drop table if exists pg_temp.qa_verify;
create temp table qa_verify (kind text, name text, detail text);

insert into qa_verify
select 'table', c.relname,
       case when c.relrowsecurity then 'RLS on' else 'RLS OFF (!)' end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('findings','qa_config')
union all
select 'policy on public table', policyname, 'UNEXPECTED - there should be none'
  from pg_policies where schemaname = 'public' and tablename in ('findings','qa_config')
union all
select 'function', p.proname,
       case when p.prosecdef then 'security definer' else 'NOT security definer (!)' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('submit_finding','list_findings','update_finding','delete_finding','qa_passcode_ok')
union all
select 'passcode', key,
       case when value like 'CHANGE-ME%' then 'STILL THE PLACEHOLDER - edit the UPDATE lines' else 'set' end
  from public.qa_config
union all
select 'storage policy', policyname, cmd::text
  from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'qa screenshots%';

do $verify$
begin
  if to_regclass('storage.buckets') is not null then
    execute $q$ insert into qa_verify
                select 'storage bucket', id,
                       case when public then 'public read by exact link' else 'NOT public (!)' end
                  from storage.buckets where id = 'screenshots' $q$;
  else
    insert into qa_verify values ('storage bucket', 'screenshots', 'skipped - no storage schema here');
  end if;
end
$verify$;

-- Expect: 2 tables RLS on · 0 policies on public tables · 5 functions
-- security definer · 2 passcodes "set" · 1 bucket public · 1 storage policy.
select * from qa_verify order by 1, 2;
