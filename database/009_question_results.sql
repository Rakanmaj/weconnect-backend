-- Per-question result shown after a placement paper or milestone is scored.
BEGIN;
ALTER TABLE growth_attempts
  ADD COLUMN IF NOT EXISTS question_results JSONB NOT NULL DEFAULT '[]'::jsonb;
INSERT INTO schema_migrations(name) VALUES('009_question_results') ON CONFLICT DO NOTHING;
COMMIT;
