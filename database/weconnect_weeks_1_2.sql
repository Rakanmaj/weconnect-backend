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
