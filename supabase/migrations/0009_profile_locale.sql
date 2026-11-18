-- =====================================================================
-- Interface language per person. Owners choose uz / ru / en; parents
-- default to Uzbek; other roles use English.
-- =====================================================================
alter table public.profiles
  add column locale text check (locale in ('en', 'uz', 'ru'));
