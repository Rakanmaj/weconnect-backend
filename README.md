# WeConnect backend

Node.js / Express APIs with PostgreSQL, written in JavaScript.
Frontend repository: https://github.com/Rakanmaj/weconnect-frontend

## Install and configure

Use Node.js 20.19+ or 22.12+ (Node.js 24 is supported) and your own PostgreSQL database.

```bash
npm ci
cp .env.example .env
```

Set DATABASE_URL in .env. The real local .env, account data, uploads and development
mail are intentionally excluded from Git. This does not change existing local credentials.

Create the database yourself, then run database/weconnect_weeks_1_4.sql in pgAdmin,
or explicitly run npm run db:migrate after configuring the connection. The server
does not create, migrate or seed a database automatically. The combined SQL includes
the current Weeks 1-4 schema and starter learning catalogue.

```bash
npm run dev
```

API: http://localhost:4000. Health: http://localhost:4000/api/health.
Run the frontend separately on http://localhost:3000; its development server
proxies /api to this API. WEB_ORIGIN and APP_URL must match the browser origin.

## Commands

- npm run dev: watch the API source on port 4000.
- npm run serve: run the API without watch mode.
- npm test: isolated in-memory PostgreSQL integration tests; never the configured live database.
- npm run lint: JavaScript checks.
- npm run db:migrate: explicit additive schema setup and starter catalogue.
- npm run auth:create-admin: explicit private administrator creation using local environment values.
- npm run db:seed: optional development-only presentation seed, guarded by ALLOW_DEMO_SEED.

npm start and npm run preview preserve the original combined app mode. They expect
a built sibling frontend at ../frontend/dist and serve UI plus API on port 3000.
For that layout, clone this repository as backend and the frontend repository as
frontend inside the same parent directory, then build the frontend first.

## Implemented

- Developer/company registration, sign-in/out, hashed passwords and persistent sessions.
- Email verification, password recovery and session revocation.
- Saved profiles, onboarding, career paths and private profile files.
- Initial developer/company account review with feedback, revisions and audit history.
- Company-owned workspaces and Admin/Evaluator/Recruiter staff permissions.
- Owner-set staff credentials without requiring the member to sign up separately.
- Versioned assessment/challenge/internal-project content and private evidence.
- Timed attempts, saved answers, objective bounded JavaScript checks and admin review.
- Best-effort integrity warnings, exam stop and duplicate-safe completion credit.

AI grading/follow-ups and later company delivery/evaluation/hiring/finance persistence
remain planned. Browser protections cannot guarantee blocking OS screenshots.
Finance has no payment gateway, automatic charging or escrow.

## Mail and database guides

MAIL_MODE=outbox writes private development email files under .local/mail.
SMTP settings in .env.example are placeholders for optional real delivery.
Never commit .env or .local; outgoing account messages can contain sensitive links.

- database/README.md: database configuration and API setup.
- database/WEEK_2.md: profiles, uploads, verification and recovery.
- database/TEAM_ACCESS.md: workspace membership and role boundaries.
- docs/WEEKS_3_4_DELIVERY.md: assessments, challenges, projects and integrity workflow.

## Structure

- src/: Express application, routes, authorization, mailer and safe exercise runner.
- src/scripts/: explicit schema, seed and administrator commands.
- database/: schema migrations, starter catalogue and setup documentation.
- tests/: isolated integration tests.

All original runtime configuration paths remain anchored to this repository root.
No real account rows, local email contents, PostgreSQL backups or credentials are uploaded.
