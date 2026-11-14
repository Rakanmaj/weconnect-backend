# WeConnect Week 2 — setup and demonstration

Company team invitations now use owner-set credentials and direct sign-in.
See [the current team access guide](TEAM_ACCESS.md) for the updated flow and roles.

## Full PostgreSQL query

Open your chosen database in pgAdmin Query Tool and run the **entire**
[`weconnect_weeks_1_2.sql`](weconnect_weeks_1_2.sql) file.

This is the complete query, including Week 1 users, login sessions and base profiles.
It also adds the Week 2 columns and five new tables. It works on a new PostgreSQL
13+ database or an existing Week 1 database. Re-running it keeps accounts and data.
Do not create a different database for Week 2. Use the same `DATABASE_URL`.
The app does not run migrations on startup. You manage PostgreSQL yourself.

For an existing installation, the smaller `002_profiles_verification.sql` is also
available, but the combined script is the simplest single query to run.

## Configuration

Keep your private `backend/.env` database settings. Add the following if absent:

```dotenv
APP_URL=http://localhost:3000
MAIL_MODE=outbox
MAIL_OUTBOX=.local/mail
```

Run `npm install`, then `npm run dev` from the project folder. Open
<http://localhost:3000>. Express runs on 4000; Vite proxies `/api` to it.

In local outbox mode, **no email is sent over the internet**. Open the newest text
file in the project's `backend/.local/mail` folder and copy its full link into the browser.
These files contain private links and are never exposed through
the website. They are for the local demo operator only. The token is in the URL
fragment so it is not included in HTTP access logs or referrer headers.

For real delivery, configure `MAIL_MODE=smtp`, `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`,
`SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` using your provider. See `backend/.env.example`.
Use the correct public HTTPS `APP_URL`, `WEB_ORIGIN`, and `COOKIE_SECURE=true`
when deploying. Production disables the local outbox.

## Developer demonstration, using buttons

1. Register/sign in as a developer. Open **Profile → Edit full profile**.
   The existing onboarding URL still works.
2. Click **Verify email**, then **Send verification link**. Open the link from your
   email or the local outbox and click **Verify my email**. Continue account setup.
3. Complete the nine onboarding steps. **Continue**, **Back**, the step buttons and
   **Save draft** save to PostgreSQL. Reloading restores the saved step and values.
   Education and certificates are optional. Choose a preferred position and skills.
4. Upload a PDF CV at step 7. File names now refer to actual private uploads.
5. Click **Submit Profile**. The status becomes **Pending Verification**.
6. In another browser profile/window, sign in as an admin. Open **Developer
   Verification**, select the new account, download/review its documents, then
   **Approve Account**, **Request more information**, or **Reject**. Enter a reason
   for the last two choices, then confirm. An admin is created with the existing
   `npm run auth:create-admin` setup; public registration cannot create admins.
7. Back in the developer browser, click **Refresh status**. Reviewer feedback and
   history are visible. Changes to reviewed profile details or documents return
   the account to Draft, so an admin must review the changed evidence.
8. After approval, **Choose Career Path → Confirm career path** stores the chosen
   assessment path. The existing assessment pages remain the Week 3 prototype.

Account verification is separate from the performance-based WeConnect badge.
Query parameters such as `?status=verified` cannot grant approval.

## Company demonstration

1. Register/sign in as a company and verify its email using the same email page.
2. Open **Profile**, edit details, add the registration number and registration
   country, and click **Save changes**. Upload a business registration document.
3. Click **View Verification Status → Submit for review**.
4. An admin opens **Company Verification**, selects that company, reviews its
   details/documents, and saves a decision. The company uses **Refresh status**.
5. Open **Team → Invite member**. Enter a name, unused email, owner-set password
   and role. An active member login is created and its credentials are delivered
   via SMTP or the local outbox.
6. The recipient opens the email's sign-in link and signs in as Company using
   those credentials. The inviting company is selected automatically. No signup,
   separate company profile or token acceptance is needed for new invitations.
