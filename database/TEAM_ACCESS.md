# Company team access — direct sign-in

Updated 2 November 2026. This replaces the new-member signup/token invitation flow.
No SQL migration is needed: the existing Weeks 1–2 tables already support it.

## How the owner invites a member

1. Sign in as the company owner or a company Admin.
2. Open **Team → Invite member**.
3. Enter the person's name, an unused email, a password of 8–128 characters, and
   their company role: Admin, Evaluator or Recruiter.
4. Click **Send invitation**. The API creates an individual login in `users`, hashes
   its password, and creates an active `company_team_members` row pointing to the
   inviting company's `company_profiles.user_id`. No new company profile is created.
5. The member email contains the company name, email, owner-set password, role and
   a sign-in link. Under the current local setup this message is a text file in
   `backend/.local/mail`. Actual internet delivery requires SMTP configuration.
6. The member opens the sign-in link, chooses Company if needed, and signs in with
   the supplied email and password. Their company is selected automatically.

New members do not register a separate company, accept a token, or verify their
email before accessing the assigned workspace. Their email is not falsely marked
verified. They can use the existing Forgot password flow to change their password.
Passwords are stored as hashes in PostgreSQL. The credential email necessarily
contains the password requested by the inviting administrator; it is not returned
by team APIs or written to application logs.

## Permissions

| Area | Owner | Admin | Evaluator | Recruiter |
| --- | --- | --- | --- | --- |
| Company dashboard | Yes | Yes | Evaluation dashboard | Recruiting dashboard |
| Project overview and progress | Yes | Yes | Yes | Yes |
| Create projects and requirement analysis | Yes | Yes | No | No |
| Talent and matches | Yes | Yes | No | Yes |
| Submissions, comparison and evaluations | Yes | Yes | Yes | No |
| Hiring, interviews, offers and decisions | Yes | Yes | No | Yes |
| Company profile and verification documents | Yes | Yes | No | No |
| View company team | Yes | Yes | Yes | Yes |
| Invite members, change roles, revoke/restore access | Yes | Yes | No | No |
| Financial and company settings screens | Yes | Yes | No | No |
| Notifications screen | Yes | Yes | Yes | Yes |

Navigation, project tabs and page access reflect the member's permissions. The
Express API checks membership and permissions on each authenticated request;
role changes apply to existing sessions. Revoking a staff member without another
workspace also revokes their login sessions and blocks new company sign-ins until
an owner/Admin restores access. Restoring access keeps the existing password and
requires a new sign-in. The owner cannot be removed through the team roster.
Company Admin does not grant platform administrator access at `/admin`.

Company Admins edit the shared company's profile and documents, not a separate
staff company. Those changes retain verification invalidation and audit behavior.
Evaluators and Recruiters cannot access the profile/document endpoints by manually
entering URLs. Workspace cookies are checked against actual ownership/membership;
changing a URL or cookie cannot give access to another company.

The role-specific project and hiring screens still use the existing prototype
data. Their future database workflows are not implemented by this access change.

## Existing accounts and older invitations

An email that already belongs to an account cannot be used to overwrite that
account's password, role, or company. Use an unused staff email for the new flow.
This also protects existing developers, company owners and platform admins.

An older pending invitation with no registered account can be completed by choosing
**Set sign-in details** and providing a password. The existing pending row becomes
the active membership for the new staff login.

Older token links remain compatible for recipients who already created and
verified a company account before this change. Accepting such a link selects the
inviting workspace. A member with more than one valid workspace can use the company
selector; the server verifies every switch and remembers it in an HttpOnly cookie.

## API changes

- `POST /api/team/invite`: `{ name, email, password, role }`; creates a login and
  active membership, delivers the credentials, returns member metadata only.
- `POST /api/team/switch`: `{ companyId }`; selects an accessible workspace.
- `PATCH /api/team/:id`: `{ role }` to change role, or `{ restore: true }` to
  restore an existing member without resetting their password.
- `DELETE /api/team/:id`: revoke workspace access.
- `GET /api/company/access/:module`: checks the selected workspace permission
  boundary. It does not pretend to implement future project or hiring data APIs.

If email delivery fails, the account and membership creation transaction rolls
back. Simultaneous invitations to an already claimed email cannot create duplicate
accounts or replace an existing password.
