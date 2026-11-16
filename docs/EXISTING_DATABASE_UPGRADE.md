# Updating an existing local database

Use `npm run db:upgrade-existing` inside the backend folder when upgrading the existing Weeks 3–4 database to the AI integration. It reads the configured DATABASE_URL from the ignored backend .env file. Keep credentials and database contents private.

The command requires pg_dump. On Windows it defaults to the PostgreSQL 18 installation path; on other systems it uses pg_dump from PATH. Set PG_DUMP_PATH when your installation is elsewhere.

The upgrade creates a private custom-format backup in backend/.local/backups/ before making changes. It applies missing schema additions 006–009 together in a transaction, snapshots original papers for existing attempts, and inserts updated starter questions as new published versions. It preserves the original versions and skips activities with administrator-authored versions. It checks the original rows before committing and rolls back if their protected values change. The existing activity publication pointer is allowed to move to the new version.

The upgrade is repeatable: an already matching catalogue receives no additional versions. It does not create users, grant completions, change timers, or import the live database into Git. It expects the existing authentication, growth and exam-integrity schema to have been installed first.

This separate command preserves the existing db:migrate behavior. The original catalogue-refresh commands can replace published question content in place; use the version-preserving command above for an existing database with saved work.

After configuration and the upgrade, start the API and frontend with their existing dev commands. The API health endpoint is http://localhost:4000/api/health and the frontend is http://localhost:3000. Upgrade metadata and backup locations are recorded privately in backend/.local/ai-upgrade-result.json.
