# WeConnect — current system, 1 November 2026

This diagram set is the 1 November snapshot. The company team sign-in flow changed
on 2 November; see [the current access guide](../../database/TEAM_ACCESS.md).
The database tables/columns remain the same. New members now sign in with owner-set
credentials and their workspace role also controls navigation and API access.

These diagrams document the implemented Weeks 1 and 2 system. The ERD was checked
against the live `weconnect_db` PostgreSQL database using schema metadata only.
No account records, passwords, database credentials or token values are included.

This is a historical Weeks 1–2 snapshot. For the later AI integration and local
database additions, see [the integration guide](../AI_GRADING_INTEGRATION.md) and
[the existing database upgrade guide](../EXISTING_DATABASE_UPGRADE.md).

## Main files

- `WeConnect-Current-ERD.png`: high-resolution, presentation-ready database diagram.
- `WeConnect-Current-ERD.svg`: editable vector version of the same diagram.
- `WeConnect-Current-ERD.mmd`: Mermaid ERD source, including all tables and columns.
- `WeConnect-Implemented-Features.png`: detailed image of completed work and journeys.
- `WeConnect-Implemented-Features.svg`: editable vector version of the overview.
- `WeConnect-Implemented-Features.html`: readable browser version of the overview.
- `WeConnect-ERD-Reference.html`: full dictionary, automatic ERD and foreign-key list.
- `schema-metadata.json`: captured columns, keys and indexes used for verification.

PNG dimensions: ERD 3900 × 4785; implementation overview 3600 × 5922.
SVGs keep text and shapes editable and can be enlarged without losing sharpness.
The Mermaid source can be opened in a Mermaid editor or imported using a tool's
Mermaid support. Automatic Mermaid layout differs from the composed SVG layout.

## Schema represented

9 tables, 92 columns and 12 foreign-key relationships:

1. `users` — credentials, identity and platform role.
2. `developer_profiles` — onboarding, education, skills, links and availability.
3. `company_profiles` — company details and business registration.
4. `user_sessions` — hashed, expiring and revocable login sessions.
5. `account_tokens` — hashed email-verification and password-reset tokens.
6. `profile_files` — private document/photo metadata and BYTEA content.
7. `account_verifications` — current decision, evidence snapshot and revision.
8. `verification_events` — account submission and decision history.
9. `company_team_members` — invitations, accepted membership and team roles.

The numbered relationship reference identifies every foreign-key column,
cardinality and delete rule. Required means NOT NULL, including fields with an
empty-string default; it does not mean every form must ask for that field.
`users.email` is a case-insensitive unique identifier through the lower(email)
index and normalization constraints. Team email is unique within a workspace
through the composite key UNIQUE(company_id, email).

Developer education is JSONB. Skills and project types are text arrays. No separate
education or skill-catalog tables have been added in the current implementation.
Nullable actor, reviewer, inviter and joined-user references use ON DELETE SET NULL.
Role-specific restrictions are enforced in the Express API in addition to database
constraints; foreign keys to users do not independently restrict a user's role.

## Current feature scope

Working areas: signup/login/logout, sessions and role access; saved developer
onboarding and profiles; company profiles; private uploads; email verification;
password recovery; admin account review, feedback and resubmission; approved
developer career-path selection; company team invitations and roster permissions.

Current email delivery is the private `backend/.local/mail` development outbox. SMTP is
supported but needs provider configuration for internet delivery.
Team membership permissions apply to the roster, not the future project and hiring
APIs. Review feedback is shown in the website, without a review-notification email.
Uploads are private but do not include malware scanning.

Email verification, admin account approval and the future performance badge are
different stages. Approving an account does not award WeConnect performance verification.

Assessment/AI, challenges/progression, matching, project delivery/evaluation, hiring,
interviews/offers, reports and financial records remain later backend work. The
existing pages and sample statistics still form the prototype for those areas.
There is no payment gateway in the project plan.

## Validation represented

- 39 backend integration tests across Weeks 1 and 2, using isolated PGlite.
- 9 browser journeys, including mobile onboarding and accepting team invitations.
- 6 live PostgreSQL integration checks for connection, developer/company signup,
  profile persistence, private file storage and session/access controls.
- Frontend build and JavaScript lint passed.

This snapshot documents the work completed to date, not a production readiness claim.
