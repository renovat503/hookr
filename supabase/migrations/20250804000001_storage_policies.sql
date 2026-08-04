-- Run this in the Supabase SQL Editor (Dashboard → SQL) as project owner.
-- The pooler DATABASE_URL user cannot alter storage.objects policies.

ALTER TABLE IF EXISTS storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hookr_service_role_storage_all" ON storage.objects;
DROP POLICY IF EXISTS "hookr_deny_anon_storage" ON storage.objects;
DROP POLICY IF EXISTS "hookr_deny_authenticated_storage" ON storage.objects;

CREATE POLICY "hookr_service_role_storage_all"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "hookr_deny_anon_storage"
  ON storage.objects
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY "hookr_deny_authenticated_storage"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);
