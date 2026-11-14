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
