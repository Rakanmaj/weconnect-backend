# WeConnect: 2–16 November delivery

Implemented for the two official periods: Week 3 (2–9 November) and Week 4 (9–16 November). The existing React design and page paths are retained. AI generation, AI grading, AI follow-ups and AI matching are outside this delivery.

## Rakan's database and backend workstream

- Additive PostgreSQL tables for skills, activity versions, attempts, answers, project submissions, private evidence, completion credits, review events and code-test evidence.
- A complete repeatable Weeks 1–4 SQL file, plus separate schema and starter-catalogue migrations. Existing accounts, profile data and verification decisions are preserved.
- Approved-account and career-path eligibility; role and owner checks; skill-path prerequisites; assessment retakes after 24 hours.
- Server-created assessment/challenge deadlines, save/resume, automatic finalization of expired attempts when next accessed, submission locking and complete attempt history.
- Revision checks prevent a stale browser tab from overwriting a newer save. Transaction locks and unique completion keys prevent duplicate credit.
- Automatic weighted multiple-choice scoring; rubric-based administrator grading of coding, written answers and internal projects; final grades are immutable.
- Skill Level 1, Level 2 at three distinct passed challenges, and Master at ten by default. Administrators can configure skill thresholds.
- Internal-project enrollment, saved repository/demo links, evidence uploads and reviewed completion. Private downloads allow the submitting developer and platform administrators only.
- Initial assessment score bands: 70–79 gives Level 2, 80–89 Level 3, and 90–100 Level 4. This is an initial assessment level, not the later company-performance progression system.

## Ameer's frontend and integration workstream

- Live assessment introduction, timed question navigation, multiple-choice controls, editable coding/written answers, flags, autosave, resume and submission screens.
- Real processing/result/history states; manual review replaces the previous simulated AI follow-up flow.
- Administrator forms for assessment and question creation, immutable content versions, draft saving, publication and archival.
- Skill authoring, challenge authoring with rubrics and example test cases, and developer skill paths with prerequisite locks and retries.
- Internal-project authoring, developer project briefs/workspaces, submission links, private evidence and review feedback.
- A sidebar-accessible Learning Reviews queue for coding, written responses and internal-project submissions. Saved code-test evidence identifies whether it matches the final saved answer.
- Learning dashboard, real challenge counts and earned verification progress replace the relevant prototype-only figures. Later company project/hiring screens retain their existing prototype scope.
- Browser testing of the complete student/admin journey and mobile learning layouts.

### Contribution paragraph for Ameer to review

The implementation under Ameer's frontend and integration workstream connected the assessment, skill challenge and internal-project interfaces to the Express API. This included timed assessment screens, question navigation, coding and written-answer inputs, autosave and resume, submission results, administrator question-management forms, skill-path progression and internal-project evidence submission. The workstream also added a review queue so administrators can grade submissions and publish feedback, integrated JavaScript syntax checks and executable example tests, and checked the complete journey on desktop and mobile.

## JavaScript execution

The default runner is local QuickJS compiled to WebAssembly in a Node worker. Student programs execute inside that interpreter, not inside Node's `eval` or `vm`. Each example uses a fresh runtime, a 16 MB interpreter limit, a 256 KB stack limit, a 750 ms execution budget and an 8 KB output limit. A worker has a hard 10-second limit; at most two run concurrently. It exposes `readline()`, `print()` and `console.log()`. A compatibility `require('fs'|'node:fs').readFileSync(0)` reads only the supplied stdin string; it cannot read real files. Network, process and arbitrary Node modules are unavailable. This is a small JavaScript exercise runner; it does not run React/DOM projects or install npm dependencies.

Example tests produce evidence and do not award completion by themselves. Administrators apply the coding/written rubric before final points are published. Multiple-choice-only activities finalize automatically.

Optional environment variables:

```env
CODE_RUNNER_MODE=local
# Optional alternative: an operator-managed Judge0-compatible sandbox
CODE_RUNNER_URL=
CODE_RUNNER_TOKEN=
CODE_RUNNER_LANGUAGE_ID=63
```

