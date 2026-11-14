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
