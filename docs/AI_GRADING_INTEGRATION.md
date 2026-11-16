# Automatic grading and access fixes — 16 November 2026

Normal assessment and challenge submissions are scored automatically. Suspected cheating still stops an exam for an explicit administrator decision. Internal projects retain their existing review workflow.

## Provider configuration

Set these values in the backend's ignored `.env` file and restart the API:

```dotenv
GROQ_API_KEY=your_private_key
GROQ_COACH_MODEL=openai/gpt-oss-20b
GROQ_EXAM_MODEL=openai/gpt-oss-120b
```

MCQs use their server-side answer keys. Executable JavaScript uses the bounded code runner. Nonblank written answers and pseudocode require model grading. Blank answers receive zero without a provider call. The server calculates the final weighted score from individual question marks; the model's aggregate score is not trusted as the final mark.

Each model batch must contain every requested question ID exactly once, numeric marks between 0 and 100, and nonempty feedback. Missing, duplicated, unknown or invalid entries reject the whole batch. Provider errors, timeouts, rate limits and malformed results produce a retryable HTTP 503, with no invented marks or completion credit. The transaction leaves previously saved answers intact. Retry submission when the provider recovers. If the exam has expired, answer edits remain blocked and reopening the attempt retries automatic grading of the saved work. Service failure does not send an ordinary exam to the cheating-review queue.

## Question privacy

Student attempt and history responses use an explicit field allowlist. Raw `paper_questions`, answer keys, rubrics and unapproved metadata stay on the server. Published per-question feedback is returned only for final results. Administrators retain access to the paper and rubric for authorized review. Browser screenshot controls remain a best-effort deterrent rather than a guarantee.

## Company submission feedback

The feedback endpoint requires the evaluation permission, an owned project URL, and both the match and phase to belong to that exact project. Cross-company and mixed-project IDs return 404 without changing the target. Owner/evaluator operations and immediate revocation are covered by API regression tests.

## Validation and scope

Run `npm test` and `npm run lint` in the backend, and `npm run lint` / `npm run build` in the frontend. Automated tests use in-memory PostgreSQL and local provider stubs; they never use live accounts or send student data to a model. A separate manual live-provider smoke check used fictional answers to verify correct, repeated-prompt and instruction-injection cases.

This patch deliberately leaves Fares's existing migration/catalogue-refresh and challenge-timer behavior unchanged, at the owner's request. It introduces no additional schema migration. Adaptive assessment follow-ups remain unfinished and are not represented as implemented by this patch.