Set `CODE_RUNNER_MODE=disabled` to disable execution while retaining saved answers and manual grading. A configured URL selects the external adapter. Provider tokens stay on the backend. References: [QuickJS runtime and resource controls](https://github.com/justjake/quickjs-emscripten#runtime), [Judge0 API](https://ce.judge0.com/).

## Question privacy

Assessment and challenge workspaces are watermarked with the signed-in user's name, email and attempt reference. Questions hide when the window/tab becomes inactive; the server deadline keeps running. Copying, context-menu copying, dragging, saving and printing of questions are restricted. Answer inputs remain editable and support selection/paste. Question text and correct answers are excluded from catalogue/brief responses; question prompts are returned through authorized attempts, and correct answers remain administrator-only.

Active attempts record best-effort browser events: leaving the exam window, detected capture shortcuts, copying questions, printing/saving shortcuts and question context menus. Each attempt allows three warnings. Duplicate event IDs and paired blur/visibility events do not double-count. At the limit, the server locks the attempt and places it in pending review, including multiple-choice-only exams. Saved answers and event history are preserved; no automatic passing grade or completion credit is issued for a stopped attempt. The administrator must explicitly choose to keep the attempt stopped with zero points or review and grade the saved answers. A warning alone is not recorded as confirmed cheating.

Questions hide immediately on focus loss, but a focus warning is recorded only when the window remains inactive for one second. This avoids treating transient focus changes during a normal reload as separate violations. Focus changes immediately caused by a recorded capture/print shortcut are grouped with that shortcut. The countdown uses low-time styling at five minutes and one minute.

Use **Learning Reviews → Show active exams → open attempt → Stop exam now** for a manual stop with a written reason. The student checks server status every ten seconds and becomes read-only after the stop. The visible **Time left** countdown uses the server-created deadline, survives reloads and continues while the tab is inactive. Expiry submits the last saved answers. Internal projects have no artificial countdown because the task is completed independently outside a timed exam.

These are browser deterrents. A website cannot guarantee prevention of Windows screenshots, screen recording, developer-tool extraction or photographs taken with another device. Do not describe the implementation as screenshot-proof.

## How to demonstrate

1. Sign in as a developer; finish account review and choose a career path if necessary.
2. Use **Assessments** in the sidebar. Start, answer, save/resume, run coding examples and submit.
3. Sign in to the admin portal in another browser/profile. Use **Learning Reviews**, grade each written/coding answer and publish feedback.
4. Return to the student's result and select **Refresh result**, then **Continue to skill paths**.
5. Complete and review a challenge. The next challenge unlocks and skill counts update.
6. Use **Internal Projects**, open a brief, join, submit evidence and review it through **Learning Reviews**.
7. Open **View history** or verification progress to show the saved results.

## SQL and setup

The connected local database was backed up before applying these additive changes. Test fixtures and test accounts use isolated in-memory PostgreSQL and are not inserted into the real database.

- Complete schema and catalogue: `backend/database/weconnect_weeks_1_4.sql`.
- New schema only: `backend/database/003_developer_growth.sql`.
- Starter catalogue only: `backend/database/004_growth_catalog.sql`.
- Exam-integrity upgrade: `backend/database/005_exam_integrity.sql`.
- `npm run db:migrate`: repeatable schema/catalogue installation.
- `npm run dev`: API at port 4000 and frontend at port 3000.
- `npm test`, `npm run build`, `npm run lint`: automated checks.

The catalogue contains three career-path assessments, four skills, forty ordered challenges and five internal projects. Catalogue installation inserts absent slugs only; it does not replace administrator-authored content or fabricate student completion records.

## API routes

All routes require a session. Developer routes use `/api/growth`; content and grading use `/api/admin/growth` and require platform-admin access.

| Route | Purpose |
| --- | --- |
| GET `/growth/overview` | Career path, eligibility, initial level, history and completion counts |
| GET `/growth/catalog?kind=assessment|challenge|project` | Published activity briefs for the selected path |
| GET `/growth/skills` | Skill path, completion counts and levels |
| GET `/growth/activities/:id-or-slug` | Published activity brief |
| POST `/growth/activities/:id-or-slug/start` | Start/resume or return the pending review |
| GET `/growth/attempts/:id` | Owned attempt, saved answers, evidence and reviewed result |
| PUT `/growth/attempts/:id/answers` | Revision-checked answers and optional project evidence links |
| POST `/growth/attempts/:id/submit` | Lock and submit; idempotent repeated requests |
| POST `/growth/attempts/:id/check` | JavaScript syntax/example execution; stores execution evidence |
| POST `/growth/attempts/:id/security-event` | Deduplicated warning event; third warning locks the exam for review |
| POST `/growth-files/:attemptId` | Upload a project PDF/PNG/JPEG |
| GET/DELETE `/growth-files/:fileId` | Private download / remove while draft is active |
| GET/POST `/admin/growth/skills` | List/create skills |
| PUT `/admin/growth/skills/:id` | Update skill configuration |
| GET/POST `/admin/growth/content` | List/create versioned activities |
| GET/PUT `/admin/growth/content/:id` | Read/create the next draft version |
| POST `/admin/growth/content/:id/publish` | Publish saved version or archive |
| GET `/admin/growth/reviews` | Pending queue; `?all=true` includes finalized results |
| GET `/admin/growth/reviews?active=true` | Active timed exams, deadlines and warning counts |
| GET/POST `/admin/growth/reviews/:id` | Review evidence / publish immutable final grades |
| POST `/admin/growth/reviews/:id/stop` | Administrator stop with a required reason |
