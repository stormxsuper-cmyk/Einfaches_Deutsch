-- Apply only in Supabase. Authenticated users can access rows tied to auth.uid().
ALTER TABLE app_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_knowledge_mastery ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_vocabulary ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_grammar ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE mistakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercise_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE writing_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE speaking_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_skill_evidence ENABLE ROW LEVEL SECURITY;
-- Answer keys must never be readable by normal client roles; access only through a trusted server role.
ALTER TABLE exercise_answer_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_self_select ON app_profiles;
CREATE POLICY profiles_self_select ON app_profiles FOR SELECT USING (id = auth.uid());
DROP POLICY IF EXISTS profiles_self_insert ON app_profiles;
CREATE POLICY profiles_self_insert ON app_profiles FOR INSERT WITH CHECK (id = auth.uid());
DROP POLICY IF EXISTS profiles_self_update ON app_profiles;
CREATE POLICY profiles_self_update ON app_profiles FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['user_progress','user_knowledge_mastery','user_vocabulary','user_grammar','user_skills','mistakes','review_events','exam_results','user_achievements','daily_plans','exercise_attempts','writing_submissions','speaking_recordings','user_skill_evidence'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_self_select', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (user_id = auth.uid())', t || '_self_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_self_insert', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (user_id = auth.uid())', t || '_self_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_self_update', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid())', t || '_self_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_self_delete', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (user_id = auth.uid())', t || '_self_delete', t);
  END LOOP;
END $$;
-- This direct-DB demo API does not verify Supabase JWTs. Do not expose it publicly until JWT verification is implemented.

-- Intentionally no SELECT policy for exercise_answer_keys: ordinary client roles cannot read answer keys.
-- A trusted server/service role must grade submissions. The direct-Postgres demo API must not be exposed publicly.

-- Direct Supabase clients that insert/update synced rows need the sync cursor sequence.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND EXISTS (SELECT 1 FROM pg_class WHERE relname = 'user_sync_seq') THEN
    GRANT USAGE ON SEQUENCE user_sync_seq TO authenticated;
  END IF;
END $$;
