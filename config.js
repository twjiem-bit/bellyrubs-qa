// qa.bellyrubs.co.in — site configuration.
//
// Fill the two Supabase values from the bellyrubs-qa project:
//   Supabase dashboard → Project Settings → API →
//     Project URL      → SUPABASE_URL
//     anon public key  → SUPABASE_ANON_KEY
//
// The anon key is PUBLIC BY DESIGN. It ships in every Supabase web app and
// is safe to commit: on its own it can only do what the database lets the
// "anon" role do, which here is (a) call the four passcode-checked functions
// and (b) upload an image to the screenshots bucket under a random name.
// It cannot read the findings table, the passcodes, or list the bucket.
// Never put the service-role key in this file or anywhere in this repo.
//
// DEFAULT_BUILD is what the Build field shows to a tester who has not typed
// one before. Change it here when a new build goes out.
window.QA_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT-REF.supabase.co',
  SUPABASE_ANON_KEY: 'PASTE-THE-ANON-PUBLIC-KEY-HERE',
  DEFAULT_BUILD: 'FINAL-PREVIEW-3'
};
