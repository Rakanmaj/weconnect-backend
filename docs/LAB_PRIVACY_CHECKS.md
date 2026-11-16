# Learning lab protection regression checks

The browser check runs an isolated in-memory PostgreSQL fixture and a temporary server on port 4417. It never connects to the configured live database or sends fixture answers to a model. Keep the frontend and backend repositories in sibling frontend/ and backend/ folders.

1. Build the frontend with `npm run build` in frontend/.
2. Install the optional browser tool in backend/: `npm install --no-save --package-lock=false --workspaces=false playwright@1.65.0`.
3. With Google Chrome installed, run `npm run test:lab-privacy` in backend/. For another installed Playwright browser, set PLAYWRIGHT_CHANNEL; PLAYWRIGHT_MODULE can point to an existing Playwright module.

The check verifies the visible lab warning counter, unchanged untimed challenges, copy/cut restrictions, delivered capture shortcuts including keyup-only PrintScreen, three-warning server stops, preserved answers, no completion credit, locked writes, persistence after reload, paired focus deduplication, offline delivery retries, and copying inside the student answer editor. It also verifies that a browser screenshot is not falsely logged as detectable.

Generated reports and screenshots stay in backend/.local/lab-privacy/. The last executed check passed all 14 cases. Browser signals are best effort and cannot guarantee prevention or detection of OS screenshots or external cameras.
