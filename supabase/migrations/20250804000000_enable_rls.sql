-- Lock down PostgREST access (anon / authenticated) for Hookr tables.
-- The Next.js app uses direct Postgres (Drizzle) and the service_role key for
-- storage — both bypass RLS. Without these policies, anyone with the Supabase
-- anon key could read OAuth tokens and other data via the REST API.

-- ---------------------------------------------------------------------------
-- Application tables
-- ---------------------------------------------------------------------------

ALTER TABLE IF EXISTS public.captions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.hooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.demos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.motions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.music ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.instagram_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.scheduled_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.instagram_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.youtube_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.youtube_scheduled_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.youtube_meta ENABLE ROW LEVEL SECURITY;

-- Drop permissive default policies if Supabase created any.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'captions',
        'app_settings',
        'campaigns',
        'hooks',
        'demos',
        'motions',
        'music',
        'characters',
        'exports',
        'instagram_accounts',
        'scheduled_posts',
        'instagram_meta',
        'youtube_accounts',
        'youtube_scheduled_posts',
        'youtube_meta'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      r.policyname,
      r.schemaname,
      r.tablename
    );
  END LOOP;
END $$;

-- Explicit deny for browser / anon API clients (no policies = deny with RLS on).
REVOKE ALL ON TABLE
  public.captions,
  public.app_settings,
  public.campaigns,
  public.hooks,
  public.demos,
  public.motions,
  public.music,
  public.characters,
  public.exports,
  public.instagram_accounts,
  public.scheduled_posts,
  public.instagram_meta,
  public.youtube_accounts,
  public.youtube_scheduled_posts,
  public.youtube_meta
FROM anon, authenticated;