7. Workspace owners and company Admins can edit team roles and revoke/restore
   access. Evaluators see project review areas; Recruiters see talent and hiring
   areas. The owner cannot be removed. See TEAM_ACCESS.md for the full matrix.

Team roles now control navigation, page access and API permissions. Company Admins
can manage the shared company profile and verification documents. Evaluators and
Recruiters cannot. Joining a team never grants platform admin access. Project and
hiring business data still use the prototype until their backend sprints are built.

## Password recovery

Use **Sign in → Forgot password? → Send reset link**. Open the email/outbox link,
enter a matching new password, then **Update password**. Links expire after 30
minutes, are stored only as hashes, and work once. A successful reset revokes all
previous login sessions. Sign in again with the new password. Unknown emails get
the same response as known ones. New reset/verification requests replace older
links of the same type.

## Files and review protection

Files are stored in PostgreSQL `BYTEA` and fetched through an authenticated API,
not public static storage. Owners and platform admins can download them.
CV: PDF up to 5 MB. Certificates/identity/business documents: PDF/PNG/JPEG up to
10 MB. Profile photos: PNG/JPEG up to 2 MB. Limit: 10 files and 50 MB per account.
Uploads check signatures, declared type, size, role, owner and origin. Upload one
file at a time. Downloads use attachment and sandbox headers; only validated
profile photos can render inline. There is no malware scanner in this capstone
implementation; use trusted demo documents.

Review decisions use a revision check and a user-row lock. An outdated review
cannot approve a changed or already reviewed submission. The review history
survives edits and resubmissions. Feedback is visible in the website; review
decisions do not send a separate notification email in this sprint.

## Added API endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET / PUT | `/api/profile` | Read/update the signed-in user's own profile |
| POST | `/api/profile/submit` | Validate and submit an account for review |
| PUT | `/api/profile/career-path` | Save an approved developer's career path |
| POST | `/api/files/:kind` | Upload one multipart `file` |
| GET / DELETE | `/api/files/:id` | Owner/admin download; owner removal |
| GET | `/api/admin/verifications?role=developer` or `company` | Admin review queue |
| GET / POST | `/api/admin/verifications/:userId` | Admin detail / revision-checked decision |
| POST | `/api/auth/send-verification` | Send a signed-in account's verification link |
| POST | `/api/auth/verify-email` | Consume a verification token |
| POST | `/api/auth/forgot-password` | Request a reset link |
| POST | `/api/auth/reset-password` | Consume a reset token and revoke sessions |
| GET | `/api/team/workspaces` | Accessible company team workspaces |
| GET | `/api/team?companyId=...` | Workspace roster and management permission |
| POST | `/api/team/invite?companyId=...` | Create a staff login with an owner-set password and active membership; email sign-in details |
| POST | `/api/team/switch` | Select an accessible company workspace |
| POST | `/api/team/accept` | Accept an older token invitation using its matching verified account |
| PATCH / DELETE | `/api/team/:memberId?companyId=...` | Change role or restore access / revoke membership |

JSON endpoints retain the Week 1 cookie-session and request-origin protection.
Uploads are the only endpoints accepting multipart form data. User-supplied account
IDs, email addresses, approval flags and admin roles cannot override ownership.

## Validation

`npm test` uses an isolated in-memory PostgreSQL engine (PGlite), never your own
database or `DATABASE_URL`. It covers Week 1 auth and Week 2 profile persistence,
uploads/access controls, submissions/review conflicts, email links, password resets,
team permissions, and both fresh and Week 1 schema upgrades.
`npm run build` and `npm run lint` check the frontend and JavaScript.
The SMTP provider and your actual PostgreSQL connection require your local setup.

Security references: [OWASP account recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html),
[Express Multer documentation](https://expressjs.com/en/resources/middleware/multer/),
[Nodemailer transports](https://nodemailer.com/transports).
