-- Row-level security.
--
-- 1. RLS is enabled on every table. The application connects as the table owner, which
--    bypasses RLS, so ordinary queries are governed by the application's policy layer.
--    Any other database role (for example Supabase's `anon` and `authenticated` roles,
--    which the Supabase Data API uses) has no policies and therefore sees no rows.
-- 2. Organisation-private tables also get policies for the restricted role
--    `ace_app_user`. The application switches to that role, with the signed-in user's id
--    in `ace.user_id`, whenever it reads or writes shortlists and employer notes. Even a
--    query with a missing WHERE clause then cannot return another organisation's rows.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ace_app_user') THEN
    CREATE ROLE ace_app_user NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE format('GRANT ace_app_user TO %I', current_user);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Could not grant ace_app_user to %: %', current_user, SQLERRM;
END
$$;
--> statement-breakpoint
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
  -- Supabase Data API roles: remove any default privileges on our tables.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated';
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO ace_app_user;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.ace_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('ace.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.ace_is_org_member(org uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM organisation_memberships m
      JOIN organisations o ON o.id = m.organisation_id
      WHERE m.organisation_id = org
        AND m.user_id = public.ace_current_user_id()
        AND o.status = 'approved'
    )
  $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.ace_application_org(app uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT organisation_id FROM applications WHERE id = app $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.ace_shortlist_org(list uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT organisation_id FROM shortlists WHERE id = list $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.ace_current_user_id(), public.ace_is_org_member(uuid), public.ace_application_org(uuid), public.ace_shortlist_org(uuid) TO ace_app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shortlists, public.shortlist_entries, public.application_notes TO ace_app_user;
--> statement-breakpoint
CREATE POLICY shortlists_org_isolation ON public.shortlists FOR ALL TO ace_app_user
  USING (public.ace_is_org_member(organisation_id))
  WITH CHECK (public.ace_is_org_member(organisation_id));
--> statement-breakpoint
CREATE POLICY shortlist_entries_org_isolation ON public.shortlist_entries FOR ALL TO ace_app_user
  USING (public.ace_is_org_member(organisation_id))
  WITH CHECK (public.ace_is_org_member(organisation_id) AND public.ace_shortlist_org(shortlist_id) = organisation_id);
--> statement-breakpoint
CREATE POLICY application_notes_org_isolation ON public.application_notes FOR ALL TO ace_app_user
  USING (public.ace_is_org_member(organisation_id))
  WITH CHECK (public.ace_is_org_member(organisation_id) AND public.ace_application_org(application_id) = organisation_id);
