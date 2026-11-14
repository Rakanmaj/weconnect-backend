-- WeConnect full database setup: Weeks 1 and 2. PostgreSQL 13+.
-- Run the WHOLE script in your chosen database. Also upgrades an existing Week 1 setup.
-- No DROP, TRUNCATE, or account deletion. Re-running preserves data.

-- WeConnect Week 1: PostgreSQL authentication schema.
-- Create your database first, connect to it, then run this entire script.
-- PostgreSQL 13+; no extensions or external services are required.
-- Re-running this script preserves existing accounts and sessions.

BEGIN;

CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role VARCHAR(16) NOT NULL CHECK (role IN ('developer', 'company', 'admin')),
    email VARCHAR(254) NOT NULL,
    password_hash TEXT NOT NULL CHECK (length(password_hash) >= 60),
    first_name VARCHAR(100) NOT NULL CHECK (length(btrim(first_name)) > 0),
    last_name VARCHAR(100) NOT NULL DEFAULT '',
    account_status VARCHAR(16) NOT NULL DEFAULT 'active'
        CHECK (account_status IN ('active', 'suspended')),
    email_verified_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email))),
    CONSTRAINT users_email_format CHECK (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

-- An email identifies one account across all three roles, regardless of case.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique
    ON public.users (lower(email));

CREATE TABLE IF NOT EXISTS public.developer_profiles (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    preferred_position VARCHAR(120) NOT NULL DEFAULT '',
    location VARCHAR(200) NOT NULL DEFAULT '',
    github_url VARCHAR(2048) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.company_profiles (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    company_name VARCHAR(200) NOT NULL CHECK (length(btrim(company_name)) > 0),
    website VARCHAR(2048) NOT NULL,
    industry VARCHAR(120) NOT NULL,
    company_size VARCHAR(20) NOT NULL
        CHECK (company_size IN ('1-10', '11-50', '50-200', '200-500', '500+')),
    location VARCHAR(200) NOT NULL,
    contact_name VARCHAR(100) NOT NULL,
    contact_title VARCHAR(120) NOT NULL,
    about TEXT NOT NULL DEFAULT '' CHECK (length(about) <= 5000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    -- Store only SHA-256 of the random cookie token, never the cookie itself.
    token_hash CHAR(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx
    ON public.user_sessions(user_id);
CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx
    ON public.user_sessions(expires_at);

COMMIT;

-- Sign-up INSERTs and sign-in lookups are parameterized in server/auth.js.
-- Passwords are hashed and verified in Node.js, not compared as plaintext SQL.
-- Admins can only be created through the server/scripts/create-admin.js command.

-- Optional read-only check after registering through the website:
-- SELECT id, role, email, first_name, last_name, created_at FROM public.users;

-- Week 2. Run after 001_auth.sql, or use the combined weconnect_weeks_1_2.sql.
-- Additive and safe to re-run. No existing accounts or profiles are deleted.
BEGIN;

ALTER TABLE public.developer_profiles
    ADD COLUMN IF NOT EXISTS bio TEXT NOT NULL DEFAULT '' CHECK (length(bio) <= 5000),
    ADD COLUMN IF NOT EXISTS phone VARCHAR(40) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS education JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(education) = 'array'),
    ADD COLUMN IF NOT EXISTS skills TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS years_experience SMALLINT NOT NULL DEFAULT 0 CHECK (years_experience BETWEEN 0 AND 60),
    ADD COLUMN IF NOT EXISTS career_goals TEXT NOT NULL DEFAULT '' CHECK (length(career_goals) <= 3000),
    ADD COLUMN IF NOT EXISTS linkedin_url VARCHAR(2048) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS portfolio_url VARCHAR(2048) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS weekly_hours SMALLINT NOT NULL DEFAULT 25 CHECK (weekly_hours BETWEEN 1 AND 80),
    ADD COLUMN IF NOT EXISTS project_types TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS available_from DATE,
    ADD COLUMN IF NOT EXISTS career_path VARCHAR(120) NOT NULL DEFAULT ''
        CHECK (career_path IN ('', 'Frontend Developer', 'Backend Developer', 'Full-Stack Developer')),
    ADD COLUMN IF NOT EXISTS onboarding_step SMALLINT NOT NULL DEFAULT 1 CHECK (onboarding_step BETWEEN 1 AND 9),
    ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.company_profiles
    ADD COLUMN IF NOT EXISTS registration_number VARCHAR(100) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS registration_country VARCHAR(100) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Private file bytes are never published as static URLs. API checks owner/admin access.
CREATE TABLE IF NOT EXISTS public.profile_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    kind VARCHAR(24) NOT NULL CHECK (kind IN ('cv', 'certificate', 'identity', 'registration', 'avatar')),
    original_name VARCHAR(180) NOT NULL,
    mime_type VARCHAR(40) NOT NULL CHECK (mime_type IN ('application/pdf', 'image/png', 'image/jpeg')),
    byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
    content BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (octet_length(content) = byte_size)
);
CREATE INDEX IF NOT EXISTS profile_files_owner_idx ON public.profile_files(user_id);

CREATE TABLE IF NOT EXISTS public.account_verifications (
    user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    status VARCHAR(16) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'pending', 'verified', 'more-info', 'rejected')),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    submitted_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    feedback TEXT NOT NULL DEFAULT '' CHECK (length(feedback) <= 5000),
    snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS account_verifications_queue_idx ON public.account_verifications(status, submitted_at);
CREATE TABLE IF NOT EXISTS public.verification_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    status VARCHAR(16) NOT NULL CHECK (status IN ('draft', 'pending', 'verified', 'more-info', 'rejected')),
    feedback TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.account_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('email-verification', 'password-reset')),
    token_hash CHAR(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS account_tokens_owner_idx ON public.account_tokens(user_id, purpose);

CREATE TABLE IF NOT EXISTS public.company_team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.company_profiles(user_id) ON DELETE CASCADE,
    member_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL CHECK (length(btrim(name)) > 0),
    email VARCHAR(254) NOT NULL CHECK (email = lower(btrim(email))),
    team_role VARCHAR(16) NOT NULL CHECK (team_role IN ('Admin', 'Evaluator', 'Recruiter')),
    status VARCHAR(16) NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'revoked')),
    token_hash CHAR(64) UNIQUE,
    expires_at TIMESTAMPTZ,
    invited_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    joined_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(company_id, email)
);
CREATE INDEX IF NOT EXISTS company_team_members_user_idx ON public.company_team_members(member_user_id, status);

