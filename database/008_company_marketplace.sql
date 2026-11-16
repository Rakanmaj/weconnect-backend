-- Company projects: brief, top matches, phased delivery, and on-platform hires.
BEGIN;

CREATE TABLE IF NOT EXISTS company_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_user_id UUID NOT NULL REFERENCES company_profiles(user_id),
  title VARCHAR(180) NOT NULL,
  project_type TEXT NOT NULL CHECK (project_type IN ('training','paid','hiring')),
  delivery_mode TEXT NOT NULL DEFAULT 'solo' CHECK (delivery_mode IN ('solo','team')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','matched','active','closed')),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_briefs (
  project_id UUID PRIMARY KEY REFERENCES company_projects(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  career_path VARCHAR(120) NOT NULL DEFAULT '',
  skills TEXT[] NOT NULL DEFAULT '{}',
  stack TEXT[] NOT NULL DEFAULT '{}',
  difficulty TEXT NOT NULL DEFAULT '',
  budget NUMERIC(12,2),
  context_text TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES company_projects(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL CHECK (position > 0),
  title VARCHAR(180) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  UNIQUE (project_id, position)
);

CREATE TABLE IF NOT EXISTS project_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES company_projects(id) ON DELETE CASCADE,
  developer_id UUID NOT NULL REFERENCES developer_profiles(user_id),
  rank SMALLINT NOT NULL CHECK (rank BETWEEN 1 AND 3),
  total_score NUMERIC(5,2) NOT NULL,
  breakdown JSONB NOT NULL DEFAULT '{}',
  reasons TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','invited','accepted','eliminated','selected','hired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, developer_id),
  UNIQUE (project_id, rank)
);

CREATE TABLE IF NOT EXISTS phase_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES project_matches(id) ON DELETE CASCADE,
  milestone_id UUID NOT NULL REFERENCES project_milestones(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  feedback TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','accepted','revision')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (match_id, milestone_id)
);

CREATE TABLE IF NOT EXISTS project_hires (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES company_projects(id) ON DELETE CASCADE,
  developer_id UUID NOT NULL REFERENCES developer_profiles(user_id),
  salary NUMERIC(12,2) NOT NULL CHECK (salary >= 0),
  fee_percent NUMERIC(5,2) NOT NULL DEFAULT 10,
  fee_amount NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, developer_id)
);

INSERT INTO schema_migrations(name) VALUES('008_company_marketplace') ON CONFLICT DO NOTHING;
COMMIT;
