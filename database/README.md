# Weeks 1 and 2 database

For the current implementation, use the [Week 2 setup and demonstration guide](WEEK_2.md).
The full ready-to-run script is [weconnect_weeks_1_2.sql](weconnect_weeks_1_2.sql).
It includes Week 1 and safely upgrades a database that already has Week 1 tables.

The application uses PostgreSQL. You create and manage the database yourself.
The backend never creates tables automatically when it starts.

1. In pgAdmin, create a database named `weconnect` (or use your preferred name).
2. Select that database, open Query Tool, and run the entire `weconnect_weeks_1_2.sql` file.
3. Copy `backend/.env.example` to `backend/.env` and enter your database connection (or keep the existing moved file):

```dotenv
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@127.0.0.1:5432/weconnect
API_PORT=4000
WEB_ORIGIN=http://localhost:3000
COOKIE_SECURE=false
```

Replace the username, password, port, and database name with your own settings.
URL-encode special characters in the password, for example `@` as `%40`.
Keep `backend/.env` private.

The Week 1 portion creates four tables; Week 2 extends the profiles and adds five more tables:

| Table | Purpose |
| --- | --- |
| `users` | Unique email, password hash, account identity and role |
| `developer_profiles` | Details submitted by the developer registration form |
| `company_profiles` | Company and contact details from company registration |
| `user_sessions` | Revocable sign-in sessions with hashed tokens and expiry |
| `profile_files` | Private CV, certificate, identity, registration and avatar bytes |
| `account_verifications` | Current account review state and revision |
| `verification_events` | Audit trail of submissions and decisions |
| `account_tokens` | Hashed, expiring email verification and reset tokens |
| `company_team_members` | Company invitations, membership and team roles |

`weconnect_weeks_1_2.sql` can be run again without deleting registered users. It requires
PostgreSQL 13 or later and does not require `pgcrypto` or another extension.
If you prefer the terminal, `npm run db:migrate` runs that same SQL against
the database explicitly configured in `.env`.

## How signup and login work

Signup inserts the user, the appropriate profile and a session in one transaction.
Emails are normalized and have a database-level unique index, so duplicate
registrations are rejected even when requests arrive together.

The Express server hashes passwords with scrypt before inserting them. Login
looks up an account using a parameterized query, verifies the password in Node.js,
and sets an HttpOnly session cookie. There is no plaintext-password SQL comparison.

The relevant lookup is implemented in `backend/src/auth.js`:

```sql
SELECT id, role, password_hash, account_status
FROM public.users
WHERE lower(email) = $1;
```

`$1` is supplied by node-postgres; do not paste the lookup alone into Query Tool
expecting it to authenticate a browser. The working login/signup functionality
is the combination of the schema and the Express endpoints.

After registering through the website, this read-only query confirms storage:

```sql
SELECT id, role, email, first_name, last_name, created_at
FROM public.users
ORDER BY created_at DESC;
```

## Optional presentation accounts

For your local presentation, set `ALLOW_DEMO_SEED=true` in `.env` and run
`npm run db:seed` once. Existing accounts and passwords are never overwritten.
Then set `ALLOW_DEMO_SEED=false` again.

| Role | Email | Default password |
| --- | --- | --- |
| Developer | `ahmad.ali@example.com` | `WeConnect2026!` |
| Company | `sarah@techflow.example.com` | `WeConnect2026!` |
| Admin | `admin@weconnect.io` | `WeConnect2026!` |

These are deliberate local demo accounts, not credentials for a public deployment.
The presentation shortcut buttons use normal login requests for these accounts;
they do not bypass authentication. If you customize `DEMO_PASSWORD`, use that
password in the login form instead of the shortcut buttons.

To create a private administrator without demo accounts, set `ADMIN_EMAIL`,
`ADMIN_PASSWORD` and optionally `ADMIN_NAME` in your local `.env`, then run
`npm run auth:create-admin`. Remove those temporary admin-creation variables
afterward. Public signup accepts only developer and company roles.

## API endpoints

| Method | Endpoint | Behavior |
| --- | --- | --- |
| POST | `/api/auth/register` | Register a developer or company, return user, set session |
| POST | `/api/auth/login` | Verify credentials and rotate the browser session |
| GET | `/api/auth/me` | Restore the current signed-in user |
| POST | `/api/auth/logout` | Revoke the session and clear the cookie |
| GET | `/api/portals/developer` | Demonstrate server-side developer access control |
| GET | `/api/portals/company` | Demonstrate server-side company access control |
| GET | `/api/portals/admin` | Demonstrate server-side administrator access control |
| GET | `/api/health` | Check database connectivity |

POST requests must use `Content-Type: application/json`. Browser writes must
come from an origin in `WEB_ORIGIN` (comma-separated if needed). Sessions last
seven days, survive an API restart, and are revoked by logout. Expired and
suspended-account sessions cannot authenticate.

Email verification, password recovery and full onboarding persistence are implemented
in Week 2. Signup still requires the user to verify their email through a real token;
it never falsely marks an email verified. Assessment/project/hiring APIs are later work.

## Run and test

`npm run dev` starts Express on port 4000 and React on port 3000. Vite forwards
`/api` requests to Express, so the browser stays on the same origin.

For a built app, run `npm run build` followed by `npm start`. Express then serves
both the frontend and API at `http://localhost:3000`. For an HTTPS deployment,
set the correct `WEB_ORIGIN` and `COOKIE_SECURE=true`; use your host's `PORT`.
A static frontend host alone does not run this Express backend.

`npm test` runs integration tests against PostgreSQL compiled to WebAssembly in
memory (PGlite). It does not start a PostgreSQL service, use your `DATABASE_URL`,
or change your database. These tests validate the schema, transactions, password
verification, sessions, duplicate registration, role access and failure handling.
Your own PostgreSQL connection still needs to be configured and checked locally.
