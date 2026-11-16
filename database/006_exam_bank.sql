-- Exam item bank (seed sources for personalized papers). Additive; safe to re-run.
BEGIN;

CREATE TABLE IF NOT EXISTS exam_item_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  license TEXT NOT NULL DEFAULT '',
  attribution TEXT NOT NULL DEFAULT '',
  homepage TEXT NOT NULL DEFAULT ''
);

INSERT INTO exam_item_sources (id, name, license, attribution, homepage) VALUES
  ('catalog', 'WeConnect growth catalogue', 'Proprietary (this project)', 'WeConnect starter content', ''),
  ('codeprep', 'CodePrep open interview questions', 'CC-BY-4.0', 'Questions from CodePrep (https://codeprep.dev), CC-BY-4.0', 'https://codeprep.dev'),
  ('coding_mcqs', 'Coding_MCQs (Sanfoundry-derived)', 'MIT (repository); verify Sanfoundry terms for bulk use', 'MCQs via https://github.com/alidevhere/Coding_MCQs (scraped from Sanfoundry)', 'https://github.com/alidevhere/Coding_MCQs'),
  ('exercism', 'Exercism problem specifications', 'MIT', 'Exercism problem-specifications (https://exercism.org)', 'https://github.com/exercism/problem-specifications'),
  ('generated', 'WeConnect path milestone generator', 'Generated for this project', 'Variants are checked automatically before they can be served', '')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  license = EXCLUDED.license,
  attribution = EXCLUDED.attribution,
  homepage = EXCLUDED.homepage;

CREATE TABLE IF NOT EXISTS learning_objectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(120) NOT NULL UNIQUE,
  skill_id UUID REFERENCES growth_skills(id) ON DELETE SET NULL,
  statement TEXT NOT NULL,
  difficulty SMALLINT NOT NULL DEFAULT 2 CHECK (difficulty BETWEEN 1 AND 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exam_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id UUID NOT NULL REFERENCES learning_objectives(id) ON DELETE CASCADE,
  skill_id UUID REFERENCES growth_skills(id) ON DELETE SET NULL,
  activity_id UUID REFERENCES growth_activities(id) ON DELETE SET NULL,
  source_id TEXT NOT NULL REFERENCES exam_item_sources(id),
  external_id VARCHAR(200) NOT NULL,
  question JSONB NOT NULL CHECK (jsonb_typeof(question) = 'object'),
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'approved', 'rejected', 'archived')),
  variant_group UUID,
  parent_item_id UUID REFERENCES exam_items(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, external_id)
);

CREATE INDEX IF NOT EXISTS exam_items_objective_idx ON exam_items (objective_id, status);
CREATE INDEX IF NOT EXISTS exam_items_skill_idx ON exam_items (skill_id, status);
CREATE INDEX IF NOT EXISTS exam_items_activity_idx ON exam_items (activity_id, status);

INSERT INTO schema_migrations(name) VALUES ('006_exam_bank') ON CONFLICT DO NOTHING;
COMMIT;