COMMIT;

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

BEGIN;
INSERT INTO growth_skills(slug,name,description,career_paths,status) VALUES('javascript','JavaScript','Language fundamentals, asynchronous work and robust data transformations.',ARRAY['Frontend Developer','Backend Developer','Full-Stack Developer']::text[],'published') ON CONFLICT(slug) DO NOTHING;
INSERT INTO growth_skills(slug,name,description,career_paths,status) VALUES('react','React','Components, state, effects, accessible forms and maintainable interfaces.',ARRAY['Frontend Developer','Full-Stack Developer']::text[],'published') ON CONFLICT(slug) DO NOTHING;
INSERT INTO growth_skills(slug,name,description,career_paths,status) VALUES('node','Node.js','HTTP services, Express middleware, validation, authorization and operational reliability.',ARRAY['Backend Developer','Full-Stack Developer']::text[],'published') ON CONFLICT(slug) DO NOTHING;
INSERT INTO growth_skills(slug,name,description,career_paths,status) VALUES('postgresql','PostgreSQL','Relational modeling, safe queries, transactions, constraints and query performance.',ARRAY['Backend Developer','Full-Stack Developer']::text[],'published') ON CONFLICT(slug) DO NOTHING;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('frontend-assessment','assessment',NULL,1) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'Frontend Developer Assessment','A timed assessment of practical JavaScript, web security and application design. Multiple-choice answers are scored automatically. Coding and written answers are reviewed by an administrator.',ARRAY['Frontend Developer']::text[],60,70,'[{"id":"http","type":"mcq","prompt":"Which HTTP status should a successful resource creation return?","options":["200","201","401","500"],"correctAnswer":"201","points":10,"starterCode":"","rubric":"","tests":[]},{"id":"password","type":"mcq","prompt":"How should an application store user passwords?","options":["Plain text","A salted password hash","Reversible Base64","In browser storage"],"correctAnswer":"A salted password hash","points":10,"starterCode":"","rubric":"","tests":[]},{"id":"sql","type":"mcq","prompt":"What prevents SQL injection when a query includes user input?","options":["String concatenation","Parameterized queries","Hiding the form","A longer password"],"correctAnswer":"Parameterized queries","points":10,"starterCode":"","rubric":"","tests":[]},{"id":"promise","type":"mcq","prompt":"Which construct handles a rejected promise in async code?","options":["try / catch around await","A CSS rule","JSON.stringify","A React key"],"correctAnswer":"try / catch around await","points":10,"starterCode":"","rubric":"","tests":[]},{"id":"deduplicate","type":"code","prompt":"Read a JSON array of strings from stdin. Print a JSON array with duplicates removed, preserving first occurrence order. Reject non-array input with the output INVALID.","points":30,"options":[],"correctAnswer":"","starterCode":"// Read stdin and write the required result to stdout.\nconst fs = require(\"node:fs\");\nconst input = fs.readFileSync(0, \"utf8\").trim();\n// Implement your solution below.\n","rubric":"Award 50% for correctness on the stated examples and edge cases, 25% for input validation, and 25% for clear, maintainable code. Syntax alone earns no correctness credit.","tests":[{"name":"Duplicate values","input":"[\"a\",\"b\",\"a\"]","output":"[\"a\",\"b\"]"},{"name":"Empty array","input":"[]","output":"[]"},{"name":"Invalid input","input":"{\"a\":1}","output":"INVALID"}]},{"id":"design","type":"written","prompt":"Describe how you would validate a profile form and enforce ownership when saving it to an Express API.","points":30,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award up to 10 points for client and server validation, 10 for session-based ownership (never trusting a supplied user ID), and 10 for useful errors and safe database writes.","tests":[]}]'::jsonb,'Answer all questions. Work is saved as you go. Time continues when this tab is closed. Assessment retakes are available after 24 hours.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('backend-assessment','assessment',NULL,1) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'Backend Developer Assessment','A timed assessment of practical JavaScript, web security and application design. Multiple-choice answers are scored automatically. Coding and written answers are reviewed by an administrator.',ARRAY['Backend Developer']::text[],60,70,'[{"id":"http","type":"mcq","prompt":"Which HTTP status should a successful resource creation return?","options":["200","201","401","500"],"correctAnswer":"201","points":10,"starterCode":"","rubric":"","tests":[]},{"id":"password","type":"mcq","prompt":"How should an application store user passwords?","options":["Plain text","A salted password hash","Reversible Base64","In browser storage"],"correctAnswer":"A salted password hash","points":10,"starterCode":"","rubric":"","tests":[]},{"id":"sql","type":"mcq","prompt":"What prevents SQL injection when a query includes user input?","options":["String concatenation","Parameterized queries","Hiding the form","A longer password"],"correctAnswer":"Parameterized queries","points":10,"starterCode":"","rubric":"","tests":[]},{"id":"promise","type":"mcq","prompt":"Which construct handles a rejected promise in async code?","options":["try / catch around await","A CSS rule","JSON.stringify","A React key"],"correctAnswer":"try / catch around await","points":10,"starterCode":"","rubric":"","tests":[]},{"id":"deduplicate","type":"code","prompt":"Read a JSON array of strings from stdin. Print a JSON array with duplicates removed, preserving first occurrence order. Reject non-array input with the output INVALID.","points":30,"options":[],"correctAnswer":"","starterCode":"// Read stdin and write the required result to stdout.\nconst fs = require(\"node:fs\");\nconst input = fs.readFileSync(0, \"utf8\").trim();\n// Implement your solution below.\n","rubric":"Award 50% for correctness on the stated examples and edge cases, 25% for input validation, and 25% for clear, maintainable code. Syntax alone earns no correctness credit.","tests":[{"name":"Duplicate values","input":"[\"a\",\"b\",\"a\"]","output":"[\"a\",\"b\"]"},{"name":"Empty array","input":"[]","output":"[]"},{"name":"Invalid input","input":"{\"a\":1}","output":"INVALID"}]},{"id":"design","type":"written","prompt":"Describe how you would validate a profile form and enforce ownership when saving it to an Express API.","points":30,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award up to 10 points for client and server validation, 10 for session-based ownership (never trusting a supplied user ID), and 10 for useful errors and safe database writes.","tests":[]}]'::jsonb,'Answer all questions. Work is saved as you go. Time continues when this tab is closed. Assessment retakes are available after 24 hours.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('full-stack-assessment','assessment',NULL,1) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'Full-Stack Developer Assessment','A timed assessment of practical JavaScript, web security and application design. Multiple-choice answers are scored automatically. Coding and written answers are reviewed by an administrator.',ARRAY['Full-Stack Developer']::text[],60,70,'[{"id":"http","type":"mcq","prompt":"Which HTTP status should a successful resource creation return?","options":["200","201","401","500"],"correctAnswer":"201","points":10,"starterCode":"","rubric":"","tests":[]},{"id":"password","type":"mcq","prompt":"How should an application store user passwords?","options":["Plain text","A salted password hash","Reversible Base64","In browser storage"],"correctAnswer":"A salted password hash","points":10,"starterCode":"","rubric":"","tests":[]},{"id":"sql","type":"mcq","prompt":"What prevents SQL injection when a query includes user input?","options":["String concatenation","Parameterized queries","Hiding the form","A longer password"],"correctAnswer":"Parameterized queries","points":10,"starterCode":"","rubric":"","tests":[]},{"id":"promise","type":"mcq","prompt":"Which construct handles a rejected promise in async code?","options":["try / catch around await","A CSS rule","JSON.stringify","A React key"],"correctAnswer":"try / catch around await","points":10,"starterCode":"","rubric":"","tests":[]},{"id":"deduplicate","type":"code","prompt":"Read a JSON array of strings from stdin. Print a JSON array with duplicates removed, preserving first occurrence order. Reject non-array input with the output INVALID.","points":30,"options":[],"correctAnswer":"","starterCode":"// Read stdin and write the required result to stdout.\nconst fs = require(\"node:fs\");\nconst input = fs.readFileSync(0, \"utf8\").trim();\n// Implement your solution below.\n","rubric":"Award 50% for correctness on the stated examples and edge cases, 25% for input validation, and 25% for clear, maintainable code. Syntax alone earns no correctness credit.","tests":[{"name":"Duplicate values","input":"[\"a\",\"b\",\"a\"]","output":"[\"a\",\"b\"]"},{"name":"Empty array","input":"[]","output":"[]"},{"name":"Invalid input","input":"{\"a\":1}","output":"INVALID"}]},{"id":"design","type":"written","prompt":"Describe how you would validate a profile form and enforce ownership when saving it to an Express API.","points":30,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award up to 10 points for client and server validation, 10 for session-based ownership (never trusting a supplied user ID), and 10 for useful errors and safe database writes.","tests":[]}]'::jsonb,'Answer all questions. Work is saved as you go. Time continues when this tab is closed. Assessment retakes are available after 24 hours.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('javascript-1','challenge',(SELECT id FROM growth_skills WHERE slug='javascript'),1) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'JavaScript: Array transformations','Challenge 1 of 10. Apply array transformations and explain your implementation choices.',ARRAY['Frontend Developer','Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"Which method creates a new array by transforming each element?","options":["map","push","pop","splice"],"correctAnswer":"map","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete JavaScript example demonstrating array transformations. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('javascript-2','challenge',(SELECT id FROM growth_skills WHERE slug='javascript'),2) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'JavaScript: Immutable updates','Challenge 2 of 10. Apply immutable updates and explain your implementation choices.',ARRAY['Frontend Developer','Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"Which expression creates a shallow copy of an array?","options":["[...items]","items.push(1)","items.sort()","items.reverse()"],"correctAnswer":"[...items]","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete JavaScript example demonstrating immutable updates. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('javascript-3','challenge',(SELECT id FROM growth_skills WHERE slug='javascript'),3) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'JavaScript: Strict comparisons','Challenge 3 of 10. Apply strict comparisons and explain your implementation choices.',ARRAY['Frontend Developer','Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"Which operator compares values without type coercion?","options":["===","==","=","!="],"correctAnswer":"===","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete JavaScript example demonstrating strict comparisons. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('javascript-4','challenge',(SELECT id FROM growth_skills WHERE slug='javascript'),4) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'JavaScript: Lexical scope','Challenge 4 of 10. Apply lexical scope and explain your implementation choices.',ARRAY['Frontend Developer','Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"Which declaration is block-scoped?","options":["let","var","A global assignment","An undeclared variable"],"correctAnswer":"let","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete JavaScript example demonstrating lexical scope. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('javascript-5','challenge',(SELECT id FROM growth_skills WHERE slug='javascript'),5) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'JavaScript: Asynchronous work','Challenge 5 of 10. Apply asynchronous work and explain your implementation choices.',ARRAY['Frontend Developer','Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"What does Promise.all do when one input promise rejects?","options":["Rejects with that failure","Always succeeds","Ignores that promise","Retries it forever"],"correctAnswer":"Rejects with that failure","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete JavaScript example demonstrating asynchronous work. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('javascript-6','challenge',(SELECT id FROM growth_skills WHERE slug='javascript'),6) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'JavaScript: Error handling','Challenge 6 of 10. Apply error handling and explain your implementation choices.',ARRAY['Frontend Developer','Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"Which block runs whether try succeeds or throws?","options":["finally","else","case","default"],"correctAnswer":"finally","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete JavaScript example demonstrating error handling. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('javascript-7','challenge',(SELECT id FROM growth_skills WHERE slug='javascript'),7) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'JavaScript: Object identity','Challenge 7 of 10. Apply object identity and explain your implementation choices.',ARRAY['Frontend Developer','Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"What is the result of comparing two separately created empty objects with ===?","options":["false","true","null","undefined"],"correctAnswer":"false","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete JavaScript example demonstrating object identity. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('javascript-8','challenge',(SELECT id FROM growth_skills WHERE slug='javascript'),8) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'JavaScript: Data validation','Challenge 8 of 10. Apply data validation and explain your implementation choices.',ARRAY['Frontend Developer','Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"Which reliably checks whether a value is an array?","options":["Array.isArray(value)","typeof value === \"array\"","value === []","value.length === 0"],"correctAnswer":"Array.isArray(value)","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete JavaScript example demonstrating data validation. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('javascript-9','challenge',(SELECT id FROM growth_skills WHERE slug='javascript'),9) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'JavaScript: Event loop','Challenge 9 of 10. Apply event loop and explain your implementation choices.',ARRAY['Frontend Developer','Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"When is a fulfilled promise callback run relative to the current synchronous code?","options":["After the current call stack","Before all synchronous code","Only after one second","Never"],"correctAnswer":"After the current call stack","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete JavaScript example demonstrating event loop. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('javascript-10','challenge',(SELECT id FROM growth_skills WHERE slug='javascript'),10) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'JavaScript: Robust transformations','Challenge 10 of 10. Apply robust transformations and explain your implementation choices.',ARRAY['Frontend Developer','Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"Which collection stores unique values?","options":["Set","Array","String","Promise"],"correctAnswer":"Set","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"implementation","type":"code","prompt":"Read a JSON array of strings from stdin. Print a JSON array with duplicates removed, preserving first occurrence order. Reject non-array input with the output INVALID.","points":60,"options":[],"correctAnswer":"","starterCode":"// Read stdin and write the required result to stdout.\nconst fs = require(\"node:fs\");\nconst input = fs.readFileSync(0, \"utf8\").trim();\n// Implement your solution below.\n","rubric":"Award 50% for correctness on the stated examples and edge cases, 25% for input validation, and 25% for clear, maintainable code. Syntax alone earns no correctness credit.","tests":[{"name":"Duplicate values","input":"[\"a\",\"b\",\"a\"]","output":"[\"a\",\"b\"]"},{"name":"Empty array","input":"[]","output":"[]"},{"name":"Invalid input","input":"{\"a\":1}","output":"INVALID"}]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('react-1','challenge',(SELECT id FROM growth_skills WHERE slug='react'),1) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'React: Component boundaries','Challenge 1 of 10. Apply component boundaries and explain your implementation choices.',ARRAY['Frontend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"What should a reusable component receive as inputs?","options":["Props","A global mutation","A SQL connection","A DOM ID only"],"correctAnswer":"Props","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete React example demonstrating component boundaries. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('react-2','challenge',(SELECT id FROM growth_skills WHERE slug='react'),2) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'React: State updates','Challenge 2 of 10. Apply state updates and explain your implementation choices.',ARRAY['Frontend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"Which updater is safe when the next state depends on previous state?","options":["setCount(c => c + 1)","count++","count = count + 1","document.count = 1"],"correctAnswer":"setCount(c => c + 1)","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete React example demonstrating state updates. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('react-3','challenge',(SELECT id FROM growth_skills WHERE slug='react'),3) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'React: List identity','Challenge 3 of 10. Apply list identity and explain your implementation choices.',ARRAY['Frontend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"Which key is best for a reordered list of saved records?","options":["Stable record ID","Array position","Random number each render","Current timestamp"],"correctAnswer":"Stable record ID","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete React example demonstrating list identity. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('react-4','challenge',(SELECT id FROM growth_skills WHERE slug='react'),4) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'React: Controlled forms','Challenge 4 of 10. Apply controlled forms and explain your implementation choices.',ARRAY['Frontend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"What keeps a controlled text input editable?","options":["value and onChange","value only","disabled","A fixed default label"],"correctAnswer":"value and onChange","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete React example demonstrating controlled forms. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('react-5','challenge',(SELECT id FROM growth_skills WHERE slug='react'),5) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'React: Effects','Challenge 5 of 10. Apply effects and explain your implementation choices.',ARRAY['Frontend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"What should an effect return to unsubscribe from a subscription?","options":["A cleanup function","A component","A CSS class","A database row"],"correctAnswer":"A cleanup function","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete React example demonstrating effects. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('react-6','challenge',(SELECT id FROM growth_skills WHERE slug='react'),6) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'React: Derived data','Challenge 6 of 10. Apply derived data and explain your implementation choices.',ARRAY['Frontend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"How should a filtered list based on current props usually be represented?","options":["Derived during rendering","Copied into redundant state","Stored in a cookie","Mutating the props array"],"correctAnswer":"Derived during rendering","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete React example demonstrating derived data. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('react-7','challenge',(SELECT id FROM growth_skills WHERE slug='react'),7) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'React: Accessible forms','Challenge 7 of 10. Apply accessible forms and explain your implementation choices.',ARRAY['Frontend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"What associates a visible label with an input?","options":["htmlFor and a matching id","A placeholder only","A color","A border radius"],"correctAnswer":"htmlFor and a matching id","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete React example demonstrating accessible forms. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('react-8','challenge',(SELECT id FROM growth_skills WHERE slug='react'),8) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'React: Request cancellation','Challenge 8 of 10. Apply request cancellation and explain your implementation choices.',ARRAY['Frontend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"What can cancel an obsolete fetch request?","options":["AbortController","JSON.parse","setInterval","Array.sort"],"correctAnswer":"AbortController","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete React example demonstrating request cancellation. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('react-9','challenge',(SELECT id FROM growth_skills WHERE slug='react'),9) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'React: Error states','Challenge 9 of 10. Apply error states and explain your implementation choices.',ARRAY['Frontend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"What should a failed save provide to the user?","options":["A useful error and retry path","A false success message","A blank page","A silent refresh"],"correctAnswer":"A useful error and retry path","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete React example demonstrating error states. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('react-10','challenge',(SELECT id FROM growth_skills WHERE slug='react'),10) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'React: State ownership','Challenge 10 of 10. Apply state ownership and explain your implementation choices.',ARRAY['Frontend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"Where should state shared by sibling components usually live?","options":["Their nearest common owner","In both siblings independently","In a CSS file","In a global DOM attribute"],"correctAnswer":"Their nearest common owner","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete React example demonstrating state ownership. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('node-1','challenge',(SELECT id FROM growth_skills WHERE slug='node'),1) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'Node.js: Request routing','Challenge 1 of 10. Apply request routing and explain your implementation choices.',ARRAY['Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"Which Express method handles a POST route?","options":["app.post","app.css","app.table","app.mountSQL"],"correctAnswer":"app.post","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete Node.js example demonstrating request routing. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('node-2','challenge',(SELECT id FROM growth_skills WHERE slug='node'),2) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'Node.js: Input validation','Challenge 2 of 10. Apply input validation and explain your implementation choices.',ARRAY['Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"Where must security-relevant input validation run?","options":["On the server","Only in the browser","Only in CSS","Only in documentation"],"correctAnswer":"On the server","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete Node.js example demonstrating input validation. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('node-3','challenge',(SELECT id FROM growth_skills WHERE slug='node'),3) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'Node.js: Authentication','Challenge 3 of 10. Apply authentication and explain your implementation choices.',ARRAY['Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"What identifies an authenticated request in this project?","options":["A validated server session","A user ID sent in the form","A display name","An email query parameter"],"correctAnswer":"A validated server session","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete Node.js example demonstrating authentication. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('node-4','challenge',(SELECT id FROM growth_skills WHERE slug='node'),4) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'Node.js: Authorization','Challenge 4 of 10. Apply authorization and explain your implementation choices.',ARRAY['Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"What must a resource update check after authentication?","options":["Ownership or explicit permission","Only the button color","The browser width","The requested filename"],"correctAnswer":"Ownership or explicit permission","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete Node.js example demonstrating authorization. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('node-5','challenge',(SELECT id FROM growth_skills WHERE slug='node'),5) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'Node.js: Middleware order','Challenge 5 of 10. Apply middleware order and explain your implementation choices.',ARRAY['Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"When should authorization middleware run?","options":["Before protected route logic","After sending the response","Only during build","Only on the home page"],"correctAnswer":"Before protected route logic","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete Node.js example demonstrating middleware order. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('node-6','challenge',(SELECT id FROM growth_skills WHERE slug='node'),6) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'Node.js: HTTP errors','Challenge 6 of 10. Apply http errors and explain your implementation choices.',ARRAY['Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"Which status indicates an authenticated user lacks permission?","options":["403","201","302","101"],"correctAnswer":"403","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete Node.js example demonstrating http errors. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('node-7','challenge',(SELECT id FROM growth_skills WHERE slug='node'),7) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'Node.js: Request limits','Challenge 7 of 10. Apply request limits and explain your implementation choices.',ARRAY['Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"Why cap incoming JSON body size?","options":["Limit resource exhaustion","Improve button spacing","Replace authentication","Enable SQL joins"],"correctAnswer":"Limit resource exhaustion","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete Node.js example demonstrating request limits. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('node-8','challenge',(SELECT id FROM growth_skills WHERE slug='node'),8) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'Node.js: Async failures','Challenge 8 of 10. Apply async failures and explain your implementation choices.',ARRAY['Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"What should an API return for an unexpected server failure?","options":["A safe error without internal secrets","The database password","The entire stack trace","Another user session"],"correctAnswer":"A safe error without internal secrets","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete Node.js example demonstrating async failures. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('node-9','challenge',(SELECT id FROM growth_skills WHERE slug='node'),9) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'Node.js: Idempotency','Challenge 9 of 10. Apply idempotency and explain your implementation choices.',ARRAY['Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"What should repeated submission requests avoid?","options":["Duplicate final records","Stable response codes","Ownership checks","Input validation"],"correctAnswer":"Duplicate final records","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete Node.js example demonstrating idempotency. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('node-10','challenge',(SELECT id FROM growth_skills WHERE slug='node'),10) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'Node.js: Service reliability','Challenge 10 of 10. Apply service reliability and explain your implementation choices.',ARRAY['Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"What should a database health check verify?","options":["A real database query","A static green label","The website title","A hardcoded timestamp"],"correctAnswer":"A real database query","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete Node.js example demonstrating service reliability. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('postgresql-1','challenge',(SELECT id FROM growth_skills WHERE slug='postgresql'),1) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'PostgreSQL: Primary keys','Challenge 1 of 10. Apply primary keys and explain your implementation choices.',ARRAY['Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"What identifies each row uniquely?","options":["PRIMARY KEY","ORDER BY","LIMIT","OFFSET"],"correctAnswer":"PRIMARY KEY","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete PostgreSQL example demonstrating primary keys. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('postgresql-2','challenge',(SELECT id FROM growth_skills WHERE slug='postgresql'),2) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'PostgreSQL: Foreign keys','Challenge 2 of 10. Apply foreign keys and explain your implementation choices.',ARRAY['Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"What enforces a reference to another table?","options":["FOREIGN KEY","GROUP BY","A text label","A browser route"],"correctAnswer":"FOREIGN KEY","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete PostgreSQL example demonstrating foreign keys. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('postgresql-3','challenge',(SELECT id FROM growth_skills WHERE slug='postgresql'),3) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'PostgreSQL: Parameterized SQL','Challenge 3 of 10. Apply parameterized sql and explain your implementation choices.',ARRAY['Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"Which PostgreSQL parameter placeholder is valid?","options":["$1","{userInput}","%user%","@HTML"],"correctAnswer":"$1","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete PostgreSQL example demonstrating parameterized sql. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('postgresql-4','challenge',(SELECT id FROM growth_skills WHERE slug='postgresql'),4) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'PostgreSQL: Transactions','Challenge 4 of 10. Apply transactions and explain your implementation choices.',ARRAY['Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"What cancels all uncommitted changes in a transaction?","options":["ROLLBACK","COMMIT","SELECT","ORDER BY"],"correctAnswer":"ROLLBACK","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete PostgreSQL example demonstrating transactions. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('postgresql-5','challenge',(SELECT id FROM growth_skills WHERE slug='postgresql'),5) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'PostgreSQL: Unique constraints','Challenge 5 of 10. Apply unique constraints and explain your implementation choices.',ARRAY['Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"What prevents duplicate email identities at database level?","options":["A unique constraint or index","A frontend warning","A CSS selector","A timeout"],"correctAnswer":"A unique constraint or index","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete PostgreSQL example demonstrating unique constraints. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('postgresql-6','challenge',(SELECT id FROM growth_skills WHERE slug='postgresql'),6) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'PostgreSQL: Joins','Challenge 6 of 10. Apply joins and explain your implementation choices.',ARRAY['Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"Which join retains every row from the left table?","options":["LEFT JOIN","INNER JOIN","CROSS JOIN","RIGHT FILTER"],"correctAnswer":"LEFT JOIN","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete PostgreSQL example demonstrating joins. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('postgresql-7','challenge',(SELECT id FROM growth_skills WHERE slug='postgresql'),7) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'PostgreSQL: Aggregations','Challenge 7 of 10. Apply aggregations and explain your implementation choices.',ARRAY['Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"Which clause filters grouped results?","options":["HAVING","WHERE before grouping","LIMIT only","VALUES"],"correctAnswer":"HAVING","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete PostgreSQL example demonstrating aggregations. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('postgresql-8','challenge',(SELECT id FROM growth_skills WHERE slug='postgresql'),8) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'PostgreSQL: Concurrency','Challenge 8 of 10. Apply concurrency and explain your implementation choices.',ARRAY['Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"What can serialize concurrent updates to one row?","options":["SELECT FOR UPDATE inside a transaction","An HTML lock icon","A browser alert","ORDER BY alone"],"correctAnswer":"SELECT FOR UPDATE inside a transaction","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete PostgreSQL example demonstrating concurrency. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('postgresql-9','challenge',(SELECT id FROM growth_skills WHERE slug='postgresql'),9) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'PostgreSQL: Indexes','Challenge 9 of 10. Apply indexes and explain your implementation choices.',ARRAY['Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"Which command helps inspect a query execution plan?","options":["EXPLAIN","DROP DATABASE","REVOKE ALL","COPY PASSWORD"],"correctAnswer":"EXPLAIN","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete PostgreSQL example demonstrating indexes. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('postgresql-10','challenge',(SELECT id FROM growth_skills WHERE slug='postgresql'),10) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'PostgreSQL: Atomic operations','Challenge 10 of 10. Apply atomic operations and explain your implementation choices.',ARRAY['Backend Developer','Full-Stack Developer']::text[],30,70,'[{"id":"knowledge","type":"mcq","prompt":"Which mechanism safely handles an insert that conflicts with a unique key?","options":["ON CONFLICT","String concatenation","A frontend delay","A larger text field"],"correctAnswer":"ON CONFLICT","points":40,"starterCode":"","rubric":"","tests":[]},{"id":"application","type":"written","prompt":"Give a concrete PostgreSQL example demonstrating atomic operations. Include the implementation or query, explain an edge case, and describe how you would test it.","points":60,"options":[],"correctAnswer":"","starterCode":"","rubric":"Award 30 points for a correct example, 15 for a relevant edge case, and 15 for a meaningful test. Do not award credit for an unrelated or copied explanation.","tests":[]}]'::jsonb,'Complete the knowledge check and provide practical evidence. Your explanation is reviewed before progression is awarded.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('accessible-profile','project',NULL,1) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'Accessible Profile Manager','An independent internal project. Submit your own repository, demonstration and evidence for administrator review.',ARRAY['Frontend Developer','Full-Stack Developer']::text[],60,70,'[]'::jsonb,'Build a responsive React profile editor with labeled fields, client validation, a loading state, an error state and a successful save state. Persist updates through an API. Include keyboard navigation and mobile screenshots.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('ticket-api','project',NULL,2) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'Support Ticket API','An independent internal project. Submit your own repository, demonstration and evidence for administrator review.',ARRAY['Backend Developer','Full-Stack Developer']::text[],60,70,'[]'::jsonb,'Build an Express API to create, list, filter and update support tickets in PostgreSQL. Include parameterized SQL, pagination, server validation, authentication and owner-only updates. Document setup and test unauthorized requests.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('challenge-tracker','project',NULL,3) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'Challenge Progress Tracker','An independent internal project. Submit your own repository, demonstration and evidence for administrator review.',ARRAY['Frontend Developer','Backend Developer','Full-Stack Developer']::text[],60,70,'[]'::jsonb,'Create a small application that lists challenges, records completions and displays progress. Ensure duplicate completion requests cannot award duplicate credit. Include a README, tests and a short demonstration.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('activity-history','project',NULL,4) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'Activity History Explorer','An independent internal project. Submit your own repository, demonstration and evidence for administrator review.',ARRAY['Frontend Developer','Backend Developer','Full-Stack Developer']::text[],60,70,'[]'::jsonb,'Create a filterable activity history with server pagination, date filtering, empty/loading/error states and accessible controls. Include a reproducible setup and demonstrate at least three test cases.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
DO $catalog$ DECLARE activity UUID; BEGIN
    INSERT INTO growth_activities(slug,kind,skill_id,position) VALUES('team-directory','project',NULL,5) ON CONFLICT(slug) DO NOTHING RETURNING id INTO activity;
    IF activity IS NOT NULL THEN
      INSERT INTO growth_activity_versions(activity_id,version,title,description,career_paths,duration_minutes,pass_score,questions,requirements,status)
      VALUES(activity,1,'Company Team Directory','An independent internal project. Submit your own repository, demonstration and evidence for administrator review.',ARRAY['Frontend Developer','Backend Developer','Full-Stack Developer']::text[],60,70,'[]'::jsonb,'Build a company-scoped team directory with search and role labels. Enforce server-side membership checks and verify that one company cannot read another company’s members. Submit documentation and a demonstration.','published');
      UPDATE growth_activities SET published_version=1 WHERE id=activity;
    END IF; END $catalog$;
INSERT INTO schema_migrations(name) VALUES('004_growth_catalog') ON CONFLICT DO NOTHING;
COMMIT;
-- Best-effort browser integrity signals and server-enforced exam stopping.
BEGIN;
ALTER TABLE growth_attempts ADD COLUMN IF NOT EXISTS security_warning_count INT NOT NULL DEFAULT 0 CHECK(security_warning_count>=0);
ALTER TABLE growth_attempts ADD COLUMN IF NOT EXISTS security_warning_limit INT NOT NULL DEFAULT 3 CHECK(security_warning_limit BETWEEN 1 AND 10);
ALTER TABLE growth_attempts ADD COLUMN IF NOT EXISTS security_stopped_at TIMESTAMPTZ;
ALTER TABLE growth_attempts ADD COLUMN IF NOT EXISTS security_stop_reason TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS growth_security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), attempt_id UUID NOT NULL REFERENCES growth_attempts(id) ON DELETE CASCADE,
  client_event_id UUID NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('focus-left','capture-shortcut','copy','print-shortcut','context-menu','manual-stop')),
  counted BOOLEAN NOT NULL DEFAULT TRUE, actor_id UUID NOT NULL REFERENCES users(id),
  details TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(attempt_id,client_event_id)
);
CREATE INDEX IF NOT EXISTS growth_security_attempt ON growth_security_events(attempt_id,created_at DESC);
INSERT INTO schema_migrations(name) VALUES('005_exam_integrity') ON CONFLICT DO NOTHING;
COMMIT;
