-- Milestone papers, live coach hints, and concept memory for retries.
BEGIN;
ALTER TABLE growth_attempts ADD COLUMN IF NOT EXISTS paper_questions JSONB;
ALTER TABLE growth_attempts ADD COLUMN IF NOT EXISTS coach JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS student_concept_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES developer_profiles(user_id) ON DELETE CASCADE,
  skill_id UUID REFERENCES growth_skills(id) ON DELETE SET NULL,
  activity_id UUID NOT NULL REFERENCES growth_activities(id) ON DELETE CASCADE,
  attempt_id UUID NOT NULL REFERENCES growth_attempts(id) ON DELETE CASCADE,
  question_id VARCHAR(80) NOT NULL,
  score NUMERIC(5,2) NOT NULL,
  answer_excerpt TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS student_concept_user_skill ON student_concept_events(user_id, skill_id, created_at DESC);
INSERT INTO schema_migrations(name) VALUES('007_milestone_coaching') ON CONFLICT DO NOTHING;
COMMIT;
