-- Weeks 3 and 4: non-AI assessments, skills, challenges and internal projects.
-- Additive and repeatable. Run after weconnect_weeks_1_2.sql.
BEGIN;
CREATE TABLE IF NOT EXISTS growth_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), slug VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL, description TEXT NOT NULL DEFAULT '',
  career_paths TEXT[] NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  level2_threshold INT NOT NULL DEFAULT 3 CHECK(level2_threshold > 0),
  master_threshold INT NOT NULL DEFAULT 10 CHECK(master_threshold >= level2_threshold),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS growth_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), slug VARCHAR(120) NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('assessment','challenge','project')),
  skill_id UUID REFERENCES growth_skills(id),
  position INT NOT NULL DEFAULT 1 CHECK(position BETWEEN 1 AND 1000),
  published_version INT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS growth_activity_versions (
  activity_id UUID NOT NULL REFERENCES growth_activities(id), version INT NOT NULL CHECK(version > 0),
  title VARCHAR(180) NOT NULL, description TEXT NOT NULL DEFAULT '', career_paths TEXT[] NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 60 CHECK(duration_minutes BETWEEN 5 AND 240),
  pass_score INT NOT NULL DEFAULT 70 CHECK(pass_score BETWEEN 1 AND 100),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  questions JSONB NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(questions)='array'),
  requirements TEXT NOT NULL DEFAULT '', starter_code TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(activity_id,version)
);
CREATE TABLE IF NOT EXISTS growth_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES developer_profiles(user_id) ON DELETE CASCADE,
  activity_id UUID NOT NULL, version INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','pending-review','passed','failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), deadline_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ, expired BOOLEAN NOT NULL DEFAULT FALSE,
  answer_revision INT NOT NULL DEFAULT 0 CHECK(answer_revision>=0),
  objective_score NUMERIC(5,2), score NUMERIC(5,2) CHECK(score BETWEEN 0 AND 100),
  feedback TEXT NOT NULL DEFAULT '', reviewed_by UUID REFERENCES users(id), reviewed_at TIMESTAMPTZ,
  FOREIGN KEY(activity_id,version) REFERENCES growth_activity_versions(activity_id,version)
);
CREATE UNIQUE INDEX IF NOT EXISTS growth_one_active_attempt ON growth_attempts(user_id,activity_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS growth_attempt_owner ON growth_attempts(user_id,started_at DESC);
CREATE INDEX IF NOT EXISTS growth_review_queue ON growth_attempts(status,submitted_at);
CREATE TABLE IF NOT EXISTS growth_answers (
  attempt_id UUID NOT NULL REFERENCES growth_attempts(id) ON DELETE CASCADE,
  question_id VARCHAR(80) NOT NULL, answer TEXT NOT NULL DEFAULT '' CHECK(length(answer)<=30000),
  flagged BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(attempt_id,question_id)
);
CREATE TABLE IF NOT EXISTS growth_project_submissions (
  attempt_id UUID PRIMARY KEY REFERENCES growth_attempts(id) ON DELETE CASCADE,
  repository_url TEXT NOT NULL DEFAULT '', demo_url TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '' CHECK(length(summary)<=10000), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS growth_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), attempt_id UUID NOT NULL REFERENCES growth_attempts(id) ON DELETE CASCADE,
  original_name VARCHAR(180) NOT NULL, mime_type TEXT NOT NULL CHECK(mime_type IN ('application/pdf','image/png','image/jpeg')),
  byte_size INT NOT NULL CHECK(byte_size BETWEEN 1 AND 10485760), content BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CHECK(octet_length(content)=byte_size)
);
-- One credit per developer/activity; retries and repeated requests cannot add credit.
CREATE TABLE IF NOT EXISTS growth_completions (
  user_id UUID NOT NULL REFERENCES developer_profiles(user_id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES growth_activities(id), attempt_id UUID NOT NULL UNIQUE REFERENCES growth_attempts(id),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(user_id,activity_id)
);
CREATE TABLE IF NOT EXISTS growth_review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), attempt_id UUID NOT NULL REFERENCES growth_attempts(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id), action TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS growth_code_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), attempt_id UUID NOT NULL REFERENCES growth_attempts(id) ON DELETE CASCADE,
  question_id VARCHAR(80) NOT NULL, source_hash VARCHAR(64) NOT NULL, result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS growth_code_check_attempt ON growth_code_checks(attempt_id,created_at DESC);
CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO schema_migrations(name) VALUES('003_developer_growth') ON CONFLICT DO NOTHING;
COMMIT;
