-- 04: cross-device sync support (additive, safe to re-run).
-- updated_at   = logical time of the last change (set by the client for synced rows; used for last-write-wins).
-- sync_seq     = server-assigned monotonic cursor; devices pull "everything after my cursor".
CREATE SEQUENCE IF NOT EXISTS user_sync_seq;

CREATE OR REPLACE FUNCTION touch_sync_row() RETURNS TRIGGER AS $$
BEGIN
  -- A server-side update that did not set updated_at itself still counts as a change.
  IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN NEW.updated_at := NOW(); END IF;
  NEW.sync_seq := nextval('user_sync_seq');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['user_progress','user_knowledge_mastery','user_vocabulary','user_grammar','daily_plans','mistakes'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS sync_seq BIGINT NOT NULL DEFAULT nextval(''user_sync_seq'')', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(user_id, sync_seq)', 'idx_' || t || '_sync', t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_sync ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_touch_sync BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_sync_row()', t);
  END LOOP;
  -- Append-only log: cursor only.
  ALTER TABLE review_events ADD COLUMN IF NOT EXISTS sync_seq BIGINT NOT NULL DEFAULT nextval('user_sync_seq');
  CREATE INDEX IF NOT EXISTS idx_review_events_sync ON review_events(user_id, sync_seq);
END $$;
